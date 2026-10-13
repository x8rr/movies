import vm from "node:vm";
import { Window } from "happy-dom";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://cinesrc.st";

const JS_BUILTINS = new Set([
  "Object", "Function", "Array", "Number", "String", "Boolean", "Symbol",
  "Date", "RegExp", "Error", "TypeError", "RangeError", "ReferenceError",
  "SyntaxError", "URIError", "EvalError", "Map", "Set", "WeakMap", "WeakSet",
  "Promise", "Proxy", "Reflect", "Math", "JSON", "parseInt", "parseFloat",
  "isNaN", "isFinite", "NaN", "Infinity", "undefined", "eval", "globalThis",
  "encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent",
  "escape", "unescape", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array",
  "BigUint64Array", "BigInt", "WeakRef", "FinalizationRegistry", "Atomics",
  "TextEncoder", "TextDecoder", "URL", "URLSearchParams", "atob", "btoa",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "queueMicrotask", "structuredClone", "console", "crypto", "performance",
  "WebAssembly", "Blob", "File", "FormData", "Headers", "Request", "Response",
  "AbortController", "AbortSignal", "Intl",
]);

const scriptCache = new Map();

async function fetchScript(path) {
  const url = path.startsWith("http") ? path : BASE + path;
  if (!scriptCache.has(url)) {
    scriptCache.set(
      url,
      fetch(url, { headers: { "User-Agent": UA, Referer: BASE + "/" } }).then(
        (r) => r.text(),
      ),
    );
  }
  return scriptCache.get(url);
}

function encodeQuery(type, tmdbId, season, episode) {
  const isTV = type !== "movie";
  const arr = [
    isTV ? "tv" : "movie",
    String(tmdbId),
    isTV ? String(season) : null,
    isTV ? String(episode) : null,
  ];
  const bytes = new TextEncoder().encode(JSON.stringify(arr));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function callBootstrap(encoded) {
  const resp = await fetch(BASE + "/api/c/bootstrap", {
    method: "POST",
    headers: { "User-Agent": UA, Referer: BASE + "/", "x-cs-q": encoded },
  });
  if (!resp.ok) throw new Error("bootstrap " + resp.status);
  return resp.json();
}

function parseServerAction(text) {
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    try {
      const parsed = JSON.parse(line.slice(idx + 1));
      if (
        typeof parsed === "string" ||
        Array.isArray(parsed) ||
        (parsed && typeof parsed === "object" && !parsed.a)
      )
        return parsed;
    } catch {}
  }
  return null;
}

async function callAction(actionId, args, path, headers = {}) {
  const resp = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: BASE + path,
      "Next-Action": actionId,
      "Content-Type": "text/plain;charset=UTF-8",
      ...headers,
    },
    body: JSON.stringify(args),
  });
  if (!resp.ok) throw new Error("action " + resp.status);
  return parseServerAction(await resp.text());
}

function makeSandboxWorker(url, blobStore, parentFetch) {
  const messageCbs = [];
  let onmessageFn = null;
  let workerOnmessage = null;

  const postToMain = (data) => {
    queueMicrotask(() => {
      const ev = { data };
      for (const fn of messageCbs) fn(ev);
      if (onmessageFn) onmessageFn(ev);
    });
  };

  const workerSelf = {
    postMessage: postToMain,
    addEventListener(type, fn) {
      if (type === "message") workerOnmessage = fn;
    },
    onmessage: null,
    importScripts() {},
    location: { origin: BASE, href: BASE + "/" },
    crypto: globalThis.crypto,
    WebAssembly: globalThis.WebAssembly,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  };

  const workerFetch = (...args) => {
    let u = typeof args[0] === "string" ? args[0] : args[0]?.url || String(args[0]);
    if (u.startsWith("/")) u = BASE + u;
    const opts = typeof args[1] === "object" ? { ...args[1] } : {};
    const h = new Headers(opts.headers);
    if (!h.has("User-Agent")) h.set("User-Agent", UA);
    return fetch(u, { ...opts, headers: h });
  };

  let codePromise;
  const scriptUrl = typeof url === "string"
    ? url.startsWith("/") ? BASE + url : url
    : url instanceof URL ? url.href : String(url);

  if (scriptUrl.startsWith("blob:") && blobStore?.has(scriptUrl)) {
    codePromise = blobStore.get(scriptUrl).text();
  } else if (scriptUrl.startsWith("blob:")) {
    codePromise = Promise.reject(new Error("blob URL not in store"));
  } else {
    codePromise = fetchScript(scriptUrl);
  }

  const readyPromise = codePromise.then(async (code) => {
    const workerWin = new Window({ url: BASE + "/" });
    const workerCtx = {};
    for (const key of Object.getOwnPropertyNames(globalThis)) {
      try { workerCtx[key] = globalThis[key]; } catch {}
    }
    for (const key of Object.getOwnPropertyNames(workerWin)) {
      if (!JS_BUILTINS.has(key)) {
        try { workerCtx[key] = workerWin[key]; } catch {}
      }
    }

    Object.assign(workerCtx, {
      postMessage: postToMain,
      addEventListener: workerSelf.addEventListener.bind(workerSelf),
      onmessage: null,
      importScripts() {},
      fetch: workerFetch,
      location: workerSelf.location,
      navigator: { userAgent: UA, language: "en-US", languages: ["en-US"],
        platform: "Win32", hardwareConcurrency: 8, onLine: true },
    });
    workerCtx.self = workerCtx;
    workerCtx.window = workerCtx;
    workerCtx.globalThis = workerCtx;
    const wCtx = vm.createContext(workerCtx);
    vm.runInContext(code, wCtx, { timeout: 30000 });
    if (typeof workerCtx.onmessage === "function") {
      workerOnmessage = (ev) => workerCtx.onmessage(ev);
    }
    try { workerWin.close(); } catch {}
    return wCtx;
  }).catch((e) => console.error("[cinesrc worker]", e.message));

  return {
    postMessage(data) {
      readyPromise.then(() => {
        const ev = { data };
        if (workerOnmessage) workerOnmessage(ev);
        if (workerSelf.onmessage) workerSelf.onmessage(ev);
      });
    },
    addEventListener(type, fn) {
      if (type === "message") messageCbs.push(fn);
    },
    terminate() {},
    set onmessage(fn) { onmessageFn = fn; },
    get onmessage() { return onmessageFn; },
  };
}

function buildContext(embedPath, searchStr, encoded, rToken, pToken) {
  const loadedScripts = new Map();
  const fullUrl = BASE + embedPath + searchStr;

  const win = new Window({ url: fullUrl });

  const patchedFetch = (...args) => {
    let url =
      typeof args[0] === "string"
        ? args[0]
        : args[0] instanceof URL
          ? args[0].href
          : args[0]?.url || String(args[0]);
    const opts = typeof args[1] === "object" ? { ...args[1] } : {};

    if (url.startsWith("/")) url = BASE + url;

    const parsed = new URL(url);
    if (
      parsed.origin === BASE &&
      (parsed.pathname === "/api/c/issue" ||
        parsed.pathname === "/api/c/stage2/issue")
    ) {
      const h = new Headers(opts.headers);
      h.set("x-cs-r", rToken);
      h.set("x-cs-q", encoded);
      if (parsed.pathname === "/api/c/issue") h.set("x-cs-p", pToken);
      h.set("User-Agent", UA);
      h.set("Referer", fullUrl);
      return fetch(url, { ...opts, headers: h });
    }

    const h = new Headers(opts.headers);
    if (!h.has("User-Agent")) h.set("User-Agent", UA);
    if (!h.has("Referer")) h.set("Referer", BASE + "/");
    return fetch(url, { ...opts, headers: h });
  };

  const ctx = {};
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    try { ctx[key] = globalThis[key]; } catch {}
  }
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!JS_BUILTINS.has(key)) {
      try { ctx[key] = win[key]; } catch {}
    }
  }

  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.fetch = patchedFetch;
  ctx.navigator = {
    userAgent: UA, language: "en-US", languages: ["en-US"],
    platform: "Win32", vendor: "Google Inc.", appVersion: UA.slice(8),
    cookieEnabled: true, onLine: true, hardwareConcurrency: 8,
    maxTouchPoints: 0, doNotTrack: null,
    plugins: { length: 5, item: () => null, namedItem: () => null, refresh: () => {} },
    mimeTypes: { length: 4, item: () => null, namedItem: () => null },
    connection: { effectiveType: "4g", rtt: 50, downlink: 10, saveData: false },
    getBattery: () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 }),
    sendBeacon: () => true,
    mediaDevices: { enumerateDevices: () => Promise.resolve([]) },
    storage: { estimate: () => Promise.resolve({ quota: 1e10, usage: 0 }) },
    permissions: { query: () => Promise.resolve({ state: "prompt" }) },
    clipboard: { readText: () => Promise.resolve(""), writeText: () => Promise.resolve() },
  };
  ctx.screen = {
    width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
    colorDepth: 24, pixelDepth: 24,
    orientation: { type: "landscape-primary", angle: 0 },
  };
  ctx.devicePixelRatio = 1;
  ctx.innerWidth = 1920;
  ctx.innerHeight = 1080;
  ctx.outerWidth = 1920;
  ctx.outerHeight = 1080;

  const blobStore = new Map();
  ctx.URL = { ...URL };
  ctx.URL.createObjectURL = (blob) => {
    const id = "blob:cinesrc/" + Math.random().toString(36).slice(2);
    blobStore.set(id, blob);
    return id;
  };
  ctx.URL.revokeObjectURL = (url) => blobStore.delete(url);
  ctx.Worker = function WorkerShim(url) { return makeSandboxWorker(url, blobStore, patchedFetch); };

  let vmCtx;
  const runCode = (code) => vm.runInContext(code, vmCtx, { timeout: 30000 });

  function makeCanvasMock() {
    const mock = {
      tagName: "CANVAS", width: 300, height: 150, style: {},
      getContext() {
        return {
          fillStyle: "", strokeStyle: "", font: "10px sans-serif",
          textAlign: "start", textBaseline: "alphabetic",
          globalAlpha: 1, globalCompositeOperation: "source-over",
          fillRect() {}, clearRect() {}, strokeRect() {},
          fillText() {}, strokeText() {},
          measureText() { return { width: 0 }; },
          beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
          arc() {}, arcTo() {}, bezierCurveTo() {}, quadraticCurveTo() {}, rect() {},
          fill() {}, stroke() {}, clip() {},
          save() {}, restore() {},
          translate() {}, rotate() {}, scale() {}, transform() {}, setTransform() {},
          drawImage() {},
          createLinearGradient() { return { addColorStop() {} }; },
          createRadialGradient() { return { addColorStop() {} }; },
          getImageData() { return { data: new Uint8ClampedArray(300 * 150 * 4) }; },
          putImageData() {},
          canvas: mock,
        };
      },
      toDataURL() { return "data:image/png;base64,iVBORw0KGgo="; },
      toBlob(cb) { cb?.(new Blob()); },
    };
    return mock;
  }

  function handleAppendChild(child) {
    if (child?.tagName === "SCRIPT" || child?.tagName === "script") {
      const src = child.src || child.dataset?.src;
      if (src) {
        loadedScripts.set(src, child);
        const url = src.startsWith("/") ? BASE + src : src;
        fetchScript(url)
          .then((code) => {
            try { runCode(code); } catch (e) {
              console.error("[cinesrc eval]", src, e.message);
            }
            if (child.onload) child.onload();
            try { child.dispatchEvent?.(new Event("load")); } catch {}
          })
          .catch((e) => {
            console.error("[cinesrc fetch]", src, e.message);
            if (child.onerror) child.onerror(e);
          });
      } else if (child.textContent) {
        try { runCode(child.textContent); } catch {}
      }
      return child;
    }
    return child;
  }

  if (ctx.document) {
    const doc = ctx.document;
    const origCE = doc.createElement?.bind(doc);
    const origQS = doc.querySelector?.bind(doc);
    const origQSA = doc.querySelectorAll?.bind(doc);

    ctx.document = new Proxy(doc, {
      get(target, prop) {
        if (prop === "createElement") {
          return (tag, ...rest) => {
            if (tag === "canvas") return makeCanvasMock();
            return origCE(tag, ...rest);
          };
        }
        if (prop === "head" || prop === "body") {
          const el = target[prop];
          return new Proxy(el, {
            get(t, p) {
              if (p === "appendChild") return handleAppendChild;
              const v = t[p];
              return typeof v === "function" ? v.bind(t) : v;
            },
          });
        }
        if (prop === "querySelector") {
          return (sel) => {
            const m = sel.match(/script\[data-src(?:\^)?="([^"]+)"\]/);
            if (m) {
              for (const [k, v] of loadedScripts) if (k.startsWith(m[1])) return v;
            }
            return origQS(sel);
          };
        }
        if (prop === "querySelectorAll") {
          return (sel) => {
            const m = sel.match(/script\[data-src\^="([^"]+)"\]/);
            if (m) {
              const out = [];
              for (const [k, v] of loadedScripts) if (k.startsWith(m[1])) out.push(v);
              if (out.length) return out;
            }
            return origQSA(sel);
          };
        }
        const val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
  }

  vmCtx = vm.createContext(ctx);
  return { ctx, vmCtx, runCode, win };
}

async function solveChallenge(encoded, rToken, pToken, embedPath, searchStr) {
  const { ctx, vmCtx, runCode, win } = buildContext(
    embedPath, searchStr, encoded, rToken, pToken,
  );

  const [donutCode, prodCode] = await Promise.all([
    fetchScript("/donut.js"),
    fetchScript("/300726c-prod.js"),
  ]);

  runCode(donutCode);
  await new Promise((r) => setTimeout(r, 300));

  runCode(`
    window.__csApi = null;
    window.addEventListener("_cs", function(ev) {
      window.__csApi = window[ev.detail] || ev.detail;
    });
  `);

  runCode(prodCode);

  await new Promise((r) => setTimeout(r, 500));

  let challengeApi = vmCtx.__csApi;

  if (!challengeApi?.gc) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      challengeApi = vmCtx.__csApi;
      if (challengeApi?.gc) break;
      for (const key of Object.getOwnPropertyNames(vmCtx)) {
        try {
          const v = vmCtx[key];
          if (v && typeof v === "object" && typeof v.gc === "function" && typeof v.dr === "function") {
            challengeApi = v;
            break;
          }
        } catch {}
      }
      if (challengeApi?.gc) break;
    }
  }

  if (!challengeApi?.gc)
    throw new Error("challenge API not captured");

  const ss2 = vmCtx.__ss2_challenge;
  if (!ss2?.gc) throw new Error("stage2 challenge not available");

  const [tok1, tok2] = await Promise.all([challengeApi.gc(), ss2.gc()]);

  try { win.close(); } catch {}

  return {
    token: tok1 + "::c2::" + tok2 + "::c3::" + rToken,
    decrypt: challengeApi.dr?.bind(challengeApi),
  };
}

export async function cinesrcExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const encoded = encodeQuery(type, tmdbId, season, episode);
    const embedPath = isTV ? `/embed/tv/${tmdbId}` : `/embed/movie/${tmdbId}`;
    const searchStr = isTV ? `?s=${season}&e=${episode}` : "";
    const fullPath = embedPath + searchStr;

    const { r: rToken, p: pToken } = await callBootstrap(encoded);

    const { token: challenge, decrypt } = await solveChallenge(
      encoded, rToken, pToken, embedPath, searchStr,
    );

    const providers = await callAction(
      "00709a44ddb018c921339ab3213396ad85c0dc0237",
      [],
      fullPath,
    );

    if (!Array.isArray(providers) || !providers.length) return [];

    const top = providers
      .sort((a, b) => (b.rank || 0) - (a.rank || 0))
      .slice(0, 3);

    const results = [];
    for (const prov of top) {
      try {
        const args = isTV
          ? [String(tmdbId), "show", String(season), String(episode), challenge, prov.id]
          : [String(tmdbId), "movie", undefined, undefined, challenge, prov.id];

        const raw = await callAction(
          "7e278c7b1a4440a99a81b5c121b5f93193ce0a3f64",
          args,
          fullPath,
          { "x-cs-r": rToken, "x-cs-q": encoded, "x-cs-p": pToken },
        );

        if (!raw || raw === "e1:invalid_challenge") continue;

        let data;
        if (decrypt) {
          try { data = await decrypt(raw); } catch {
            data = typeof raw === "object" ? raw : null;
          }
        } else {
          data = typeof raw === "object" ? raw : null;
        }

        if (!data?.url) continue;

        const urls = Array.isArray(data.url) ? data.url : [data.url];
        for (const u of urls) {
          let streamUrl = typeof u === "string" ? u : u?.url || u?.source;
          if (!streamUrl) continue;
          if (streamUrl.startsWith("/")) streamUrl = BASE + streamUrl;
          results.push({
            url: streamUrl,
            type: streamUrl.includes(".m3u8") ? "hls" : "file",
            quality: u?.height ? `${u.height}p` : u?.quality || undefined,
            provider: "cinesrc",
            providerName: "CineSrc " + prov.name.replace(/[^\w\s]/g, "").trim(),
          });
        }
      } catch (e) {
        console.log(`[cinesrc] ${prov.id}:`, e.message);
      }
    }

    return results;
  } catch (e) {
    console.log("[cinesrc] error:", e.stack || e.message);
    return [];
  }
}

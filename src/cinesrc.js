import { createContext, runInContext } from "node:vm";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://cinesrc.st";

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

function buildSandbox(embedPath, searchStr, encoded, rToken, pToken) {
  const eventMap = {};
  const loadedScripts = new Map();

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
      h.set("Referer", BASE + embedPath);
      return fetch(url, { ...opts, headers: h });
    }

    if (!opts.headers) opts.headers = {};
    const h = new Headers(opts.headers);
    if (!h.has("User-Agent")) h.set("User-Agent", UA);
    if (!h.has("Referer")) h.set("Referer", BASE + "/");
    return fetch(url, { ...opts, headers: h });
  };

  const ctx = {
    console,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    queueMicrotask,
    Promise,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt64Array: globalThis.BigInt64Array,
    BigUint64Array: globalThis.BigUint64Array,
    ArrayBuffer,
    SharedArrayBuffer: globalThis.SharedArrayBuffer,
    DataView,
    Map,
    Set,
    WeakMap,
    WeakSet,
    WeakRef: globalThis.WeakRef,
    FinalizationRegistry: globalThis.FinalizationRegistry,
    Symbol,
    Proxy,
    Reflect,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    EvalError,
    AggregateError: globalThis.AggregateError,
    JSON,
    Math,
    Number,
    BigInt: globalThis.BigInt,
    String,
    Boolean,
    Array,
    Object,
    Function,
    RegExp,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    NaN,
    Infinity,
    undefined,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    btoa,
    atob,
    WebAssembly,
    crypto: globalThis.crypto,
    performance: globalThis.performance,
    structuredClone: globalThis.structuredClone,
    Blob: globalThis.Blob,
    File: globalThis.File,
    FileReader: globalThis.FileReader,
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    EventTarget: globalThis.EventTarget,

    navigator: { userAgent: UA, language: "en-US", languages: ["en-US", "en"] },

    location: {
      pathname: embedPath,
      search: searchStr,
      href: BASE + embedPath + searchStr,
      origin: BASE,
      host: "cinesrc.st",
      hostname: "cinesrc.st",
      protocol: "https:",
      port: "",
      hash: "",
    },

    fetch: patchedFetch,

    addEventListener(type, fn) {
      (eventMap[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      if (eventMap[type]) eventMap[type] = eventMap[type].filter((f) => f !== fn);
    },
    dispatchEvent(ev) {
      const t = ev?.type || ev;
      for (const fn of eventMap[t] || []) {
        try {
          fn(ev);
        } catch {}
      }
      return true;
    },

    CustomEvent: class CustomEvent {
      constructor(type, opts = {}) {
        this.type = type;
        this.detail = opts.detail ?? null;
      }
    },
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    MessageEvent: class MessageEvent {
      constructor(type, opts = {}) {
        this.type = type;
        this.data = opts.data;
      }
    },

    Worker: class SandboxWorker {
      constructor(url) {
        this._cbs = {};
        this._onmessage = null;
        this._ready = null;
        this._w = null;
        const self = this;

        const init = async () => {
          let scriptUrl =
            typeof url === "string"
              ? url.startsWith("/")
                ? BASE + url
                : url
              : url instanceof URL
                ? url.href
                : String(url);
          let code;
          if (scriptUrl.startsWith("blob:")) {
            code = await (await fetch(scriptUrl)).text();
          } else {
            code = await fetchScript(scriptUrl);
          }
          const { Worker: W } = await import("node:worker_threads");
          const shim = `
const{parentPort}=require("worker_threads");
const self={postMessage:(d)=>parentPort.postMessage(d),addEventListener:(e,fn)=>{if(e==="message")parentPort.on("message",data=>fn({data}));}};
globalThis.self=self;globalThis.postMessage=self.postMessage;globalThis.addEventListener=self.addEventListener;
globalThis.onmessage=null;
${code}
if(typeof globalThis.onmessage==="function")parentPort.on("message",data=>globalThis.onmessage({data}));`;
          self._w = new W(shim, { eval: true });
          self._w.on("message", (data) => {
            for (const fn of self._cbs.message || []) fn({ data });
            if (self._onmessage) self._onmessage({ data });
          });
          self._w.on("error", (e) => {
            for (const fn of self._cbs.error || []) fn(e);
          });
        };
        this._ready = init().catch((e) =>
          console.error("[worker init]", e.message),
        );
      }
      postMessage(data) {
        const go = () => {
          if (this._w) this._w.postMessage(data);
          else setTimeout(go, 5);
        };
        this._ready.then(go);
      }
      addEventListener(type, fn) {
        (this._cbs[type] ??= []).push(fn);
      }
      terminate() {
        this._w?.terminate();
      }
      set onmessage(fn) {
        this._onmessage = fn;
      }
      get onmessage() {
        return this._onmessage;
      }
    },

    document: {
      createElement(tag) {
        if (tag === "script") {
          const el = {
            tagName: "SCRIPT",
            src: "",
            dataset: {},
            async: false,
            noModule: false,
            type: "",
            textContent: "",
            crossOrigin: null,
            _evts: {},
            addEventListener(ev, fn, opts) {
              (el._evts[ev] ??= []).push({ fn, once: opts?.once });
            },
            removeEventListener(ev, fn) {
              if (el._evts[ev])
                el._evts[ev] = el._evts[ev].filter((h) => h.fn !== fn);
            },
            _fire(ev) {
              for (const h of el._evts[ev] || []) {
                try {
                  h.fn();
                } catch {}
              }
              el._evts[ev] = (el._evts[ev] || []).filter((h) => !h.once);
            },
            remove() {},
          };
          return el;
        }
        if (tag === "link")
          return {
            tagName: "LINK",
            rel: "",
            href: "",
            as: "",
            type: "",
            crossOrigin: "",
            dataset: {},
          };
        return { tagName: tag.toUpperCase(), style: {} };
      },
      head: {
        appendChild(el) {
          if (el.tagName !== "SCRIPT") return el;
          const src = el.src || el.dataset?.src;
          if (src) {
            loadedScripts.set(src, el);
            const url = src.startsWith("/") ? BASE + src : src;
            fetchScript(url)
              .then((code) => {
                try {
                  runInContext(code, vmCtx, { timeout: 30000 });
                } catch (e) {
                  console.error("[sandbox eval]", src, e.message);
                }
                el._fire("load");
              })
              .catch((e) => {
                console.error("[sandbox fetch]", src, e.message);
                el._fire("error");
              });
          } else if (el.textContent) {
            try {
              runInContext(el.textContent, vmCtx, { timeout: 5000 });
            } catch {}
          }
          return el;
        },
      },
      body: {
        appendChild(el) {
          return ctx.document.head.appendChild(el);
        },
      },
      querySelector(sel) {
        const m =
          sel.match(/script\[data-src="([^"]+)"\]/) ||
          sel.match(/script\[data-src\^="([^"]+)"\]/);
        if (m) {
          for (const [k, v] of loadedScripts) if (k.startsWith(m[1])) return v;
          return null;
        }
        return null;
      },
      querySelectorAll(sel) {
        const m = sel.match(/script\[data-src\^="([^"]+)"\]/);
        if (m) {
          const out = [];
          for (const [k, v] of loadedScripts) if (k.startsWith(m[1])) out.push(v);
          return out;
        }
        return [];
      },
      documentElement: { style: {} },
    },
  };

  ctx.self = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;

  let vmCtx;
  try {
    vmCtx = createContext(ctx);
  } catch {
    vmCtx = ctx;
  }

  return { ctx, vmCtx };
}

async function solveChallenge(encoded, rToken, pToken, embedPath, searchStr) {
  const { ctx, vmCtx } = buildSandbox(
    embedPath,
    searchStr,
    encoded,
    rToken,
    pToken,
  );

  const [donutCode, prodCode] = await Promise.all([
    fetchScript("/donut.js"),
    fetchScript("/300726c-prod.js"),
  ]);

  const run = (code) => {
    if (vmCtx !== ctx) {
      runInContext(code, vmCtx, { timeout: 30000 });
    } else {
      new Function(
        "window",
        "self",
        "globalThis",
        "document",
        "location",
        "fetch",
        "Worker",
        "addEventListener",
        "removeEventListener",
        "dispatchEvent",
        "navigator",
        "console",
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
        "Promise",
        "URL",
        "URLSearchParams",
        "WebAssembly",
        "crypto",
        "btoa",
        "atob",
        "TextEncoder",
        "TextDecoder",
        "Uint8Array",
        "ArrayBuffer",
        "DataView",
        "Headers",
        "Request",
        "Response",
        "Blob",
        "CustomEvent",
        "Event",
        "MessageEvent",
        "JSON",
        "Math",
        "Number",
        "String",
        "Array",
        "Object",
        "Function",
        "RegExp",
        "Date",
        "Map",
        "Set",
        "WeakMap",
        "WeakSet",
        "Symbol",
        "Proxy",
        "Reflect",
        "Error",
        "TypeError",
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "encodeURIComponent",
        "decodeURIComponent",
        "queueMicrotask",
        "performance",
        "AbortController",
        "AbortSignal",
        code,
      )(
        ctx,
        ctx,
        ctx,
        ctx.document,
        ctx.location,
        ctx.fetch,
        ctx.Worker,
        ctx.addEventListener,
        ctx.removeEventListener,
        ctx.dispatchEvent,
        ctx.navigator,
        ctx.console,
        ctx.setTimeout,
        ctx.setInterval,
        ctx.clearTimeout,
        ctx.clearInterval,
        ctx.Promise,
        ctx.URL,
        ctx.URLSearchParams,
        ctx.WebAssembly,
        ctx.crypto,
        ctx.btoa || btoa,
        ctx.atob || atob,
        TextEncoder,
        Uint8Array,
        ArrayBuffer,
        DataView,
        Headers,
        Request,
        Response,
        globalThis.Blob,
        ctx.CustomEvent,
        ctx.Event,
        ctx.MessageEvent,
        JSON,
        Math,
        Number,
        String,
        Array,
        Object,
        Function,
        RegExp,
        Date,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Symbol,
        Proxy,
        Reflect,
        Error,
        TypeError,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        queueMicrotask,
        globalThis.performance,
        AbortController,
        AbortSignal,
      );
    }
  };

  run(donutCode);
  await new Promise((r) => setTimeout(r, 200));

  const csPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("_cs timeout")), 20000);
    ctx.addEventListener("_cs", (ev) => {
      clearTimeout(t);
      resolve(ev?.detail || ev);
    });
  });

  run(prodCode);

  let challengeApi;
  try {
    challengeApi = await csPromise;
  } catch {
    // Fallback: poll for the module on common global names
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const candidate =
        ctx.__cs_module ||
        ctx._cs_api ||
        ctx.__cinesrc_challenge ||
        ctx.__challenge;
      if (candidate?.gc && candidate?.dr) {
        challengeApi = candidate;
        break;
      }
    }
  }

  if (!challengeApi?.gc)
    throw new Error("challenge API not captured from script");

  const ss2 = ctx.__ss2_challenge;
  if (!ss2?.gc) throw new Error("stage2 challenge not available");

  const [tok1, tok2] = await Promise.all([challengeApi.gc(), ss2.gc()]);

  return {
    token: tok1 + "::c2::" + tok2 + "::c3::" + rToken,
    decrypt: challengeApi.dr?.bind(challengeApi),
  };
}

export async function cinesrcExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const encoded = encodeQuery(type, tmdbId, season, episode);
    const embedPath = isTV
      ? `/embed/tv/${tmdbId}`
      : `/embed/movie/${tmdbId}`;
    const searchStr = isTV ? `?s=${season}&e=${episode}` : "";
    const fullPath = embedPath + searchStr;

    const { r: rToken, p: pToken } = await callBootstrap(encoded);

    const { token: challenge, decrypt } = await solveChallenge(
      encoded,
      rToken,
      pToken,
      embedPath,
      searchStr,
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
          ? [
              String(tmdbId),
              "show",
              String(season),
              String(episode),
              challenge,
              prov.id,
            ]
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
          try {
            data = await decrypt(raw);
          } catch {
            data = typeof raw === "object" ? raw : null;
          }
        } else {
          data = typeof raw === "object" ? raw : null;
        }

        if (!data?.url) continue;

        const urls = Array.isArray(data.url) ? data.url : [data.url];
        for (const u of urls) {
          const streamUrl = typeof u === "string" ? u : u?.url || u?.source;
          if (!streamUrl) continue;
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
    console.log("[cinesrc] error:", e.message);
    return [];
  }
}

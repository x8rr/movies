import vm from "node:vm";

// Hexa (hexa.su) backend. hexa.su itself now gates playback behind a Cap proof-of-work captcha
// with browser instrumentation, but its white-label mirror vidsrc.su talks to the very same
// backend (identical wasm + client module) on its own host without the captcha.
//
// Flow (from tmdb-image-enhancer.js): a wasm module (img_data) yields a 64-hex "api key"; each
// request is signed with HMAC-SHA256(key, `${key}:${serverTime}:${nonce}:${path}`); the
// response text is decrypted by the same wasm. The first call lists servers, then one call
// per server (X-Server header) returns that server's stream url.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SITE = "https://vidsrc.su";
const API = "https://themoviedb.vidsrc.su";
const PLAY_HEADERS = { Referer: SITE + "/", Origin: SITE };
const FINGERPRINT_LITE = "e9136c41504646444"; // constant the site's fetch wrapper adds
const WASM_TTL = 6 * 60 * 60 * 1000;

let wasmCache = null; // { at, promise }

// wasm-bindgen glue + binary are fetched together (import names are build-hashed) and run in a
// vm context with just enough of a browser for get_img_key's environment checks.
async function loadWasm() {
  const v = Date.now();
  const [glue, bin] = await Promise.all([
    fetch(`${API}/assets/wasm/img_data.js?v=${v}`, { headers: { "User-Agent": UA, Referer: SITE + "/" }, signal: AbortSignal.timeout(8000) }).then(
      (r) => {
        if (!r.ok) throw new Error("wasm glue " + r.status);
        return r.text();
      },
    ),
    fetch(`${API}/assets/wasm/img_data_bg.wasm?v=${v}`, { headers: { "User-Agent": UA, Referer: SITE + "/" }, signal: AbortSignal.timeout(8000) }).then(
      (r) => {
        if (!r.ok) throw new Error("wasm binary " + r.status);
        return r.arrayBuffer();
      },
    ),
  ]);

  class Window {}
  class CanvasRenderingContext2D {
    fillText() {}
  }
  class HTMLCanvasElement {
    width = 300;
    height = 150;
    getContext() {
      return new CanvasRenderingContext2D();
    }
    toDataURL() {
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAYAAABkW7XSAAAAAXNSR0IArs4c6QAAA";
    }
  }
  const store = new Map();
  const start = performance.now();
  const win = Object.assign(new Window(), {
    document: {
      createElement: (t) => (t === "canvas" ? new HTMLCanvasElement() : {}),
      getElementsByTagName: () => ({ length: 1 }),
    },
    navigator: { userAgent: UA, platform: "Win32", language: "en-US" },
    screen: { width: 1920, height: 1080, colorDepth: 24 },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    // get_img_key rejects (E24) a page that has only been alive for a few ms
    performance: { now: () => performance.now() - start + 8000 },
    Window,
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    TextDecoder,
    TextEncoder,
    WebAssembly,
    Promise,
    Date,
    Math,
    Function,
    queueMicrotask,
    console: { log() {}, warn() {}, error() {} },
  });
  win.window = win.self = win.globalThis = win;
  const code = glue
    .replace(/^export function /gm, "function ")
    .replace(/^export (\{[^}]*\}|default [^;\n]*);?$/gm, "")
    .replace(/import\.meta\.url/g, JSON.stringify(API + "/assets/wasm/"));
  const ctx = vm.createContext(win);
  vm.runInContext(code + "\n;globalThis.__wasm = { initSync, get_img_key, process_img_data };", ctx, { timeout: 5000 });
  const m = win.__wasm;
  // a bare Module: an outer-realm `{ module }` literal fails the glue's Object.prototype check
  m.initSync(new WebAssembly.Module(bin));
  return m;
}

function getWasm() {
  if (!wasmCache || Date.now() - wasmCache.at > WASM_TTL) {
    const promise = loadWasm();
    wasmCache = { at: Date.now(), promise };
    promise.catch(() => (wasmCache = null));
  }
  return wasmCache.promise;
}

async function serverTime() {
  try {
    const r = await fetch(`${API}/api/time?t=${Date.now()}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
    const { timestamp } = await r.json();
    if (typeof timestamp === "number") return timestamp;
  } catch {}
  return Math.floor(Date.now() / 1000);
}

async function signedHeaders(key, path, ts) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
    .toString("base64")
    .replace(/[/+=]/g, "")
    .slice(0, 22);
  const enc = new TextEncoder();
  const hmac = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", hmac, enc.encode(`${key}:${ts}:${nonce}:${path}`))).toString("base64");
  return {
    "User-Agent": UA,
    Accept: "text/plain",
    Origin: SITE,
    Referer: SITE + "/",
    "X-Api-Key": key,
    "X-Request-Timestamp": String(ts),
    "X-Request-Nonce": nonce,
    "X-Request-Signature": sig,
    "X-Client-Fingerprint": Math.abs(Math.floor(Math.random() * 2 ** 31)).toString(36),
    "x-fingerprint-lite": FINGERPRINT_LITE,
  };
}

export async function hexaExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const path = isTV ? `/api/tmdb/tv/${tmdbId}/season/${season}/episode/${episode}/images` : `/api/tmdb/movie/${tmdbId}/images`;
    const [wasm, ts] = await Promise.all([getWasm(), serverTime()]);
    const key = wasm.get_img_key();
    if (typeof key !== "string" || key.length !== 64) throw new Error("bad wasm key");

    const call = async (extra) => {
      const r = await fetch(API + path, { headers: { ...(await signedHeaders(key, path, ts)), ...extra }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`api ${r.status}`);
      return JSON.parse(await wasm.process_img_data(await r.text(), key));
    };

    const list = await call({ bW90aGFmYWth: "1" });
    const servers = list?.servers && Object.keys(list.servers).length ? Object.keys(list.servers) : (list?.sources || []).map((s) => s?.server).filter(Boolean);
    if (!servers.length) return [];

    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          const data = await call({ "X-Only-Sources": "1", "X-Server": server });
          const src = Array.isArray(data?.sources) ? data.sources.find((s) => s?.server === server) || data.sources[0] : data?.sources;
          const url = src?.url || src?.file;
          if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
          return {
            url,
            type: /\.mp4(\?|$)/i.test(url) ? "file" : "hls",
            provider: "hexa",
            providerName: "Hexa " + server[0].toUpperCase() + server.slice(1),
            headers: PLAY_HEADERS,
          };
        } catch {
          return null; // per-server failures (e.g. wasm E56-E58 = no source) are normal
        }
      }),
    );
    return results.filter(Boolean);
  } catch (e) {
    // the wasm throws bare error codes ("E24"), not Error objects
    console.log("[hexa] error:", e?.message ?? e);
    return [];
  }
}

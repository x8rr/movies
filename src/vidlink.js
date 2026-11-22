import vm from "node:vm";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidlink.pro";
const SANDBOX_TTL = 60 * 60 * 1000;
// webpack module id of libsodium-wrappers inside vidlink's Next.js bundle
const SODIUM_MODULE = "73551";

let _sandbox = null;
let _sandboxExpiry = 0;

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Referer: BASE + "/" } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}

// fu.wasm is a Go (js/wasm) program that, once running, exposes window.getAdv(tmdbId)
// which produces the encrypted id the /api/b endpoints require. It uses window.sodium
// (libsodium-wrappers from the site's own bundle) and Go's standard wasm_exec runtime.
async function goRuntime(wasm) {
  const ver = new TextDecoder("latin1").decode(wasm).match(/go1\.\d+(?:\.\d+)?/)?.[0];
  if (!ver) throw new Error("go version not found in fu.wasm");
  const minor = Number(ver.split(".")[1]);
  const path = minor >= 24 ? "lib/wasm/wasm_exec.js" : "misc/wasm/wasm_exec.js";
  return getText(`https://cdn.jsdelivr.net/gh/golang/go@${ver}/${path}`);
}

async function buildSandbox() {
  const html = await getText(`${BASE}/movie/550`);
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[\w%./-]+?\.js/g) || [])].filter(
    (p) => !/\/(webpack|polyfills|main-app)-/.test(p),
  );
  const [wasm, sources] = await Promise.all([
    fetch(`${BASE}/fu.wasm`, { headers: { "User-Agent": UA, Referer: BASE + "/" } }).then((r) => {
      if (!r.ok) throw new Error(`fu.wasm HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
    Promise.all(chunks.map((p) => getText(BASE + p))),
  ]);
  const wasmExec = await goRuntime(new Uint8Array(wasm));

  const modules = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    TextEncoder, TextDecoder, crypto, performance, setTimeout, clearTimeout,
    setInterval, clearInterval, WebAssembly, atob, btoa, Date, Uint8Array, Array,
    Object, JSON, Math, String, Number, Error, Promise, Reflect,
  };
  ctx.self = ctx.window = ctx.globalThis = ctx;
  ctx.webpackChunk_N_E = { push: ([, mods]) => Object.assign(modules, mods) };
  vm.createContext(ctx);
  for (const src of sources) {
    try {
      vm.runInContext(src, ctx);
    } catch {}
  }
  if (!modules[SODIUM_MODULE]) throw new Error("sodium module not found in bundle");

  const cache = {};
  const req = (id) => {
    if (cache[id]) return cache[id].exports;
    if (!modules[id]) throw new Error("missing webpack module " + id);
    const m = (cache[id] = { exports: {} });
    modules[id].call(m.exports, m, m.exports, req);
    return m.exports;
  };
  req.d = (e, d) => {
    for (const k in d) Object.defineProperty(e, k, { enumerable: true, get: d[k] });
  };
  req.n = (m) => (m && m.__esModule ? () => m.default : () => m);
  req.g = ctx;
  req.o = (o, p) => Object.prototype.hasOwnProperty.call(o, p);
  req.r = (e) => Object.defineProperty(e, "__esModule", { value: true });

  const sodium = req.n(req(SODIUM_MODULE))();
  await sodium.ready;
  ctx.sodium = sodium;

  vm.runInContext(wasmExec, ctx);
  const go = new ctx.Go();
  const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
  go.run(instance);
  for (let i = 0; i < 50 && typeof ctx.getAdv !== "function"; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (typeof ctx.getAdv !== "function") throw new Error("getAdv not exposed by fu.wasm");
  return ctx.getAdv;
}

function getEncoder() {
  if (!_sandbox || Date.now() > _sandboxExpiry) {
    _sandboxExpiry = Date.now() + SANDBOX_TTL;
    _sandbox = buildSandbox().catch((e) => {
      _sandbox = null;
      throw e;
    });
  }
  return _sandbox;
}

export async function vidlinkExtract(type, tmdbId, season, episode) {
  try {
    const getAdv = await getEncoder();
    const enc = getAdv(String(tmdbId));
    if (!enc) return [];
    const api =
      type === "tv"
        ? `${BASE}/api/b/tv/${enc}/${season}/${episode}?multiLang=0`
        : `${BASE}/api/b/movie/${enc}?multiLang=0`;
    const page = type === "tv" ? `${BASE}/tv/${tmdbId}/${season}/${episode}` : `${BASE}/movie/${tmdbId}`;
    const r = await fetch(api, {
      headers: { "User-Agent": UA, Referer: page, "X-Playback-Environment": "standard" },
    });
    if (!r.ok) throw new Error(`api HTTP ${r.status}`);
    const stream = (await r.json())?.stream;
    if (!stream) return [];

    const base = { provider: "vidlink", providerName: "VidLink" };
    // The MovieBox CDN (*.hakunaymatata.com) answers 428 to browser UAs and 429 whenever a
    // Referer header is present at all, so the proxy must send a non-browser UA and no Referer
    // (null = "don't send"). Most of its files are HEVC, which only plays where the browser decodes h265.
    const withHeaders = (url, h, codec) => {
      const out = /^(hevc|h265|hvc1|hev1)$/i.test(codec || "") ? { providerName: "VidLink (HEVC)" } : {};
      if (/\.hakunaymatata\.com$/.test(new URL(url).hostname)) {
        return { ...out, headers: { ...h, "User-Agent": "okhttp/4.12.0", Referer: null } };
      }
      return h && Object.keys(h).length ? { ...out, headers: h } : out;
    };
    if (stream.type === "hls" && stream.playlist) {
      return [{ ...base, url: stream.playlist, type: "hls", ...withHeaders(stream.playlist, stream.headers) }];
    }
    if (stream.type === "file" && stream.qualities) {
      return Object.entries(stream.qualities)
        .filter(([, q]) => q?.url)
        .sort(([a], [b]) => (parseInt(b) || 0) - (parseInt(a) || 0))
        .map(([q, v]) => ({
          ...base,
          url: v.url,
          type: "file",
          quality: /^\d+$/.test(q) ? `${q}p` : q,
          ...withHeaders(v.url, { ...stream.headers, ...v.headers }, v.codecName),
        }));
    }
    return [];
  } catch (e) {
    console.log("[vidlink] error:", e.message);
    return [];
  }
}

import sodium from "libsodium-wrappers-sumo";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidlink.pro";
const PROXY = "https://surge.flooderrr.store";

let _goReady = null;

function copyArg(v) {
  if (ArrayBuffer.isView(v)) return new v.constructor(v);
  return v;
}

function wrapSodium(s) {
  return new Proxy(s, {
    get(target, prop) {
      const val = target[prop];
      if (typeof val === "function") {
        return (...args) => val.apply(target, args.map(copyArg));
      }
      return val;
    },
  });
}

async function ensureGo() {
  if (_goReady) return _goReady;
  _goReady = (async () => {
    const [runtimeCode, wasmBuf] = await Promise.all([
      fetch(BASE + "/script.js", { headers: { "User-Agent": UA } }).then((r) => r.text()),
      fetch(BASE + "/fu.wasm", { headers: { "User-Agent": UA } }).then((r) => r.arrayBuffer()),
    ]);

    await sodium.ready;
    globalThis.sodium = wrapSodium(sodium);

    new Function(runtimeCode)();

    const go = new globalThis.Dm();
    const { instance } = await WebAssembly.instantiate(wasmBuf, go.importObject);
    go.run(instance);

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (globalThis.getAdv) return;
    }
    _goReady = null;
    throw new Error("getAdv never registered");
  })();
  return _goReady;
}

function proxyUrl(rawUrl, headers) {
  const parsed = new URL(rawUrl);
  const h = headers
    ? JSON.stringify(Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))))
    : "{}";
  const qs = new URLSearchParams(parsed.search);
  qs.set("host", parsed.origin);
  qs.set("headers", h);
  return `${PROXY}/mp${parsed.pathname}?${qs}`;
}

function extractStreams(data) {
  if (!data?.stream) return [];
  const s = data.stream;
  const results = [];

  if (s.playlist) {
    let url = s.playlist;
    if (s.requiresProxy && PROXY) {
      const parsed = new URL(url);
      const h = s.playlistHeaders
        ? JSON.stringify(Object.fromEntries(Object.entries(s.playlistHeaders).sort(([a], [b]) => a.localeCompare(b))))
        : "{}";
      const qs = new URLSearchParams({ headers: h, host: parsed.origin });
      const prefix = s.deliveryType === "dash" ? "/sacdn" : "/proxy";
      url = `${PROXY}${prefix}${parsed.pathname}?${qs}`;
    }
    results.push({
      url,
      type: s.deliveryType === "dash" ? "dash" : "hls",
      provider: "vidlink",
      providerName: "VidLink",
    });
  }

  if (s.qualities && typeof s.qualities === "object") {
    for (const [q, info] of Object.entries(s.qualities)) {
      if (!info?.url || info.type !== "mp4") continue;
      results.push({
        url: info.requiresProxy ? proxyUrl(info.url, info.headers) : info.url,
        type: "file",
        quality: q.includes("p") ? q : q + "p",
        provider: "vidlink",
        providerName: "VidLink",
      });
    }
  }

  return results;
}

export async function vidlinkExtract(type, tmdbId, season, episode) {
  try {
    await ensureGo();
    const token = globalThis.getAdv(String(tmdbId));
    if (!token) throw new Error("getAdv returned nothing");

    const isTV = type !== "movie";
    const path = isTV
      ? `/api/b/tv/${token}/${season}/${episode}?multiLang=0`
      : `/api/b/movie/${token}?multiLang=0`;

    const resp = await fetch(BASE + path, {
      headers: {
        "User-Agent": UA,
        Referer: BASE + "/",
        "X-Playback-Environment": "standard",
      },
    });

    if (!resp.ok) throw new Error("api " + resp.status);
    const data = JSON.parse(await resp.text());
    return extractStreams(data);
  } catch (e) {
    console.log("[vidlink] error:", e.message);
    return [];
  }
}

// AutoEmbed (autoembed.me). Its player iframes a "vaplayer" page on a rotating host
// (va_src.php hands out the current URL with a ?va= gate token). That page embeds a
// single-use, IP-bound apiToken; the stream-data API answers with stream_urls encrypted by a
// tiny import-free wasm module it ships alongside. Each stream host then trades the same
// apiToken at /generate.php for a playback token that must be on EVERY request (master,
// variants, segments) as ?token= — the proxy carries it from the master URL to children.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PLAYER = "https://player.autoembed.me";

const wasmCache = new Map(); // wasm_url or inline-hash -> Promise<WebAssembly.Module>

function decryptModule(va) {
  const key = va.wasm_url || va.w || va.wasm?.slice(0, 64);
  if (!key) throw new Error("no decrypt module");
  if (!wasmCache.has(key)) {
    const p = va.wasm_url
      ? fetch(va.wasm_url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) }).then((r) => {
          if (!r.ok) throw new Error("wasm " + r.status);
          return r.arrayBuffer().then((b) => WebAssembly.compile(b));
        })
      : WebAssembly.compile(Buffer.from(va.wasm, "base64"));
    p.catch(() => wasmCache.delete(key));
    wasmCache.set(key, p);
  }
  return wasmCache.get(key);
}

async function decryptStreamUrls(va, b64) {
  const inst = await WebAssembly.instantiate(await decryptModule(va), {});
  const ex = inst.exports;
  const enc = Buffer.from(b64, "base64");
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const len = ex.decrypt(ptr, enc.length);
  // output = plaintext after the 12-byte nonce, in place
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr + 12, len)).split("\n").filter(Boolean);
}

function parseToken(text) {
  const t = String(text || "").trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t);
      return typeof j === "string" ? j : j?.token || j?.data || j?.string || j?.result || "";
    } catch {}
  }
  return t;
}

export async function autoembedExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const path = isTV ? `/embed/tv/${tmdbId}/${season}/${episode}` : `/embed/movie/${tmdbId}`;

    const srcResp = await fetch(`${PLAYER}/embed/va_src.php?path=${encodeURIComponent(path)}`, {
      headers: { "User-Agent": UA, Referer: PLAYER + path },
      signal: AbortSignal.timeout(6000),
    });
    if (!srcResp.ok) throw new Error("va_src " + srcResp.status);
    const { src } = await srcResp.json();
    if (!src) throw new Error("no player url");
    const origin = new URL(src).origin;
    const hostHeaders = { "User-Agent": UA, Referer: origin + "/", Origin: origin };

    const page = await fetch(src, { headers: { "User-Agent": UA, Referer: PLAYER + "/" }, signal: AbortSignal.timeout(6000) }).then((r) => r.text());
    const cfgJson = page.match(/const CONFIG = (\{.*?\});\s*\n/s)?.[1];
    if (!cfgJson) throw new Error("no player config");
    const cfg = JSON.parse(cfgJson);
    if (cfg.rateLimited) throw new Error("rate limited");
    if (!cfg.apiToken || !cfg.streamDataApiUrl) throw new Error("no api token");

    const q = `tmdb=${tmdbId}&type=${isTV ? "tv" : "movie"}${isTV ? `&season=${season}&episode=${episode}` : ""}`;
    const apiUrl = `${cfg.streamDataApiUrl}?${q}&stream_urls&api_token=${encodeURIComponent(cfg.apiToken)}`;
    const j = await fetch(apiUrl, { headers: { ...hostHeaders, Accept: "application/json" }, signal: AbortSignal.timeout(6000) }).then((r) => r.json());
    if (String(j?.status_code) !== "200" || !j.data) throw new Error(`api ${j?.status_code} ${j?.error || ""}`.trim());

    let urls = j.data.stream_urls;
    const va = j.vp || j.va;
    if (typeof urls === "string" && va) urls = await decryptStreamUrls(va, urls);
    if (!Array.isArray(urls) || !urls.length) return [];

    const quality = j.data.file_name?.match(/\b(2160|1080|720|480)p\b/)?.[0];
    const tokens = new Map(); // one generate.php token per stream host
    const tokenFor = (o) => {
      if (!tokens.has(o)) {
        tokens.set(
          o,
          fetch(`${o}/generate.php?api_token=${encodeURIComponent(cfg.apiToken)}`, { headers: hostHeaders, signal: AbortSignal.timeout(5000) })
            .then((r) => (r.ok ? r.text() : ""))
            .then(parseToken)
            .catch(() => ""),
        );
      }
      return tokens.get(o);
    };

    const streams = await Promise.all(
      urls
        .filter((u) => /^https?:\/\//.test(u))
        .map(async (u, i) => {
          const tk = await tokenFor(new URL(u).origin);
          const url = !tk ? u : u.includes("__TOKEN__") ? u.split("__TOKEN__").join(tk) : u + (u.includes("?") ? "&" : "?") + "token=" + tk;
          return {
            url,
            type: /\.mp4(\?|$)/i.test(u) ? "file" : "hls",
            provider: "autoembed",
            providerName: `AutoEmbed ${i + 1}`,
            ...(quality ? { quality } : {}),
            headers: { Referer: origin + "/", Origin: origin },
          };
        }),
    );
    return streams;
  } catch (e) {
    console.log("[autoembed] error:", e.message);
    return [];
  }
}

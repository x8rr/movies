import { cinesrcExtract } from "./cinesrc.js";
import { vidsparkExtract } from "./vidspark.js";
import { vixsrcExtract } from "./vixsrc.js";
import { vidzeeExtract } from "./vidzee.js";
import { vidrockExtract } from "./vidrock.js";
import { twoembedExtract } from "./twoembed.js";
import { vidfastExtract } from "./vidfast.js";
import { vidcoreExtract } from "./vidcore.js";
import { vidupExtract } from "./vidup.js";
import { vidnestExtract } from "./vidnest.js";
import { vidlinkExtract } from "./vidlink.js";
import { vidprimeExtract } from "./vidprime.js";
import { hexaExtract } from "./hexa.js";
import { xpassExtract } from "./xpass.js";
import { autoembedExtract } from "./autoembed.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const wasmCache = new Map();

async function getWasmModule(vs) {
  if (vs.wasm_url) {
    const key = `u:${vs.w ?? vs.wasm_url}`;
    if (!wasmCache.has(key)) {
      wasmCache.set(
        key,
        fetch(vs.wasm_url, { credentials: "omit" })
          .then((r) => r.arrayBuffer())
          .then((b) => WebAssembly.compile(b)),
      );
    }
    return wasmCache.get(key);
  }
  if (vs.wasm) {
    const key = `b:${vs.w ?? Math.random()}`;
    if (!wasmCache.has(key)) {
      const bin = Buffer.from(vs.wasm, "base64");
      wasmCache.set(key, WebAssembly.compile(bin));
    }
    return wasmCache.get(key);
  }
  return null;
}

async function decryptStreamUrls(encB64, vs) {
  const mod = await getWasmModule(vs);
  if (!mod) return null;
  const inst = await WebAssembly.instantiate(mod, {});
  const { alloc, decrypt, memory } = inst.exports;
  const enc = Buffer.from(encB64, "base64");
  const ptr = alloc(enc.length);
  new Uint8Array(memory.buffer, ptr, enc.length).set(enc);
  const outLen = decrypt(ptr, enc.length);
  const text = new TextDecoder().decode(
    new Uint8Array(memory.buffer, ptr + 12, outLen),
  );
  return text.split("\n").filter(Boolean);
}

async function vidsrcFetch(url, referer) {
  return fetch(url, {
    headers: { "User-Agent": UA, Referer: referer },
  });
}

async function vidsrcExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const srcPath = isTV
      ? `${tmdbId}/${season}/${episode}`
      : String(tmdbId);

    const apiResp = await vidsrcFetch(
      `https://vidsrc.sh/vs_src.php?type=${isTV ? "tv" : "movie"}&id=${srcPath}`,
      "https://vidsrc.sh/",
    );
    const srcText = await apiResp.text();
    let src;
    try {
      ({ src } = JSON.parse(srcText));
    } catch {
      throw new Error(`vs_src ${apiResp.status} returned non-JSON`);
    }
    if (!src) return [];

    const landResp = await vidsrcFetch(src, "https://vidsrc.sh/");
    const landHtml = await landResp.text();
    const cfgMatch = landHtml.match(/window\.CFG\s*=\s*(\{[^}]+\})/);
    if (!cfgMatch) return [];
    const cfg = JSON.parse(cfgMatch[1]);
    const origin = new URL(src).origin;

    const playerResp = await vidsrcFetch(origin + cfg.playerUrl, origin + "/");
    const playerHtml = await playerResp.text();
    const configMatch = playerHtml.match(/window\.CONFIG\s*=\s*(\{.*?\});/s);
    if (!configMatch) return [];
    const config = JSON.parse(configMatch[1]);
    if (config.rateLimited) throw new Error("rate limited");
    if (!config.apiToken) return [];

    let streamApiUrl;
    if (isTV) {
      streamApiUrl = `https://data.vidsrc.sh/api.php?type=tv&tmdb=${tmdbId}&season=${season}&episode=${episode}&stream_urls&api_token=${encodeURIComponent(config.apiToken)}`;
    } else {
      streamApiUrl = `https://data.vidsrc.sh/api.php?type=movie&tmdb=${tmdbId}&stream_urls&api_token=${encodeURIComponent(config.apiToken)}`;
    }

    const streamResp = await vidsrcFetch(streamApiUrl, origin + "/");
    const json = await streamResp.json();
    if (String(json.status_code) !== "200" || !json.data) return [];

    let urls;
    if (typeof json.data.stream_urls === "string" && json.vs) {
      urls = await decryptStreamUrls(json.data.stream_urls, json.vs);
      if (!urls) return [];
    } else if (Array.isArray(json.data.stream_urls)) {
      urls = json.data.stream_urls;
    } else {
      return [];
    }

    // each stream host mints an IP-bound segment token; it only does so for the
    // requester that was granted stream_urls, proven by forwarding the api_token
    const hostTokens = new Map();
    for (const u of urls) {
      const host = new URL(u).origin;
      if (!hostTokens.has(host)) {
        hostTokens.set(
          host,
          fetch(`${host}/generate.php?api_token=${encodeURIComponent(config.apiToken)}`, {
            headers: { "User-Agent": UA, Accept: "application/json", Origin: origin, Referer: origin + "/" },
          })
            .then((r) => (r.ok ? r.text() : ""))
            .then((t) => {
              try {
                const j = JSON.parse(t);
                return typeof j === "string"
                  ? j
                  : j.token || j.data || j.string || j.result || "";
              } catch {
                return t.trim();
              }
            })
            .catch(() => ""),
        );
      }
    }

    const results = [];
    for (const rawUrl of urls) {
      const host = new URL(rawUrl).origin;
      const token = await hostTokens.get(host);
      let url = rawUrl;
      if (token && url.includes("__TOKEN__")) url = url.split("__TOKEN__").join(token);
      else if (token) url += (url.includes("?") ? "&" : "?") + "token=" + token;
      results.push({
        url,
        // static playlists live at suffix-less /pl/<id> paths
        type: /\.(mp4|mkv)(\?|$)/i.test(rawUrl) ? "file" : "hls",
        provider: "vidsrc",
        providerName: "VidSrc",
        headers: { Referer: origin + "/", Origin: origin },
      });
    }
    return results;
  } catch (e) {
    console.log("[vidsrc] error:", e.message);
    return [];
  }
}

// a single slow provider must not hold up the response
const PROVIDER_TIMEOUT = 15000;
// once something is found, wait this much longer for the rest
const GRACE_AFTER_FIRST = 6000;
const HARD_DEADLINE = 18000;
const CHECK_TIMEOUT = 6000;
// smaller than any real media segment; dead hosts often swap segments for 1x1 PNGs
const MIN_SEGMENT_BYTES = 1024;

function firstNonEmpty(...extractors) {
  return async (...args) => {
    for (const extract of extractors) {
      const streams = await extract(...args);
      if (streams.length) return streams;
    }
    return [];
  };
}

const PROVIDERS = [
  // autoembed.me is a second front door to vidsrc.sh's backend (same files, same hosts),
  // so it's only asked when vidsrc itself comes back empty
  { id: "vidsrc", name: "VidSrc", extract: firstNonEmpty(vidsrcExtract, autoembedExtract) },
  { id: "cinesrc", name: "CineSrc", extract: cinesrcExtract },
  { id: "vidspark", name: "VidSpark", extract: vidsparkExtract },
  { id: "vixsrc", name: "VixSrc", extract: vixsrcExtract },
  { id: "vidzee", name: "VidZee", extract: vidzeeExtract },
  { id: "vidrock", name: "VidRock", extract: vidrockExtract },
  { id: "twoembed", name: "2Embed", extract: twoembedExtract },
  { id: "vidnest", name: "VidNest", extract: vidnestExtract },
  { id: "hexa", name: "Hexa", extract: hexaExtract },
  { id: "vidprime", name: "VidPrime", extract: vidprimeExtract },
  { id: "xpass", name: "XPass", extract: xpassExtract },
  // vidfast/vidcore/vidup are one backend behind three domains, each needing a
  // ~150MB sandbox — try them one at a time so a rate limit on one isn't fatal
  {
    id: "vidfast",
    name: "VidFast",
    extract: firstNonEmpty(vidfastExtract, vidcoreExtract, vidupExtract),
    timeout: HARD_DEADLINE,
  },
  // MovieBox mp4s, mostly HEVC (labelled), so they sit late in the fallback order
  { id: "vidlink", name: "VidLink", extract: vidlinkExtract },
];


function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((r) => (timer = setTimeout(() => r([]), ms))),
  ]).finally(() => clearTimeout(timer));
}

// Absolute URL for a playlist entry. Some hosts put a `token` only on the master URL and
// expect it on every child request, so it's carried over (the proxy does the same).
export function childUrl(ref, base, token) {
  let abs = new URL(ref, base).href;
  if (token && !abs.includes("token=")) abs += (abs.includes("?") ? "&" : "?") + "token=" + token;
  return abs;
}

async function looksLikeMedia(r) {
  if (!r.ok || !r.body) return false;
  const reader = r.body.getReader();
  const chunks = [];
  let n = 0;
  while (n < MIN_SEGMENT_BYTES) {
    const c = await reader.read();
    if (c.done) break;
    chunks.push(c.value);
    n += c.value.length;
  }
  reader.cancel().catch(() => {});
  if (n < MIN_SEGMENT_BYTES) return false;
  const head = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, 32)).trimStart();
  return !head.startsWith("<") && !head.startsWith("{");
}

// Headers for a request to a stream host: browser-ish defaults, overridden by the stream's
// own `headers` (case-insensitively). A null value drops the header altogether.
export function upstreamHeaders(url, extra = {}) {
  const out = { "User-Agent": UA, Referer: new URL(url).origin + "/" };
  for (const [k, v] of Object.entries(extra)) {
    for (const have of Object.keys(out)) if (have.toLowerCase() === k.toLowerCase()) delete out[have];
    if (v !== null) out[k] = v;
  }
  return out;
}

// Requests are made like the proxy makes them, so "alive" means playable through it.
// HLS is followed master -> media playlist -> first segment: hosts that pulled a title
// often keep serving its playlists while the segments are gone or replaced.
async function isAlive(stream) {
  const signal = AbortSignal.timeout(CHECK_TIMEOUT);
  const get = (url, extra) => fetch(url, { headers: { ...upstreamHeaders(url, stream.headers), ...extra }, signal });
  try {
    if (stream.type !== "hls") {
      const r = await get(stream.url, { Range: "bytes=0-0" });
      r.body?.cancel();
      return r.ok && !(r.headers.get("content-type") || "").includes("text/html");
    }
    let url = stream.url;
    for (let depth = 0; depth < 3; depth++) {
      const r = await get(url);
      const text = r.ok ? await r.text() : "";
      if (!text.trimStart().startsWith("#EXTM3U")) return false;
      const ref = text
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#"));
      if (!ref) return false;
      const next = childUrl(ref, r.url || url, new URL(url).searchParams.get("token"));
      if (!text.includes("#EXT-X-STREAM-INF")) return await looksLikeMedia(await get(next));
      url = next;
    }
    return false;
  } catch {
    return false;
  }
}

// tasks: [{ id, extract }] — runs all in parallel, returns live streams in task order.
// Streams count as soon as their own liveness check passes, so one slow host doesn't
// hold back the rest of its provider. Returns early once the grace window after the
// first live stream passes; onSettled gets the full set when the stragglers finish.
export async function scrapeAll(type, tmdbId, season, episode, tasks = PROVIDERS, onSettled) {
  // slots[task][stream]: the stream once verified, false once it failed, undefined while checking
  const slots = tasks.map(() => []);
  let onLive = () => {};
  const pending = tasks.map((p, i) =>
    withTimeout(
      Promise.resolve()
        .then(() => p.extract(type, tmdbId, season, episode))
        .then((streams) =>
          Promise.all(
            streams.map(async (s, j) => {
              slots[i][j] = (await isAlive(s)) && s;
              if (slots[i][j]) onLive();
            }),
          ),
        )
        .catch(() => {}),
      p.timeout ?? PROVIDER_TIMEOUT,
    ),
  );

  const collect = () => slots.flatMap((s) => s.filter(Boolean));
  if (onSettled) Promise.all(pending).then(() => onSettled(collect()));

  await new Promise((resolve) => {
    let grace = null;
    const hard = setTimeout(resolve, HARD_DEADLINE);
    const done = () => {
      clearTimeout(hard);
      clearTimeout(grace);
      resolve();
    };
    Promise.all(pending).then(done);
    onLive = () => (grace ??= setTimeout(done, GRACE_AFTER_FIRST));
  });

  return collect();
}

export { PROVIDERS };

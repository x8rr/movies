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
    const { src } = await apiResp.json();
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

    const hostTokens = new Map();
    for (const u of urls) {
      const host = new URL(u).origin;
      if (!hostTokens.has(host)) {
        hostTokens.set(
          host,
          fetch(host + "/generate.php", {
            headers: { "User-Agent": UA, Accept: "application/json" },
          })
            .then((r) => r.text())
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
      const url = token
        ? rawUrl + (rawUrl.includes("?") ? "&" : "?") + "token=" + token
        : rawUrl;
      results.push({
        url,
        type: rawUrl.includes(".m3u8") ? "hls" : "file",
        provider: "vidsrc",
        providerName: "VidSrc",
      });
    }
    return results;
  } catch (e) {
    console.log("[vidsrc] error:", e.message);
    return [];
  }
}

const PROVIDERS = [
  { id: "vidsrc", name: "VidSrc", extract: vidsrcExtract },
];

export async function scrapeAll(type, tmdbId, season, episode) {
  const results = await Promise.allSettled(
    PROVIDERS.map((p) => p.extract(type, tmdbId, season, episode)),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export { PROVIDERS };

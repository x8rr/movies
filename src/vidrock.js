import crypto from "node:crypto";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidrock.net";
const PLAY_HEADERS = { Referer: BASE + "/", Origin: BASE };
const KEY = Buffer.from("7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f", "hex");

function decryptUrl(enc) {
  const buf = Buffer.from(enc, "base64url");
  if (buf.length < 28) throw new Error("ciphertext too short");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString("utf8");
}

async function expandJsonSource(url, name, headers) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!(r.headers.get("content-type") || "").includes("application/json")) return null;
    const list = await r.json();
    if (!Array.isArray(list) || !list[0]?.resolution || !list[0]?.url) return null;
    return list
      .sort((a, b) => b.resolution - a.resolution)
      .map((q) => ({
        url: q.url,
        type: /\.m3u8/i.test(q.url) ? "hls" : "file",
        quality: q.resolution + "p",
        provider: "vidrock",
        providerName: "VidRock " + name,
        headers: PLAY_HEADERS,
      }));
  } catch {
    return null;
  }
}

export async function vidrockExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const path = isTV ? `tv/${tmdbId}/${season}/${episode}` : `movie/${tmdbId}`;
    const headers = { "User-Agent": UA, Referer: `${BASE}/${path}`, Origin: BASE };

    const resp = await fetch(`${BASE}/api/${path}`, { headers, signal: AbortSignal.timeout(12000) });
    if (!resp.ok) throw new Error("api " + resp.status);
    const data = await resp.json();

    const lists = await Promise.all(
      Object.entries(data || {}).map(async ([name, src]) => {
        if (!src?.url) return [];
        let url;
        try {
          url = decryptUrl(src.url);
        } catch {
          return [];
        }
        if (!/^https?:\/\//.test(url)) return [];
        const label = src.language && src.language !== "English" ? `${name} (${src.language})` : name;
        if (src.type !== "hls" && !/\.(mp4|mkv|m3u8)(\?|$)/i.test(url)) {
          const expanded = await expandJsonSource(url, label, headers);
          if (expanded) return expanded;
        }
        return [
          {
            url,
            type: src.type === "mp4" ? "file" : "hls",
            provider: "vidrock",
            providerName: "VidRock " + label,
            headers: PLAY_HEADERS,
          },
        ];
      }),
    );
    return lists.flat();
  } catch (e) {
    console.log("[vidrock] error:", e.message);
    return [];
  }
}

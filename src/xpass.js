// XPass (play.xpass.top). The embed page carries a signed dataUrl; /data answers with
// base64url AES-256-GCM (iv(12) | ciphertext | tag(16)) whose key is
// SHA-256("spv3-data-response|<build id>|<path>|<token>"). The build id is a constant in the
// player script; it rotates with player builds, so it is re-scraped on failure. The decrypted
// list names per-server playlist.json files ({ playlist: [{ sources: [{ file, type }] }] }).
import vm from "node:vm";
import { RotatingKey } from "./keys.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://play.xpass.top";
const PLAY_HEADERS = { Referer: BASE + "/", Origin: BASE };

// mainmini.js loads the player script by a plain path; the build id lives only in that
// script's obfuscator.io string table, so decode the table in a vm and pick it out.
async function discoverBuildIds() {
  const get = (p) => fetch(BASE + p, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }).then((r) => r.text());
  const page = await get("/e/movie/550");
  const main = page.match(/src="(\/static\/mainmini\.js[^"]*)"/)?.[1];
  if (!main) return [];
  const player = (await get(main)).match(/['"](\/static\/\w+\.js(?:\?[^'"]*)?)['"]/)?.[1];
  if (!player) return [];
  return decodeStrings(await get(player)).filter((s) => /^spv3-build-[\w-]+$/.test(s));
}

const GOOD_GROUPS = new Set(["TOK", "TIK", "VIP", "FIL", "WIS", "LUL"]);

function decodeStrings(src) {
  try {
    const arrFn = src.match(/function (a0_0x[0-9a-f]+)\(\)\{(?:const|var) _0x[0-9a-f]+=\[/)?.[1];
    const decFn = src.match(/function (a0_0x[0-9a-f]+)\(_0x[0-9a-f]+,_0x[0-9a-f]+\)\{_0x[0-9a-f]+=_0x[0-9a-f]+-0x[0-9a-f]+;/)?.[1];
    if (!arrFn || !decFn) return [];
    const body = (name) => {
      const i = src.indexOf(`function ${name}(`);
      for (let k = src.indexOf("{", i), d = 0; k < src.length; k++) {
        if (src[k] === "{") d++;
        else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1);
      }
      return "";
    };
    const rot = src.match(new RegExp(`\\(function\\(_0x[0-9a-f]+,_0x[0-9a-f]+\\)\\{.*?\\}\\(${arrFn},0x[0-9a-f]+\\)`, "s"))?.[0];
    if (!rot) return [];
    const ctx = vm.createContext({});
    vm.runInContext(`${body(arrFn)};${body(decFn)};${rot});globalThis.out=[];` +
      `const n=${arrFn}().length;for(let i=0;i<0x2000&&out.length<n;i++){try{const s=${decFn}(i);if(typeof s==="string")out.push(s)}catch{}}`, ctx, { timeout: 3000 });
    return ctx.out || [];
  } catch {
    return [];
  }
}

const BUILD = new RotatingKey({
  name: "xpass",
  env: "XPASS_BUILD",
  fallback: "spv3-build-1787821613-50e5fc97c9dce367",
  discover: discoverBuildIds,
});

async function decryptData(enc, path, token, build) {
  const key = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`spv3-data-response|${build}|${path}|${token}`));
  const buf = Buffer.from(enc, "base64url");
  if (buf.length < 28) throw new Error("ciphertext too short");
  const k = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, k, buf.subarray(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function xpassExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const embed = isTV ? `${BASE}/e/tv/${tmdbId}/${season}/${episode}` : `${BASE}/e/movie/${tmdbId}`;
    const headers = { "User-Agent": UA, Referer: embed };
    const page = await fetch(embed, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!page.ok) throw new Error("embed " + page.status);
    const dataUrl = (await page.text()).match(/var dataUrl="([^"]+)"/)?.[1];
    if (!dataUrl) throw new Error("no dataUrl");
    const u = new URL(dataUrl, BASE);
    const r = await fetch(u, { headers, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error("data " + r.status);
    const enc = (await r.text()).trim();
    const list = await BUILD.use((b) => decryptData(enc, u.pathname, u.searchParams.get("token"), b));
    if (!Array.isArray(list)) return [];

    // Server groups whose hosts play through the proxy. The rest are dead workers (BIG/ZUR
    // 404/500, MIX 429), wrappers of providers we already scrape directly (VRK = vidrock,
    // MEG/AKC), or filemoon-style hosts with broken TLS / 403 segments. Up to 3 entries per
    // group: the API lists many releases per group and /data rate-limits (429) bursts.
    const perGroup = new Map();
    const wanted = list.filter((s) => {
      const group = String(s?.name || "").split(" ")[0];
      if (!s?.url || !GOOD_GROUPS.has(group)) return false;
      perGroup.set(group, (perGroup.get(group) || 0) + 1);
      return perGroup.get(group) <= 3;
    });
    const streams = await Promise.all(
      wanted.map(async (s) => {
        try {
          const pl = await fetch(new URL(s.url, BASE), { headers, signal: AbortSignal.timeout(5000) }).then((x) => x.json());
          const src = (pl.playlist || pl)?.[0]?.sources?.[0];
          if (!src?.file || !/^https?:\/\//.test(src.file) || src.type === "mp4") return null;
          // many listed releases are gone (404): keep only masters that still answer
          const m = await fetch(src.file, { headers: { "User-Agent": UA, ...PLAY_HEADERS }, signal: AbortSignal.timeout(5000) });
          if (!m.ok || !(await m.text()).trimStart().startsWith("#EXTM3U")) return null;
          return {
            url: src.file,
            type: "hls",
            provider: "xpass",
            providerName: "XPass " + s.name,
            headers: PLAY_HEADERS,
          };
        } catch {
          return null;
        }
      }),
    );
    return streams.filter(Boolean);
  } catch (e) {
    console.log("[xpass] error:", e.message);
    return [];
  }
}

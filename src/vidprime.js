const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidprime.top";
// x-player-key from the player bundle (assets/main-*.js); the API doesn't currently
// enforce it (unlike VidSpark's identical API), but the player sends it
const PLAYER_KEY = "f3b72e73c80c9a996574379798703796a1936efa3516a7105cb0e43048b46b5a";
// player server list (key -> label). Not queried: "p9fx" (Prime) only serves HEVC DASH, and
// "b4tz" (Nova), "c7hw" (Atlas), "d2lx" (Lyra) answer Cloudflare 502 (some after ~13s). The API
// is rate limited to 15 requests/min per IP, so dead servers would only burn that budget.
const SERVERS = [
  ["x9pv", "Helix"],
  ["w7dn", "Orion"],
  ["vjej", "Zenith"],
];
const SERVER_TIMEOUT = 8000;

async function fetchServer(key, label, type, tmdbId, season, episode) {
  const path = type === "tv" ? `/v1/tv/${tmdbId}/${season}/${episode}` : `/v1/movie/${tmdbId}`;
  const page = type === "tv" ? `${BASE}/tv/${tmdbId}/${season}/${episode}` : `${BASE}/movie/${tmdbId}`;
  try {
    const r = await fetch(`${BASE}/api/vidora${path}?source=${key}`, {
      headers: { "User-Agent": UA, Referer: page, "x-player-key": PLAYER_KEY },
      signal: AbortSignal.timeout(SERVER_TIMEOUT),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const url = data?.result && data.sources?.[0]?.url;
    if (!url || /dash-mpd|\.mpd(\?|$)/.test(url)) return null;
    return {
      url,
      type: /\.mp4(\?|$)/.test(url) ? "file" : "hls",
      provider: "vidprime",
      providerName: `VidPrime ${label}`,
      headers: { Referer: BASE + "/", Origin: BASE },
    };
  } catch {
    return null;
  }
}

export async function vidprimeExtract(type, tmdbId, season, episode) {
  try {
    const results = await Promise.all(
      SERVERS.map(([key, label]) => fetchServer(key, label, type, tmdbId, season, episode)),
    );
    return results.filter(Boolean);
  } catch (e) {
    console.log("[vidprime] error:", e.message);
    return [];
  }
}

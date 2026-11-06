const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://vidspark.to";
const PLAYER_KEY = "3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13";

export async function vidsparkExtract(type, tmdbId, season, episode) {
  try {
    const isTV = type !== "movie";
    const path = isTV ? `/tv/${tmdbId}/${season}/${episode}` : `/movie/${tmdbId}`;

    const resp = await fetch(`${BASE}/api/vidora/v1${path}`, {
      headers: {
        "User-Agent": UA,
        Referer: BASE + path,
        "x-player-key": PLAYER_KEY,
      },
    });
    const data = await resp.json().catch(() => null);
    if (!data?.result) throw new Error(data?.message || data?.error || "api " + resp.status);

    return (data.sources || [])
      .filter((s) => s?.url)
      .map((s) => ({
        url: s.url,
        type: s.url.includes(".m3u8") ? "hls" : "file",
        provider: "vidspark",
        providerName: "VidSpark",
        headers: { Referer: BASE + "/", Origin: BASE },
      }));
  } catch (e) {
    console.log("[vidspark] error:", e.message);
    return [];
  }
}

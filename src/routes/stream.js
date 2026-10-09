import { Router } from "express";
import {
  makeProviders,
  makeStandardFetcher,
  targets,
} from "../../node_modules/@p-stream/providers/src/index.ts";
import { tmdb } from "../tmdb.js";
import { scrapeAll } from "../providers.js";

const router = Router();

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  target: targets.NATIVE,
  consistentIpForRequests: true,
});

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function makeEvents() {
  const log = [];
  return {
    log,
    events: {
      init: (data) => log.push({ event: "init", ...data }),
      start: (id) => log.push({ event: "start", id }),
      update: (data) => log.push({ event: "update", ...data }),
      discoverEmbeds: (data) => log.push({ event: "embeds", ...data }),
    },
  };
}

router.get("/sources", (_req, res) => {
  res.json({
    sources: providers.listSources(),
    embeds: providers.listEmbeds(),
  });
});

router.get("/search/:type", async (req, res) => {
  const { type } = req.params;
  const { query, page } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });

  if (type === "multi") {
    res.json(await tmdb("/search/multi", { query, page }));
  } else {
    res.json(await tmdb(`/search/${type}`, { query, page }));
  }
});

router.get("/trending/:type/:window", async (req, res) => {
  const { type, window } = req.params;
  res.json(await tmdb(`/trending/${type}/${window}`, { page: req.query.page }));
});

router.get("/movie/:id", async (req, res) => {
  res.json(
    await tmdb(`/movie/${req.params.id}`, {
      append_to_response: "external_ids",
    }),
  );
});

router.get("/tv/:id", async (req, res) => {
  res.json(
    await tmdb(`/tv/${req.params.id}`, {
      append_to_response: "external_ids",
    }),
  );
});

router.get("/tv/:id/season/:season", async (req, res) => {
  res.json(await tmdb(`/tv/${req.params.id}/season/${req.params.season}`));
});

async function buildMovieMedia(tmdbId) {
  const details = await tmdb(`/movie/${tmdbId}`, {
    append_to_response: "external_ids",
  });
  return {
    type: "movie",
    title: details.title,
    releaseYear: new Date(details.release_date).getFullYear(),
    tmdbId: String(details.id),
    imdbId: details.imdb_id || details.external_ids?.imdb_id || undefined,
  };
}

async function buildShowMedia(tmdbId, season, episode) {
  const show = await tmdb(`/tv/${tmdbId}`, {
    append_to_response: "external_ids",
  });
  const seasonData = await tmdb(`/tv/${tmdbId}/season/${season}`);
  const ep = seasonData.episodes?.find(
    (e) => e.episode_number === Number(episode),
  );
  return {
    type: "show",
    title: show.name,
    releaseYear: new Date(show.first_air_date).getFullYear(),
    tmdbId: String(show.id),
    imdbId: show.external_ids?.imdb_id || undefined,
    season: {
      number: Number(season),
      tmdbId: String(seasonData.id),
    },
    episode: {
      number: Number(episode),
      tmdbId: ep ? String(ep.id) : String(episode),
    },
  };
}

async function scrapeWithEvents(media) {
  const { log, events } = makeEvents();
  const result = await providers.runAll({ media, events });
  const tried = log
    .filter((l) => l.event === "update")
    .map((l) => ({ id: l.id, status: l.status, reason: l.reason }));
  return { result, tried };
}

function pstreamToStreams(result) {
  if (!result?.stream) return [];
  const s = result.stream;
  if (s.type === "hls") {
    return [
      { url: s.playlist, type: "hls", provider: "pstream", providerName: "Direct" },
    ];
  }
  if (s.type === "file") {
    return Object.values(s.qualities)
      .filter((q) => q?.url)
      .map((q) => ({
        url: q.url,
        type: "file",
        quality: q.quality,
        provider: "pstream",
        providerName: "Direct",
      }));
  }
  return [];
}

async function collectStreams(customPromise, pstreamPromise) {
  const custom = customPromise.then((s) => s, () => []);
  const pstream = pstreamPromise.then((s) => s, () => []);

  const first = await custom;
  if (first.length > 0) {
    const bonus = await Promise.race([
      pstream,
      new Promise((r) => setTimeout(() => r([]), 1000)),
    ]);
    return [...first, ...bonus];
  }
  const fallback = await Promise.race([
    pstream,
    new Promise((r) => setTimeout(() => r([]), 8000)),
  ]);
  return fallback;
}

router.get("/stream/movie/:tmdbId", async (req, res) => {
  try {
    const streams = await collectStreams(
      scrapeAll("movie", req.params.tmdbId),
      buildMovieMedia(req.params.tmdbId).then((m) =>
        scrapeWithEvents(m).then(({ result }) => pstreamToStreams(result)),
      ),
    );
    res.json({ streams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stream/tv/:tmdbId/:season/:episode", async (req, res) => {
  const { tmdbId, season, episode } = req.params;
  try {
    const streams = await collectStreams(
      scrapeAll("tv", tmdbId, season, episode),
      buildShowMedia(tmdbId, season, episode).then((m) =>
        scrapeWithEvents(m).then(({ result }) => pstreamToStreams(result)),
      ),
    );
    res.json({ streams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy endpoint — solves CORS for HLS streams
router.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const origin = new URL(url).origin;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Referer: origin + "/" },
    });

    if (!r.ok) return res.status(r.status).end();

    const ct = r.headers.get("content-type") || "";
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (ct.includes("mpegurl") || url.endsWith(".m3u8")) {
      let text = await r.text();
      const parsedUrl = new URL(url);
      const hostToken = parsedUrl.searchParams.get("token");
      const base = url.substring(0, url.lastIndexOf("/") + 1);
      text = text.replace(/^(?!#)(\S+)$/gm, (line) => {
        if (!line.trim()) return line;
        let abs = line.startsWith("http") ? line : origin + line;
        if (hostToken && !abs.includes("token=")) {
          abs += (abs.includes("?") ? "&" : "?") + "token=" + hostToken;
        }
        return `/api/proxy?url=${encodeURIComponent(abs)}`;
      });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.send(text);
    } else {
      res.setHeader("Content-Type", ct || "application/octet-stream");
      const buf = Buffer.from(await r.arrayBuffer());
      res.send(buf);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


export default router;

import { Router } from "express";
import {
  makeProviders,
  makeStandardFetcher,
  targets,
} from "../../node_modules/@p-stream/providers/src/index.ts";
import { tmdb } from "../tmdb.js";

const router = Router();

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  target: targets.NATIVE,
  consistentIpForRequests: true,
});

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

router.get("/scrape/movie/:tmdbId", async (req, res) => {
  try {
    const media = await buildMovieMedia(req.params.tmdbId);
    const { result, tried } = await scrapeWithEvents(media);
    if (!result) {
      return res.status(404).json({ error: "no sources found", tried });
    }
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get("/scrape/tv/:tmdbId/:season/:episode", async (req, res) => {
  const { tmdbId, season, episode } = req.params;
  try {
    const media = await buildShowMedia(tmdbId, season, episode);
    const { result, tried } = await scrapeWithEvents(media);
    if (!result) {
      return res.status(404).json({ error: "no sources found", tried });
    }
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;

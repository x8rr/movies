import {
  makeProviders,
  makeStandardFetcher,
  targets,
} from "../node_modules/@p-stream/providers/src/index.ts";
import { tmdb } from "./tmdb.js";

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  target: targets.NATIVE,
  consistentIpForRequests: true,
});

// Sources whose backends are gone; skipping them saves a wasted request burst per lookup.
const EXCLUDED = new Map([
  ["mbp-api", "mbp-api.ruixinhong20.workers.dev answers 500 Internal Server Error to every search/details call"],
  ["turbovidSource", "turbovid.eu no longer resolves (NXDOMAIN)"],
  ["rgshows", "api.rgshows.ru is a for-sale page; api.rgshows.me is a parked domain (parklogic redirector)"],
  ["tugaflix", "tugaflix.love is a parked domain (parklogic redirector)"],
  ["wecima", "wecima.tube is a parked domain (parklogic redirector)"],
  ["primewire", "primesrc.me /api/v1/l link lookup requires a Cloudflare Turnstile token (403 cf-mitigated)"],
  ["pelisplushd", "ww3.pelisplus.to serves a self-signed example.com certificate and drops connections"],
  ["zunime", "backend.xaiby.sbs is a parked domain"],
  ["animetsu", "backend.animetsu.to is a parked domain; animetsu.cc no longer resolves"],
]);

// Per-embed cap, and how long to keep waiting for slower mirrors once one embed has produced streams
// (some streamwish CDN nodes accept the connection and never answer, which would stall the whole source).
const EMBED_TIMEOUT = 10000;
const EMBED_GRACE = 1500;

function collectEmbeds(tasks) {
  return new Promise((resolve) => {
    const out = [];
    let pending = tasks.length;
    let grace = null;
    const done = () => {
      clearTimeout(cap);
      clearTimeout(grace);
      resolve(out.slice());
    };
    const cap = setTimeout(done, EMBED_TIMEOUT);
    for (const task of tasks) {
      task
        .then((streams) => {
          out.push(...streams);
          if (streams.length && !grace) grace = setTimeout(done, EMBED_GRACE);
        })
        .catch(() => {})
        .finally(() => {
          if (--pending === 0) done();
        });
    }
  });
}

async function buildMedia(type, tmdbId, season, episode) {
  if (type === "movie") {
    const d = await tmdb(`/movie/${tmdbId}`, { append_to_response: "external_ids" });
    return {
      type: "movie",
      title: d.title,
      releaseYear: new Date(d.release_date).getFullYear(),
      tmdbId: String(d.id),
      imdbId: d.imdb_id || d.external_ids?.imdb_id || undefined,
    };
  }
  const [show, seasonData] = await Promise.all([
    tmdb(`/tv/${tmdbId}`, { append_to_response: "external_ids" }),
    tmdb(`/tv/${tmdbId}/season/${season}`),
  ]);
  const ep = seasonData.episodes?.find((e) => e.episode_number === Number(episode));
  return {
    type: "show",
    title: show.name,
    releaseYear: new Date(show.first_air_date).getFullYear(),
    tmdbId: String(show.id),
    imdbId: show.external_ids?.imdb_id || undefined,
    season: { number: Number(season), tmdbId: String(seasonData.id) },
    episode: { number: Number(episode), tmdbId: ep ? String(ep.id) : String(episode) },
  };
}

function convert(stream, id, name) {
  const headers = { ...(stream.preferredHeaders || {}), ...(stream.headers || {}) };
  const base = {
    provider: id,
    providerName: name,
    ...(Object.keys(headers).length ? { headers } : {}),
  };
  if (stream.type === "hls") return [{ ...base, url: stream.playlist, type: "hls" }];
  if (stream.type === "file") {
    return Object.entries(stream.qualities || {})
      .filter(([, q]) => q?.url)
      .map(([quality, q]) => ({
        ...base,
        url: q.url,
        type: "file",
        quality: quality === "unknown" ? undefined : quality + (/^\d+$/.test(quality) ? "p" : ""),
      }));
  }
  return [];
}

async function runSource(source, media) {
  const out = await providers.runSourceScraper({ id: source.id, media });
  const streams = (out.stream || []).flatMap((s) => convert(s, source.id, source.name));
  if (streams.length || !out.embeds?.length) return streams;

  const embedNames = new Map(providers.listEmbeds().map((e) => [e.id, e.name]));
  return collectEmbeds(
    out.embeds.map((e) =>
      providers
        .runEmbedScraper({ id: e.embedId, url: e.url })
        .then((r) =>
          (r.stream || []).flatMap((s) =>
            convert(s, source.id, `${source.name} ${embedNames.get(e.embedId) || e.embedId}`),
          ),
        ),
    ),
  );
}

export function pstreamTasks(type) {
  const mediaType = type === "movie" ? "movie" : "show";
  let mediaP = null;
  return providers
    .listSources()
    .filter((s) => s.mediaTypes?.includes(mediaType) && !EXCLUDED.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      extract: async (type, tmdbId, season, episode) => {
        mediaP ??= buildMedia(type, tmdbId, season, episode);
        try {
          return await runSource(s, await mediaP);
        } catch {
          return [];
        }
      },
    }));
}

export function listPstream() {
  return {
    sources: providers.listSources().filter((s) => !EXCLUDED.has(s.id)),
    embeds: providers.listEmbeds(),
  };
}

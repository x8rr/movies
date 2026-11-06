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

const EMBED_TIMEOUT = 10000;

function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
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
  const results = await Promise.allSettled(
    out.embeds.map((e) =>
      timeout(providers.runEmbedScraper({ id: e.embedId, url: e.url }), EMBED_TIMEOUT).then((r) =>
        (r.stream || []).flatMap((s) =>
          convert(s, source.id, `${source.name} ${embedNames.get(e.embedId) || e.embedId}`),
        ),
      ),
    ),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export function pstreamTasks(type) {
  const mediaType = type === "movie" ? "movie" : "show";
  let mediaP = null;
  return providers
    .listSources()
    .filter((s) => s.mediaTypes?.includes(mediaType))
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
  return { sources: providers.listSources(), embeds: providers.listEmbeds() };
}

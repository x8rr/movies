# movies

lightweight self-hosted movie streaming API. scrapes actual m3u8/mp4 stream URLs from ~10 embed providers in parallel (VidSrc, CineSrc, VidLink, VidSpark, VixSrc, VidZee, VidRock, 2Embed, VidNest, VidFast/VidCore/VidUp) plus every enabled [p-stream](https://github.com/movie-web-rip/pstream-providers) source, no browser/puppeteer. dead links are filtered before they're returned, and the web player (HLS.js) falls through to the next server automatically. also proxies TMDB for metadata.

uses bun, nothing else to set up.

## setup

```
cp .env.example .env
```

get a TMDB API key from https://www.themoviedb.org/settings/api and add it to `.env`.

### run directly

```
bun install
bun start
```

### docker

```
docker compose up -d
```

runs on port 3000 by default.

## API

### streaming

- `GET /api/stream/movie/:tmdbId` — scrape movie streams
- `GET /api/stream/tv/:tmdbId/:season/:episode` — scrape TV episode streams
- `GET /api/proxy?url=&headers=` — CORS proxy for playback (rewrites m3u8 segment/key URLs, forwards a stream's required `headers` JSON, supports Range for mp4 seeking)
- `GET /api/sources` — list available scraping providers

### TMDB

- `GET /api/search/:type?query=` — search (movie, tv, multi)
- `GET /api/trending/:type/:window` — trending (all/movie/tv, day/week)
- `GET /api/movie/:id` — movie details
- `GET /api/tv/:id` — TV show details
- `GET /api/tv/:id/season/:season` — season episodes

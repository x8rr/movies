# movies

lightweight self-hosted movie streaming API. scrapes actual m3u8 stream URLs via [VidSrc](https://vidsrc.sh) (HTTP + WASM decryption, no browser/puppeteer), proxies TMDB for metadata, and includes a web player with HLS.js.

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
- `GET /api/proxy?url=` — CORS proxy for HLS playback (rewrites m3u8 segment URLs, propagates host tokens)
- `GET /api/sources` — list available scraping providers

### TMDB

- `GET /api/search/:type?query=` — search (movie, tv, multi)
- `GET /api/trending/:type/:window` — trending (all/movie/tv, day/week)
- `GET /api/movie/:id` — movie details
- `GET /api/tv/:id` — TV show details
- `GET /api/tv/:id/season/:season` — season episodes

# movies

> [!CAUTION]
> **This server executes JavaScript downloaded from third-party streaming sites.** CineSrc, VidFast/VidCore/VidUp, VidLink and Hexa fetch their player's JS/wasm at runtime (VidLink also pulls Go's `wasm_exec.js` from jsDelivr) and run it with `node:vm`. `node:vm` is **not** a security boundary: any of those scripts, if malicious or hijacked, can escape the context and run with the server's full privileges — read `process.env` (your TMDB key), read and write files, open network connections, spawn processes via `Bun.spawn`. Run it only inside a container (`docker compose up -d`) that holds no other secrets, never as root on a host you care about, and never with credentials in its environment beyond the TMDB key.

lightweight self-hosted movie streaming API. scrapes actual m3u8/mp4 stream URLs from ~15 embed providers in parallel (VidSrc/AutoEmbed, CineSrc, VidSpark, VixSrc, VidZee, VidRock, 2Embed, VidNest, Hexa, VidPrime, XPass, VidFast/VidCore/VidUp, VidLink) plus the working [p-stream](https://github.com/movie-web-rip/pstream-providers) sources (LookMovie, HDRezka, FshareTV, Cuevana3; fixes live in `patches/`, dead ones are excluded in `src/pstream.js`), no browser/puppeteer. every stream is checked down to its first media segment before it's returned, and the web player (HLS.js) falls through to the next server automatically. also proxies TMDB for metadata.

outbound requests are pinned to IPv4 (`src/net.js`): several stream hosts bind their tokens to the client IP, and Bun otherwise alternates between IPv4 and IPv6 per connection.

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
- `GET /api/proxy?url=&headers=` — CORS proxy for playback (rewrites m3u8 segment/key URLs, forwards a stream's required `headers` JSON — a `null` value drops that default header — supports Range for mp4 seeking)
- `GET /api/sources` — list available scraping providers

### TMDB

- `GET /api/search/:type?query=` — search (movie, tv, multi)
- `GET /api/trending/:type/:window` — trending (all/movie/tv, day/week)
- `GET /api/movie/:id` — movie details
- `GET /api/tv/:id` — TV show details
- `GET /api/tv/:id/season/:season` — season episodes

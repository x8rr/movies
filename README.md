# movies

lightweight self-hosted movie streaming API with pstream-compatible sync backend. scrapes streaming sources via [@p-stream/providers](https://github.com/movie-web-rip/pstream-providers), proxies TMDB for metadata, and includes a basic web UI for searching and playing.

uses bun + SQLite, nothing else to set up.

## setup

```
cp .env.example .env
```

generate a secret and add it to `.env`:
```
openssl rand -hex 32
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

runs on port 3000 by default. data is stored in `./data/movies.db`.

## streaming

- `GET /api/sources` - list available scraping providers
- `GET /api/scrape/movie/:tmdbId` - scrape movie sources
- `GET /api/scrape/tv/:tmdbId/:season/:episode` - scrape TV episode sources
- `GET /api/search/:type?query=` - search TMDB (movie, tv, multi)
- `GET /api/trending/:type/:window` - trending (all/movie/tv, day/week)
- `GET /api/movie/:id` - movie details
- `GET /api/tv/:id` - TV show details
- `GET /api/tv/:id/season/:season` - season episodes

## sync (pstream-compatible)

point the pstream frontend at your instance URL and it works.

**auth** (ed25519 challenge-response)
- `POST /auth/register/start` + `/auth/register/complete`
- `POST /auth/login/start` + `/auth/login/complete`

**users** (authenticated)
- `GET /users/@me`, `PATCH /users/:id`, `DELETE /users/:id`

**bookmarks** - `GET/PUT/POST/DELETE /users/:id/bookmarks`

**progress** - `GET/PUT/DELETE /users/:id/progress/:tmdbid`

**watch history** - `GET/PUT/DELETE /users/:id/watch-history/:tmdbid`

**settings** - `GET/PUT /users/:id/settings`

**sessions** - `GET /users/:id/sessions`, `PATCH/DELETE /sessions/:sid`

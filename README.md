# movies

lightweight self-hosted movie api. proxies TMDB for search, discover, movie/tv details, seasons, episodes, genres, and person info.

## setup

get a TMDB API key from https://www.themoviedb.org/settings/api

```
cp .env.example .env
# add your TMDB_API_KEY to .env
```

### run directly

```
npm install
TMDB_API_KEY=your-key npm start
```

### docker

```
TMDB_API_KEY=your-key docker compose up -d
```

runs on port 8080 by default.

## endpoints

- `GET /search/movie?query=` - search movies
- `GET /search/tv?query=` - search tv shows
- `GET /search/multi?query=` - search all
- `GET /trending/:type/:window` - trending (movie/tv/all, day/week)
- `GET /discover/movie` - discover movies
- `GET /discover/tv` - discover tv
- `GET /movie/:id` - movie details (includes credits, videos, recommendations)
- `GET /tv/:id` - tv show details
- `GET /tv/:id/season/:num` - season details
- `GET /tv/:id/season/:num/episode/:num` - episode details
- `GET /genre/movie/list` - movie genres
- `GET /genre/tv/list` - tv genres
- `GET /person/:id` - person details + credits

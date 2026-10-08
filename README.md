# movies

lightweight self-hosted pstream-compatible backend. syncs bookmarks, watch progress, history, groups, and settings. uses SQLite instead of PostgreSQL so there's nothing extra to set up.

point the pstream frontend at your instance URL and it works.

## setup

```
cp .env.example .env
```

generate a secret and add it to `.env`:
```
openssl rand -hex 32
```

### run directly

```
npm install
npm start
```

### docker

```
docker compose up -d
```

runs on port 3000 by default. data is stored in `./data/movies.db`.

## endpoints

**meta**
- `GET /` - version info
- `GET /meta` - server metadata
- `GET /health` - database health check

**auth** (ed25519 challenge-response, same as pstream)
- `POST /auth/register/start` - get registration challenge
- `POST /auth/register/complete` - complete registration
- `POST /auth/login/start` - get login challenge
- `POST /auth/login/complete` - complete login

**users** (all authenticated)
- `GET /users/@me` - current user + session
- `PATCH /users/:id` - update profile
- `DELETE /users/:id` - delete account

**bookmarks**
- `GET /users/:id/bookmarks`
- `PUT /users/:id/bookmarks` - bulk upsert
- `POST /users/:id/bookmarks/:tmdbid` - single upsert
- `DELETE /users/:id/bookmarks/:tmdbid`

**progress**
- `GET /users/:id/progress`
- `PUT /users/:id/progress/:tmdbid`
- `PUT /users/:id/progress/import` - bulk import
- `DELETE /users/:id/progress/:tmdbid`

**watch history**
- `GET /users/:id/watch-history`
- `PUT /users/:id/watch-history/:tmdbid`
- `DELETE /users/:id/watch-history/:tmdbid`

**settings**
- `GET /users/:id/settings`
- `PUT /users/:id/settings`

**sessions**
- `GET /users/:id/sessions`
- `PATCH /sessions/:sid` - rename device
- `DELETE /sessions/:sid` - revoke session

**groups**
- `GET /users/:id/group-order`
- `PUT /users/:id/group-order`

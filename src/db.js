import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

const dbPath = process.env.DB_PATH || "./data/movies.db";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id      TEXT PRIMARY KEY,
    key     TEXT UNIQUE NOT NULL,
    ns      TEXT NOT NULL,
    created TEXT NOT NULL,
    seen    TEXT,
    perms   TEXT NOT NULL DEFAULT '[]',
    profile TEXT NOT NULL DEFAULT '{}',
    nick    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id      TEXT PRIMARY KEY,
    user    TEXT NOT NULL,
    created TEXT NOT NULL,
    seen    TEXT NOT NULL,
    expires TEXT NOT NULL,
    device  TEXT NOT NULL,
    agent   TEXT NOT NULL,
    UNIQUE(user, device)
  );

  CREATE TABLE IF NOT EXISTS codes (
    code    TEXT PRIMARY KEY,
    flow    TEXT NOT NULL,
    type    TEXT NOT NULL,
    created TEXT NOT NULL,
    expires TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS marks (
    tmdb    TEXT NOT NULL,
    user    TEXT NOT NULL,
    meta    TEXT NOT NULL DEFAULT '{}',
    updated TEXT NOT NULL,
    groups  TEXT NOT NULL DEFAULT '[]',
    favs    TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (tmdb, user)
  );

  CREATE TABLE IF NOT EXISTS progress (
    id       TEXT PRIMARY KEY,
    tmdb     TEXT NOT NULL,
    user     TEXT NOT NULL,
    sid      TEXT,
    eid      TEXT,
    meta     TEXT NOT NULL DEFAULT '{}',
    updated  TEXT NOT NULL,
    duration INTEGER NOT NULL,
    watched  INTEGER NOT NULL,
    sno      INTEGER,
    eno      INTEGER,
    UNIQUE(tmdb, user, sid, eid)
  );

  CREATE TABLE IF NOT EXISTS history (
    id       TEXT PRIMARY KEY,
    user     TEXT NOT NULL,
    tmdb     TEXT NOT NULL,
    sid      TEXT,
    eid      TEXT,
    meta     TEXT NOT NULL DEFAULT '{}',
    duration REAL NOT NULL,
    watched  REAL NOT NULL,
    at       TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    sno      INTEGER,
    eno      INTEGER,
    updated  TEXT NOT NULL,
    UNIQUE(tmdb, user, sid, eid)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id      TEXT PRIMARY KEY,
    user    TEXT UNIQUE NOT NULL,
    sort    TEXT NOT NULL DEFAULT '[]',
    created TEXT NOT NULL,
    updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}'
  );
`);

export { db };

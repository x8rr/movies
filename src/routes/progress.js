import { Router } from "express";
import { v7 as uuid } from "uuid";
import { db } from "../db.js";
import { authMiddleware, ownerOnly } from "../auth.js";

const router = Router({ mergeParams: true });
router.use(authMiddleware, ownerOnly);

function formatProgress(r) {
  return {
    id: r.id,
    tmdbId: r.tmdb,
    seasonId: r.sid === "\n" ? null : r.sid,
    episodeId: r.eid === "\n" ? null : r.eid,
    meta: JSON.parse(r.meta),
    updated: r.updated,
    duration: Number(r.duration),
    watched: Number(r.watched),
    seasonNumber: r.sno,
    episodeNumber: r.eno,
  };
}

// GET /users/:id/progress
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM progress WHERE user = ?").all(req.userId);
  res.json(rows.map(formatProgress));
});

// PUT /users/:id/progress/import
router.put("/import", (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: "expected array" });

  const upsert = db.prepare(`
    INSERT INTO progress (id, tmdb, user, sid, eid, meta, updated, duration, watched, sno, eno)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmdb, user, sid, eid) DO UPDATE SET
      meta = excluded.meta, updated = excluded.updated,
      duration = excluded.duration, sno = excluded.sno, eno = excluded.eno,
      watched = CASE WHEN excluded.watched > progress.watched THEN excluded.watched ELSE progress.watched END
  `);

  const run = db.transaction(() => {
    for (const item of items) {
      const sid = item.sid || item.seasonId || "\n";
      const eid = item.eid || item.episodeId || "\n";
      upsert.run(
        uuid(),
        String(item.tmdbId),
        req.userId,
        sid,
        eid,
        JSON.stringify(item.meta || {}),
        item.updated || new Date().toISOString(),
        Math.round(item.duration || 0),
        Math.round(item.watched || 0),
        item.season ?? item.seasonNumber ?? null,
        item.episode ?? item.episodeNumber ?? null,
      );
    }
  });
  run();

  const rows = db.prepare("SELECT * FROM progress WHERE user = ?").all(req.userId);
  res.json(rows.map(formatProgress));
});

// PUT /users/:id/progress/:tmdbid
router.put("/:tmdbid", (req, res) => {
  const { meta, duration, watched, sid, eid, seasonId, episodeId, season, episode, seasonNumber, episodeNumber, updated } = req.body;
  const now = updated || new Date().toISOString();
  const s = sid || seasonId || "\n";
  const e = eid || episodeId || "\n";

  db.prepare(`
    INSERT INTO progress (id, tmdb, user, sid, eid, meta, updated, duration, watched, sno, eno)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmdb, user, sid, eid) DO UPDATE SET
      meta = excluded.meta, updated = excluded.updated,
      duration = excluded.duration, watched = excluded.watched,
      sno = excluded.sno, eno = excluded.eno
  `).run(
    uuid(),
    req.params.tmdbid,
    req.userId,
    s,
    e,
    JSON.stringify(meta || {}),
    now,
    Math.round(duration || 0),
    Math.round(watched || 0),
    season ?? seasonNumber ?? null,
    episode ?? episodeNumber ?? null,
  );

  const row = db
    .prepare("SELECT * FROM progress WHERE tmdb = ? AND user = ? AND sid = ? AND eid = ?")
    .get(req.params.tmdbid, req.userId, s, e);
  res.json(formatProgress(row));
});

// DELETE /users/:id/progress/:tmdbid
router.delete("/:tmdbid", (req, res) => {
  const { sid, eid, seasonId, episodeId } = req.body || {};
  const s = sid || seasonId;
  const e = eid || episodeId;

  let result;
  if (s || e) {
    result = db
      .prepare("DELETE FROM progress WHERE tmdb = ? AND user = ? AND sid = ? AND eid = ?")
      .run(req.params.tmdbid, req.userId, s || "\n", e || "\n");
  } else {
    result = db
      .prepare("DELETE FROM progress WHERE tmdb = ? AND user = ?")
      .run(req.params.tmdbid, req.userId);
  }
  res.json({ count: result.changes, tmdbId: req.params.tmdbid });
});

export default router;

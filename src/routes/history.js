import { Router } from "express";
import { v7 as uuid } from "uuid";
import { db } from "../db.js";
import { authMiddleware, ownerOnly } from "../auth.js";

const router = Router({ mergeParams: true });
router.use(authMiddleware, ownerOnly);

function formatHistory(r) {
  return {
    id: r.id,
    tmdbId: r.tmdb,
    seasonId: r.sid === "\n" ? null : r.sid,
    episodeId: r.eid === "\n" ? null : r.eid,
    meta: JSON.parse(r.meta),
    duration: r.duration,
    watched: r.watched,
    watchedAt: r.at,
    completed: !!r.done,
    seasonNumber: r.sno,
    episodeNumber: r.eno,
    updated: r.updated,
  };
}

// GET /users/:id/watch-history
router.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM history WHERE user = ? ORDER BY at DESC")
    .all(req.userId);
  res.json(rows.map(formatHistory));
});

// PUT /users/:id/watch-history/:tmdbid
router.put("/:tmdbid", (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const now = new Date().toISOString();

  const upsert = db.prepare(`
    INSERT INTO history (id, user, tmdb, sid, eid, meta, duration, watched, at, done, sno, eno, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmdb, user, sid, eid) DO UPDATE SET
      meta = excluded.meta, duration = excluded.duration,
      watched = excluded.watched, at = excluded.at,
      done = excluded.done, sno = excluded.sno, eno = excluded.eno,
      updated = excluded.updated
  `);

  const run = db.transaction(() => {
    for (const item of items) {
      const sid = item.sid || item.seasonId || "\n";
      const eid = item.eid || item.episodeId || "\n";
      upsert.run(
        uuid(),
        req.userId,
        item.tmdbId || req.params.tmdbid,
        sid,
        eid,
        JSON.stringify(item.meta || {}),
        item.duration || 0,
        item.watched || 0,
        item.watchedAt || now,
        item.completed ? 1 : 0,
        item.season ?? item.seasonNumber ?? null,
        item.episode ?? item.episodeNumber ?? null,
        now,
      );
    }
  });
  run();

  const rows = db
    .prepare("SELECT * FROM history WHERE tmdb = ? AND user = ?")
    .all(req.params.tmdbid, req.userId);
  res.json(rows.map(formatHistory));
});

// DELETE /users/:id/watch-history/:tmdbid
router.delete("/:tmdbid", (req, res) => {
  const { sid, eid, seasonId, episodeId } = req.body || {};
  const s = sid || seasonId;
  const e = eid || episodeId;

  let result;
  if (s || e) {
    result = db
      .prepare("DELETE FROM history WHERE tmdb = ? AND user = ? AND sid = ? AND eid = ?")
      .run(req.params.tmdbid, req.userId, s || "\n", e || "\n");
  } else {
    result = db
      .prepare("DELETE FROM history WHERE tmdb = ? AND user = ?")
      .run(req.params.tmdbid, req.userId);
  }
  res.json({ success: true, count: result.changes });
});

export default router;

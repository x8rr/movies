import { Router } from "express";
import { db } from "../db.js";
import { authMiddleware, ownerOnly } from "../auth.js";

const router = Router({ mergeParams: true });
router.use(authMiddleware, ownerOnly);

// GET /users/:id/bookmarks
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM marks WHERE user = ?").all(req.userId);
  res.json(
    rows.map((r) => ({
      tmdbId: r.tmdb,
      meta: JSON.parse(r.meta),
      updated: r.updated,
      groups: JSON.parse(r.groups),
      favorites: JSON.parse(r.favs),
    })),
  );
});

// PUT /users/:id/bookmarks (bulk upsert)
router.put("/", (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: "expected array" });

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO marks (tmdb, user, meta, updated, groups, favs)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmdb, user) DO UPDATE SET
      meta = excluded.meta, updated = excluded.updated,
      groups = excluded.groups, favs = excluded.favs
  `);

  const run = db.transaction(() => {
    for (const item of items) {
      const groups = Array.isArray(item.group) ? item.group : item.group ? [item.group] : [];
      upsert.run(
        String(item.tmdbId),
        req.userId,
        JSON.stringify(item.meta || {}),
        now,
        JSON.stringify(groups),
        JSON.stringify(item.favoriteEpisodes || item.favorites || []),
      );
    }
  });
  run();

  const rows = db.prepare("SELECT * FROM marks WHERE user = ?").all(req.userId);
  res.json(
    rows.map((r) => ({
      tmdbId: r.tmdb,
      meta: JSON.parse(r.meta),
      updated: r.updated,
      groups: JSON.parse(r.groups),
      favorites: JSON.parse(r.favs),
    })),
  );
});

// POST /users/:id/bookmarks/:tmdbid
router.post("/:tmdbid", (req, res) => {
  const now = new Date().toISOString();
  const { meta, group, favoriteEpisodes, favorites } = req.body;
  const groups = Array.isArray(group) ? group : group ? [group] : [];

  db.prepare(`
    INSERT INTO marks (tmdb, user, meta, updated, groups, favs)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmdb, user) DO UPDATE SET
      meta = excluded.meta, updated = excluded.updated,
      groups = excluded.groups, favs = excluded.favs
  `).run(
    req.params.tmdbid,
    req.userId,
    JSON.stringify(meta || {}),
    now,
    JSON.stringify(groups),
    JSON.stringify(favoriteEpisodes || favorites || []),
  );

  const row = db
    .prepare("SELECT * FROM marks WHERE tmdb = ? AND user = ?")
    .get(req.params.tmdbid, req.userId);
  res.json({
    tmdbId: row.tmdb,
    meta: JSON.parse(row.meta),
    updated: row.updated,
    groups: JSON.parse(row.groups),
    favorites: JSON.parse(row.favs),
  });
});

// DELETE /users/:id/bookmarks/:tmdbid
router.delete("/:tmdbid", (req, res) => {
  db.prepare("DELETE FROM marks WHERE tmdb = ? AND user = ?").run(
    req.params.tmdbid,
    req.userId,
  );
  res.json({ success: true, tmdbId: req.params.tmdbid });
});

export default router;

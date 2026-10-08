import { Router } from "express";
import { db } from "../db.js";
import { authMiddleware, ownerOnly } from "../auth.js";

const router = Router({ mergeParams: true });
router.use(authMiddleware, ownerOnly);

// GET /users/:id/settings
router.get("/", (req, res) => {
  const row = db.prepare("SELECT data FROM settings WHERE id = ?").get(req.userId);
  res.json(row ? JSON.parse(row.data) : {});
});

// PUT /users/:id/settings
router.put("/", (req, res) => {
  const existing = db.prepare("SELECT data FROM settings WHERE id = ?").get(req.userId);
  const current = existing ? JSON.parse(existing.data) : {};
  const merged = { ...current, ...req.body };

  db.prepare(`
    INSERT INTO settings (id, data) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data
  `).run(req.userId, JSON.stringify(merged));

  res.json(merged);
});

export default router;

import { Router } from "express";
import { v7 as uuid } from "uuid";
import { db } from "../db.js";
import { authMiddleware, ownerOnly } from "../auth.js";

const router = Router({ mergeParams: true });
router.use(authMiddleware, ownerOnly);

// GET /users/:id/group-order
router.get("/", (req, res) => {
  const row = db.prepare("SELECT sort FROM groups WHERE user = ?").get(req.userId);
  res.json({ groupOrder: row ? JSON.parse(row.sort) : [] });
});

// PUT /users/:id/group-order
router.put("/", (req, res) => {
  const order = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: "expected array" });

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO groups (id, user, sort, created, updated) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user) DO UPDATE SET sort = excluded.sort, updated = excluded.updated
  `).run(uuid(), req.userId, JSON.stringify(order), now, now);

  res.json({ groupOrder: order });
});

export default router;

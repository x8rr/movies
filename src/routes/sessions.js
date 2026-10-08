import { Router } from "express";
import { db } from "../db.js";
import { authMiddleware } from "../auth.js";

const router = Router({ mergeParams: true });
router.use(authMiddleware);

// GET /users/:id/sessions
router.get("/", (req, res) => {
  if (req.params.id !== req.userId) return res.status(403).json({ error: "forbidden" });
  const rows = db.prepare("SELECT * FROM sessions WHERE user = ?").all(req.userId);
  res.json(
    rows.map((s) => ({
      id: s.id,
      userId: s.user,
      createdAt: s.created,
      accessedAt: s.seen,
      device: s.device,
      userAgent: s.agent,
    })),
  );
});

// PATCH /sessions/:sid
router.patch("/:sid", (req, res) => {
  const { deviceName } = req.body;
  if (!deviceName) return res.status(400).json({ error: "deviceName required" });

  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sid);
  if (!session || session.user !== req.userId) {
    return res.status(403).json({ error: "forbidden" });
  }

  db.prepare("UPDATE sessions SET device = ? WHERE id = ?").run(deviceName, req.params.sid);

  const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sid);
  res.json({
    id: updated.id,
    userId: updated.user,
    createdAt: updated.created,
    accessedAt: updated.seen,
    device: updated.device,
    userAgent: updated.agent,
  });
});

// DELETE /sessions/:sid
router.delete("/:sid", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sid);
  if (!session || session.user !== req.userId) {
    return res.status(403).json({ error: "forbidden" });
  }
  db.prepare("DELETE FROM sessions WHERE id = ?").run(req.params.sid);
  res.json({ id: req.params.sid });
});

export default router;

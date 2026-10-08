import { Router } from "express";
import { db } from "../db.js";
import { authMiddleware, ownerOnly } from "../auth.js";

const router = Router();
router.use(authMiddleware);

// GET /users/@me
router.get("/@me", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user) return res.status(404).json({ error: "user not found" });
  res.json({
    user: {
      id: user.id,
      publicKey: user.key,
      namespace: user.ns,
      nickname: user.nick,
      profile: JSON.parse(user.profile),
      permissions: JSON.parse(user.perms),
    },
    session: {
      id: req.session.id,
      user: req.session.user,
      createdAt: req.session.created,
      accessedAt: req.session.seen,
      expiresAt: req.session.expires,
      device: req.session.device,
      userAgent: req.session.agent,
    },
  });
});

// PATCH /users/:id
router.patch("/:id", ownerOnly, (req, res) => {
  const { profile, nickname } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "user not found" });

  if (profile) {
    db.prepare("UPDATE users SET profile = ? WHERE id = ?").run(
      JSON.stringify(profile),
      req.params.id,
    );
  }
  if (nickname) {
    db.prepare("UPDATE users SET nick = ? WHERE id = ?").run(nickname, req.params.id);
  }

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  res.json({
    id: updated.id,
    publicKey: updated.key,
    namespace: updated.ns,
    nickname: updated.nick,
    profile: JSON.parse(updated.profile),
    permissions: JSON.parse(updated.perms),
  });
});

// DELETE /users/:id
router.delete("/:id", ownerOnly, (req, res) => {
  const id = req.params.id;
  const del = db.transaction(() => {
    db.prepare("DELETE FROM marks WHERE user = ?").run(id);
    db.prepare("DELETE FROM progress WHERE user = ?").run(id);
    db.prepare("DELETE FROM history WHERE user = ?").run(id);
    db.prepare("DELETE FROM groups WHERE user = ?").run(id);
    db.prepare("DELETE FROM settings WHERE id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE user = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  });
  del();
  res.json({ success: true, message: "account deleted" });
});

export default router;

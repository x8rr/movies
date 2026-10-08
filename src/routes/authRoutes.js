import { Router } from "express";
import { v7 as uuid } from "uuid";
import { db } from "../db.js";
import {
  verifyChallenge,
  signToken,
  sessionExpiry,
} from "../auth.js";

const router = Router();

// POST /auth/register/start
router.post("/register/start", (req, res) => {
  const code = uuid();
  const now = new Date();
  db.prepare(
    "INSERT INTO codes (code, flow, type, created, expires) VALUES (?, ?, ?, ?, ?)",
  ).run(
    code,
    "register",
    "register",
    now.toISOString(),
    new Date(now.getTime() + 600000).toISOString(),
  );
  res.json({ challenge: code });
});

// POST /auth/register/complete
router.post("/register/complete", (req, res) => {
  const { publicKey, challenge, namespace, device, profile } = req.body;
  if (!publicKey || !challenge?.code || !challenge?.signature || !namespace || !device) {
    return res.status(400).json({ error: "missing fields" });
  }

  const row = db
    .prepare("SELECT * FROM codes WHERE code = ? AND flow = 'register' AND expires > ?")
    .get(challenge.code, new Date().toISOString());
  if (!row) return res.status(400).json({ error: "invalid or expired challenge" });

  if (!verifyChallenge(publicKey, challenge.code, challenge.signature)) {
    return res.status(400).json({ error: "invalid signature" });
  }

  db.prepare("DELETE FROM codes WHERE code = ?").run(challenge.code);

  const existing = db.prepare("SELECT id FROM users WHERE key = ?").get(publicKey);
  if (existing) return res.status(400).json({ error: "user already exists" });

  const now = new Date().toISOString();
  const userId = uuid();
  const sessionId = uuid();
  const nick = namespace;
  const userAgent = req.headers["user-agent"] || "";

  db.prepare(
    "INSERT INTO users (id, key, ns, created, profile, nick) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(userId, publicKey, namespace, now, JSON.stringify(profile || {}), nick);

  db.prepare(
    "INSERT INTO sessions (id, user, created, seen, expires, device, agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(sessionId, userId, now, now, sessionExpiry(), device, userAgent);

  const token = signToken(sessionId);
  res.json({
    user: {
      id: userId,
      publicKey,
      namespace,
      nickname: nick,
      profile: profile || {},
      permissions: [],
    },
    session: {
      id: sessionId,
      user: userId,
      createdAt: now,
      accessedAt: now,
      expiresAt: sessionExpiry(),
      device,
      userAgent,
    },
    token,
  });
});

// POST /auth/login/start
router.post("/login/start", (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ error: "publicKey required" });

  const user = db.prepare("SELECT id FROM users WHERE key = ?").get(publicKey);
  if (!user) return res.status(404).json({ error: "user not found" });

  const code = uuid();
  const now = new Date();
  db.prepare(
    "INSERT INTO codes (code, flow, type, created, expires) VALUES (?, ?, ?, ?, ?)",
  ).run(
    code,
    "login",
    "login",
    now.toISOString(),
    new Date(now.getTime() + 600000).toISOString(),
  );
  res.json({ challenge: code });
});

// POST /auth/login/complete
router.post("/login/complete", (req, res) => {
  const { publicKey, challenge, device } = req.body;
  if (!publicKey || !challenge?.code || !challenge?.signature || !device) {
    return res.status(400).json({ error: "missing fields" });
  }

  const row = db
    .prepare("SELECT * FROM codes WHERE code = ? AND flow = 'login' AND expires > ?")
    .get(challenge.code, new Date().toISOString());
  if (!row) return res.status(400).json({ error: "invalid or expired challenge" });

  if (!verifyChallenge(publicKey, challenge.code, challenge.signature)) {
    return res.status(400).json({ error: "invalid signature" });
  }

  db.prepare("DELETE FROM codes WHERE code = ?").run(challenge.code);

  const user = db.prepare("SELECT * FROM users WHERE key = ?").get(publicKey);
  if (!user) return res.status(404).json({ error: "user not found" });

  const now = new Date().toISOString();
  const sessionId = uuid();
  const userAgent = req.headers["user-agent"] || "";

  db.prepare(`
    INSERT INTO sessions (id, user, created, seen, expires, device, agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user, device) DO UPDATE SET
      id = excluded.id, seen = excluded.seen, expires = excluded.expires, agent = excluded.agent
  `).run(sessionId, user.id, now, now, sessionExpiry(), device, userAgent);

  db.prepare("UPDATE users SET seen = ? WHERE id = ?").run(now, user.id);

  const token = signToken(sessionId);
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
      id: sessionId,
      user: user.id,
      createdAt: now,
      accessedAt: now,
      expiresAt: sessionExpiry(),
      device,
      userAgent,
    },
    token,
  });
});

export default router;

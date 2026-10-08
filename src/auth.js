import jwt from "jsonwebtoken";
import nacl from "tweetnacl";
import tnaclUtil from "tweetnacl-util";
const { decodeBase64, encodeBase64 } = tnaclUtil;
import { db } from "./db.js";

const SECRET = process.env.CRYPTO_SECRET || "dev-secret-change-me";
const SESSION_DAYS = 21;

export function signToken(sid) {
  return jwt.sign({ sid }, SECRET, { algorithm: "HS256" });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET, { algorithms: ["HS256"] });
}

export function verifyChallenge(publicKeyB64, code, signatureB64) {
  const pubKey = decodeBase64(publicKeyB64);
  const sig = decodeBase64(signatureB64);
  const msg = new TextEncoder().encode(code);
  return nacl.sign.detached.verify(msg, sig, pubKey);
}

export function derivePublicKey(seed) {
  const keyPair = nacl.sign.keyPair.fromSeed(decodeBase64(seed));
  return encodeBase64(keyPair.publicKey);
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const { sid } = verifyToken(header.slice(7));
    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ? AND expires > ?")
      .get(sid, new Date().toISOString());
    if (!session) return res.status(401).json({ error: "session expired" });

    db.prepare("UPDATE sessions SET seen = ?, expires = ? WHERE id = ?").run(
      new Date().toISOString(),
      sessionExpiry(),
      sid,
    );

    req.session = session;
    req.userId = session.user;
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}

export function ownerOnly(req, res, next) {
  if (req.params.id !== req.userId) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

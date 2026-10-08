import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { db } from "./db.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/users.js";
import bookmarkRoutes from "./routes/bookmarks.js";
import progressRoutes from "./routes/progress.js";
import historyRoutes from "./routes/history.js";
import settingsRoutes from "./routes/settings.js";
import sessionRoutes from "./routes/sessions.js";
import groupRoutes from "./routes/groups.js";
import streamRoutes from "./routes/stream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const VERSION = "1.0.0";

app.get("/", (_req, res) => {
  const desc = process.env.META_DESCRIPTION || "movies-api";
  res.json({ message: `${desc} [${VERSION}]` });
});

app.get("/meta", (_req, res) => {
  res.json({
    name: process.env.META_NAME || "movies-api",
    description: process.env.META_DESCRIPTION || "self-hosted pstream backend",
    version: VERSION,
    hasCaptcha: false,
    captchaClientKey: null,
  });
});

app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "unhealthy", database: "down" });
  }
});

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/users/:id/bookmarks", bookmarkRoutes);
app.use("/users/:id/progress", progressRoutes);
app.use("/users/:id/watch-history", historyRoutes);
app.use("/users/:id/settings", settingsRoutes);
app.use("/users/:id/sessions", sessionRoutes);
app.use("/users/:id/group-order", groupRoutes);
app.use("/sessions", sessionRoutes);
app.use("/api", streamRoutes);

app.listen(PORT, HOST, () => {
  console.log(`movies-api listening on ${HOST}:${PORT}`);
});

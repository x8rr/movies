import express from "express";
import cors from "cors";
import { tmdb } from "./tmdb.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";

app.get("/", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0" });
});

app.get("/meta", (_req, res) => {
  res.json({
    name: "movies-api",
    version: "1.0.0",
    hasTmdb: !!process.env.TMDB_API_KEY,
  });
});

// Search
app.get("/search/movie", async (req, res) => {
  const { query, page, year } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });
  const data = await tmdb("/search/movie", { query, page, year });
  res.json(data);
});

app.get("/search/tv", async (req, res) => {
  const { query, page, year } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });
  const data = await tmdb("/search/tv", { query, page, first_air_date_year: year });
  res.json(data);
});

app.get("/search/multi", async (req, res) => {
  const { query, page } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });
  const data = await tmdb("/search/multi", { query, page });
  res.json(data);
});

// Discover / trending
app.get("/trending/:type/:window", async (req, res) => {
  const { type, window } = req.params;
  const data = await tmdb(`/trending/${type}/${window}`, { page: req.query.page });
  res.json(data);
});

app.get("/discover/movie", async (req, res) => {
  const data = await tmdb("/discover/movie", req.query);
  res.json(data);
});

app.get("/discover/tv", async (req, res) => {
  const data = await tmdb("/discover/tv", req.query);
  res.json(data);
});

// Movie details
app.get("/movie/:id", async (req, res) => {
  const data = await tmdb(`/movie/${req.params.id}`, {
    append_to_response: "credits,videos,recommendations,similar,external_ids",
  });
  res.json(data);
});

// TV details
app.get("/tv/:id", async (req, res) => {
  const data = await tmdb(`/tv/${req.params.id}`, {
    append_to_response: "credits,videos,recommendations,similar,external_ids",
  });
  res.json(data);
});

app.get("/tv/:id/season/:season", async (req, res) => {
  const data = await tmdb(`/tv/${req.params.id}/season/${req.params.season}`);
  res.json(data);
});

app.get("/tv/:id/season/:season/episode/:episode", async (req, res) => {
  const { id, season, episode } = req.params;
  const data = await tmdb(`/tv/${id}/season/${season}/episode/${episode}`);
  res.json(data);
});

// Genres
app.get("/genre/movie/list", async (_req, res) => {
  const data = await tmdb("/genre/movie/list");
  res.json(data);
});

app.get("/genre/tv/list", async (_req, res) => {
  const data = await tmdb("/genre/tv/list");
  res.json(data);
});

// Person
app.get("/person/:id", async (req, res) => {
  const data = await tmdb(`/person/${req.params.id}`, {
    append_to_response: "combined_credits",
  });
  res.json(data);
});

app.listen(PORT, HOST, () => {
  console.log(`movies-api listening on ${HOST}:${PORT}`);
});

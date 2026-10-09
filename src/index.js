import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import streamRoutes from "./routes/stream.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.use("/api", streamRoutes);

app.listen(PORT, HOST, () => {
  console.log(`movies-api listening on ${HOST}:${PORT}`);
});

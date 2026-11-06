// vidup.to is the same VidFast-style white-label player as vidcore.io (identical
// bundle layout, obfuscated VM and API shape, own domain/deploy path), so it reuses
// the sandboxed-player extractor from vidcore.js.
import { vidfastFamilyExtract } from "./vidcore.js";

export async function vidupExtract(type, tmdbId, season, episode) {
  try {
    return await vidfastFamilyExtract({ base: "https://vidup.to", id: "vidup", name: "VidUp" }, type, tmdbId, season, episode);
  } catch (e) {
    console.log("[vidup] error:", e.message);
    return [];
  }
}

// vidfast is the origin of the VidFast-style player that vidcore.io and vidup.to
// white-label; it differs only in loading one of ~20 player builds per request
// (next/dynamic `variantIndex`), which the shared sandboxed extractor handles.
// vidfast.pro/.net redirect to the current domain (vidfast.vc as of 2026-11).
import { vidfastFamilyExtract } from "./vidcore.js";

export async function vidfastExtract(type, tmdbId, season, episode) {
  try {
    return await vidfastFamilyExtract({ base: "https://vidfast.pro", id: "vidfast", name: "VidFast" }, type, tmdbId, season, episode);
  } catch (e) {
    console.log("[vidfast] error:", e.message);
    return [];
  }
}

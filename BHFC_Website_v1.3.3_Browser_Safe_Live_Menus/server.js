import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;
const MENU_API_URL = process.env.MENU_API_URL || "https://bhfc-digital-menu.onrender.com/api/menu";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const GOOGLE_PLACE_ID = process.env.GOOGLE_PLACE_ID || "";
const GOOGLE_MAPS_EMBED_API_KEY = process.env.GOOGLE_MAPS_EMBED_API_KEY || "";
let placeCache = { expiresAt: 0, value: null };

app.disable("x-powered-by");
app.use(express.static(__dirname, {
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
    if (filePath.endsWith(".mp4")) {
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  }
}));

app.get("/api/live-menu", async (_req, res) => {
  try {
    const upstream = await fetch(MENU_API_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!upstream.ok) throw new Error(`Menu service returned ${upstream.status}`);
    res.set("Cache-Control", "no-store");
    res.json(await upstream.json());
  } catch (error) {
    res.status(503).json({ error: "Live menu temporarily unavailable", detail: error.message });
  }
});

async function getPlaceDetails() {
  const fallback = {
    configured: false,
    displayName: "Brunswick Heads Fish & Chippery",
    formattedAddress: "26 Mullumbimbi Street, Brunswick Heads NSW 2483",
    openNow: null,
    weekdayDescriptions: [
      "Monday: 11:30 am–7:00 pm", "Tuesday: 11:30 am–7:00 pm", "Wednesday: 11:30 am–7:00 pm",
      "Thursday: 11:30 am–7:00 pm", "Friday: 11:30 am–7:00 pm", "Saturday: 11:30 am–7:00 pm", "Sunday: 11:30 am–7:00 pm"
    ],
    rating: null, userRatingCount: null,
    googleMapsUri: "https://www.google.com/maps/place/Brunswick+Heads+Fish+and+Chippery/@-28.5396668,153.5514526,20z"
  };
  if (!GOOGLE_PLACES_API_KEY || !GOOGLE_PLACE_ID) return fallback;
  if (placeCache.value && Date.now() < placeCache.expiresAt) return placeCache.value;
  const fields = ["displayName","formattedAddress","regularOpeningHours","currentOpeningHours","rating","userRatingCount","googleMapsUri"].join(",");
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(GOOGLE_PLACE_ID)}`, {
    headers: { "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": fields, "Accept-Language": "en-AU" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}`);
  const p = await response.json();
  const current = p.currentOpeningHours || {};
  const regular = p.regularOpeningHours || {};
  const value = {
    configured: true,
    displayName: p.displayName?.text || fallback.displayName,
    formattedAddress: p.formattedAddress || fallback.formattedAddress,
    openNow: typeof current.openNow === "boolean" ? current.openNow : (typeof regular.openNow === "boolean" ? regular.openNow : null),
    weekdayDescriptions: current.weekdayDescriptions || regular.weekdayDescriptions || fallback.weekdayDescriptions,
    nextOpenTime: current.nextOpenTime || null,
    nextCloseTime: current.nextCloseTime || null,
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    googleMapsUri: p.googleMapsUri || fallback.googleMapsUri
  };
  placeCache = { expiresAt: Date.now() + 900000, value };
  return value;
}

app.get("/api/google-place", async (_req, res) => {
  try { res.json(await getPlaceDetails()); }
  catch { res.status(503).json({ error: "Google business details unavailable" }); }
});
app.get("/api/google-map-config", (_req, res) => res.json({
  configured: Boolean(GOOGLE_MAPS_EMBED_API_KEY && GOOGLE_PLACE_ID),
  placeId: GOOGLE_PLACE_ID,
  embedKey: GOOGLE_MAPS_EMBED_API_KEY
}));
app.get("/health", (_req, res) => res.json({ ok: true, version: "1.2.0", videos: ["hero-reel.mp4","fresh-prep.mp4","captains-pantry.mp4","brunswick-drone.mp4"] }));
app.use((_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`BHFC Website v1.2 Mobile Menu Fix running on port ${PORT}`));

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
const GOOGLE_CACHE_MS = 15 * 60 * 1000;
let googlePlaceCache = { expiresAt: 0, value: null };

app.disable("x-powered-by");

// Stage 1.4 deliberately supports the flat GitHub upload structure.
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "1h" }));
app.use(express.static(__dirname, {
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
  }
}));


async function fetchGooglePlaceDetails() {
  if (!GOOGLE_PLACES_API_KEY || !GOOGLE_PLACE_ID) {
    return {configured:false,fallback:true,displayName:"Brunswick Heads Fish & Chippery",formattedAddress:"26 Mullumbimbi Street, Brunswick Heads NSW 2483",openNow:null,weekdayDescriptions:["Monday: 11:30 am–7:00 pm","Tuesday: 11:30 am–7:00 pm","Wednesday: 11:30 am–7:00 pm","Thursday: 11:30 am–7:00 pm","Friday: 11:30 am–7:00 pm","Saturday: 11:30 am–7:00 pm","Sunday: 11:30 am–7:00 pm"],rating:null,userRatingCount:null,googleMapsUri:"https://www.google.com/maps/place/Brunswick+Heads+Fish+and+Chippery/@-28.5396668,153.5514526,20z/data=!4m6!3m5!1s0x6b908b11aeaf1e3f:0x3bf433e546932bda!8m2!3d-28.5395601!4d153.5511915!16s%2Fg%2F11xncppqxh"};
  }
  if (googlePlaceCache.value && Date.now() < googlePlaceCache.expiresAt) return googlePlaceCache.value;
  const fieldMask=["displayName","formattedAddress","regularOpeningHours","currentOpeningHours","rating","userRatingCount","googleMapsUri"].join(",");
  const response=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(GOOGLE_PLACE_ID)}`,{headers:{"X-Goog-Api-Key":GOOGLE_PLACES_API_KEY,"X-Goog-FieldMask":fieldMask,"Accept-Language":"en-AU"},signal:AbortSignal.timeout(12000)});
  if(!response.ok){const detail=await response.text();throw new Error(`Google Places returned ${response.status}: ${detail.slice(0,180)}`)}
  const place=await response.json(); const current=place.currentOpeningHours||{}; const regular=place.regularOpeningHours||{};
  const value={configured:true,fallback:false,displayName:place.displayName?.text||"Brunswick Heads Fish & Chippery",formattedAddress:place.formattedAddress||"26 Mullumbimbi Street, Brunswick Heads NSW 2483",openNow:typeof current.openNow==="boolean"?current.openNow:(typeof regular.openNow==="boolean"?regular.openNow:null),weekdayDescriptions:current.weekdayDescriptions||regular.weekdayDescriptions||[],nextOpenTime:current.nextOpenTime||null,nextCloseTime:current.nextCloseTime||null,rating:place.rating??null,userRatingCount:place.userRatingCount??null,googleMapsUri:place.googleMapsUri||null,fetchedAt:new Date().toISOString()};
  googlePlaceCache={expiresAt:Date.now()+GOOGLE_CACHE_MS,value}; return value;
}

app.get("/api/live-menu", async (_req, res) => {
  try {
    const upstream = await fetch(MENU_API_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) throw new Error(`Menu service returned ${upstream.status}`);
    const data = await upstream.json();
    res.set("Cache-Control", "no-store");
    res.json(data);
  } catch (error) {
    res.status(503).json({ error: "Live menu temporarily unavailable", detail: error.message });
  }
});


app.get("/api/google-place", async (_req, res) => {
  try {const details=await fetchGooglePlaceDetails();res.set("Cache-Control","public, max-age=300, stale-while-revalidate=600");res.json(details)}
  catch(error){console.error("Google service layer error:",error.message);res.status(503).json({configured:Boolean(GOOGLE_PLACES_API_KEY&&GOOGLE_PLACE_ID),fallback:true,error:"Google business details temporarily unavailable",displayName:"Brunswick Heads Fish & Chippery",formattedAddress:"26 Mullumbimbi Street, Brunswick Heads NSW 2483",openNow:null,weekdayDescriptions:["Monday: 11:30 am–7:00 pm","Tuesday: 11:30 am–7:00 pm","Wednesday: 11:30 am–7:00 pm","Thursday: 11:30 am–7:00 pm","Friday: 11:30 am–7:00 pm","Saturday: 11:30 am–7:00 pm","Sunday: 11:30 am–7:00 pm"],rating:null,userRatingCount:null,googleMapsUri:"https://www.google.com/maps/place/Brunswick+Heads+Fish+and+Chippery/@-28.5396668,153.5514526,20z/data=!4m6!3m5!1s0x6b908b11aeaf1e3f:0x3bf433e546932bda!8m2!3d-28.5395601!4d153.5511915!16s%2Fg%2F11xncppqxh"})}
});

app.get("/api/google-map-config", (_req,res)=>res.json({configured:Boolean(GOOGLE_MAPS_EMBED_API_KEY&&GOOGLE_PLACE_ID),embedKey:GOOGLE_MAPS_EMBED_API_KEY,placeId:GOOGLE_PLACE_ID}));

app.get("/health", (_req, res) => res.json({ ok: true, version: "1.7.0", menuApi: MENU_API_URL, googlePlacesConfigured: Boolean(GOOGLE_PLACES_API_KEY && GOOGLE_PLACE_ID) }));
app.use((_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`BHFC Website Stage 1.7 running on port ${PORT}`));

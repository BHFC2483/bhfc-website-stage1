import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;
const MENU_API_URL = process.env.MENU_API_URL || "https://bhfc-digital-menu.onrender.com/api/menu";

app.disable("x-powered-by");

// Stage 1.2 deliberately supports the flat GitHub upload structure.
app.use("/assets", express.static(__dirname, { maxAge: "1h" }));
app.use(express.static(__dirname, {
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
  }
}));

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

app.get("/health", (_req, res) => res.json({ ok: true, version: "1.2.0", menuApi: MENU_API_URL }));
app.use((_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`BHFC Website Stage 1.2 running on port ${PORT}`));

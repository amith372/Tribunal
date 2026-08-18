/**
 * index.ts — the routing layer, deliberately thin.
 *
 * specs.md Part 3: the pipeline stages stay plain functions this layer calls, so each
 * is testable without a running server. In production this process also serves the
 * built frontend, so the app is one Render service on one URL with no CORS.
 */

import express from "express";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "./env.js";
import { getServerConfig } from "./config.js";
import { DataError, loadData, type TribunalData } from "./data.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The data files are the only source of character facts, so a problem with them is
 * fatal at startup rather than a surprise on the first run.
 */
let data: TribunalData;
try {
  data = loadData();
} catch (error) {
  const message = error instanceof DataError ? error.message : String(error);
  console.error(`\nCould not load the data files.\n  ${message}\n`);
  process.exit(1);
}

const config = getServerConfig();
const app = express();
app.use(express.json({ limit: "64kb" }));

/**
 * Health, and the proof that `data/` was found and parsed. Deliberately needs no API
 * key — the app must be runnable and checkable without one, and the keep-warm pinger
 * hits this endpoint too.
 */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    characters: data.characters.map((c) => c.name),
    judges: data.judges.map((j) => j.name),
    relations: data.relations.length,
    apiKeyConfigured: config.apiKey !== null,
  });
});

// In production the Vite build sits next to the server build and is served from here.
const webDist = resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(join(webDist, "index.html"));
  });
}

app.listen(config.port, () => {
  console.log(`The Tribunal — server on http://localhost:${config.port}`);
  console.log(`  data:   ${data.dataDir}`);
  console.log(`  loaded: ${data.characters.length} characters, ${data.judges.length} judges`);
  if (!config.apiKey) {
    console.log("  note:   OPENROUTER_API_KEY is not set — model calls will refuse, health is fine.");
  }
});

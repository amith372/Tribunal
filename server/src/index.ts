/**
 * index.ts — the entry point, and nothing else.
 *
 * The routes live in `app.ts` so a test can build the app with its own data and a scripted
 * caller. This file only does the two things a test must not: read the environment and
 * bind a port.
 */

import "./env.js";
import { archiveFromEnv } from "./archive.js";
import { createApp } from "./app.js";
import { getServerConfig } from "./config.js";
import { DataError, loadData, type TribunalData } from "./data.js";
import { RUN_TIMEOUT_MS } from "./run.js";

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
const archive = archiveFromEnv();
const app = createApp({ data, archive });

const server = app.listen(config.port, () => {
  console.log(`The Tribunal — server on http://localhost:${config.port}`);
  console.log(`  data:   ${data.dataDir}`);
  console.log(`  loaded: ${data.characters.length} characters, ${data.judges.length} judges`);
  console.log(`  run:    POST /api/run — an SSE stream, capped at ${RUN_TIMEOUT_MS / 1000}s`);
  if (!config.apiKey) {
    console.log("  note:   OPENROUTER_API_KEY is not set — model calls will refuse, health is fine.");
  }
  if (!archive) {
    console.log("  note:   MONGODB_URI is not set — runs are not archived.");
  }
});

/**
 * A run is held in memory and streamed, so a socket may be open with a wave in flight.
 * Node's default keep-alive timeouts are shorter than a run: a proxy or agent that reuses
 * a connection could otherwise have it closed underneath a stream that had nothing to say
 * for a minute.
 */
server.keepAliveTimeout = RUN_TIMEOUT_MS + 30_000;
server.headersTimeout = RUN_TIMEOUT_MS + 40_000;

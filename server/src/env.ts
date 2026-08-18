/**
 * env.ts — loads `.env` from the repo root before anything reads `process.env`.
 *
 * On Render the variables are set on the service and there is no file, so a missing
 * `.env` is not an error. Imported for its side effect only.
 */

import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// `server/src` in development, `server/dist` in production — the repo root is two up
// from either.
loadEnv({ path: resolve(here, "../../.env"), quiet: true });

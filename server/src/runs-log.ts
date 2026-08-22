/**
 * runs-log.ts — one line of JSON per finished run, appended to `runs.jsonl` at the repo
 * root. Gitignored, local, and never read back by the app.
 *
 * **This is not a database and does not make one.** specs.md Part 3's no-database
 * decision is about what the *app* depends on: nothing here is queried, indexed, shown,
 * or needed to render anything, and deleting the file mid-run changes nothing. It exists
 * because free models fail in ways that are hard to reproduce — a model delisted for an
 * hour, a 429 that only appears at a certain time of day, a reply that parsed on Tuesday
 * and not on Wednesday — and a failure with no record of the raw response behind it
 * cannot be diagnosed at all. It writes the whole record, raw bodies included, for that
 * reason.
 *
 * A failure to write is logged and swallowed: a debugging aid must never be able to take
 * down the run it was meant to explain.
 */

import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RunRecord } from "./aggregate.js";

const here = dirname(fileURLToPath(import.meta.url));

/** `server/src` in development, `server/dist` in production — the root is two up. */
export const RUNS_LOG_PATH = resolve(here, "../../runs.jsonl");

export async function appendRun(runId: string, record: RunRecord, path = RUNS_LOG_PATH): Promise<void> {
  try {
    await appendFile(path, `${JSON.stringify({ runId, record })}\n`, "utf8");
  } catch (error) {
    console.warn(`Could not append to ${path}: ${(error as Error).message}`);
  }
}

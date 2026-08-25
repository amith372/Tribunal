/**
 * What this browser remembers about runs, in two unrelated shapes stored two unrelated
 * ways — neither one a database, and neither one a charge sheet, a statement or a verdict.
 *
 * **The rejoin pointer**, `rememberRun`/`rememberedRun`: where a run id is parked so a
 * reloaded tab rejoins the trial instead of re-running it. specs.md Part 3: the server
 * holds a run by its identifier while it is in flight and for a few minutes after, so a
 * reconnecting browser is sent everything that has arrived and then continues.
 * `run-stream.ts` uses that for a dropped socket; this is the same rule one level up, for a
 * dropped *page* — a refresh mid-trial would otherwise throw away seven requests and
 * immediately spend seven more. `sessionStorage`, and only an id: scoped to the one tab and
 * cleared when that tab closes, which matches what is stored — a pointer to a run this tab
 * was watching a moment ago, useless once the server's buffer lets the run go.
 *
 * **The archive list**, `rememberArchivedRun`/`archivedRunIds`/`forgetArchivedRun`: the
 * ids of runs this browser has *finished*, so the archive screen has something to ask the
 * server about. specs.md Part 3's per-browser rule: the server archives every run, but a
 * browser only ever lists the ids it kept itself — a run is not discoverable by anyone who
 * does not hold its id. `localStorage`, not `sessionStorage`, because the point is that it
 * survives closing the tab; still only ids, so no charge sheet, no statement, no verdict
 * and no total is written into the browser here either.
 */

export const RUN_ID_KEY = "tribunal.runId";
export const ARCHIVE_KEY = "tribunal.archive";

/** How many finished runs one browser remembers. Older ids fall off the end. */
const ARCHIVE_CAP = 50;

export function rememberRun(runId: string | null): void {
  try {
    if (runId === null) sessionStorage.removeItem(RUN_ID_KEY);
    else sessionStorage.setItem(RUN_ID_KEY, runId);
  } catch {
    // A browser refusing storage — a private window, or site data blocked — costs the
    // rejoin and nothing else. Everything else on this screen works exactly as before.
  }
}

export function rememberedRun(): string | null {
  try {
    return sessionStorage.getItem(RUN_ID_KEY);
  } catch {
    return null;
  }
}

function readArchiveIds(): string[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeArchiveIds(ids: readonly string[]): void {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ids));
  } catch {
    // A browser refusing storage costs the list and nothing else — the run itself is
    // still archived server-side, this tab simply will not offer it back.
  }
}

/** Adds a run id to the front of the list, deduped, capped at `ARCHIVE_CAP`. */
export function rememberArchivedRun(runId: string): void {
  const deduped = [runId, ...readArchiveIds().filter((id) => id !== runId)];
  writeArchiveIds(deduped.slice(0, ARCHIVE_CAP));
}

/** Newest first — the order runs were added in, which is the order they finished. */
export function archivedRunIds(): readonly string[] {
  return readArchiveIds();
}

export function forgetArchivedRun(runId: string): void {
  writeArchiveIds(readArchiveIds().filter((id) => id !== runId));
}

/**
 * Where a run id is parked so a reloaded tab rejoins the trial instead of re-running it.
 *
 * specs.md Part 3: the server holds a run by its identifier while it is in flight and for
 * a few minutes after, so a reconnecting browser is sent everything that has arrived and
 * then continues. `run-stream.ts` uses that for a dropped socket; this is the same rule
 * one level up, for a dropped *page* — a refresh mid-trial would otherwise throw away
 * seven requests and immediately spend seven more.
 *
 * **`sessionStorage`, and only an id.** It is scoped to the one tab and cleared when that
 * tab closes, which matches what is stored: not a run, not a result, just a pointer to a
 * run this tab was watching a moment ago. The no-database decision is untouched — nothing
 * about the case, the statements or the verdicts is written anywhere on this machine, and
 * the id itself is useless once the server's buffer lets the run go.
 */

export const RUN_ID_KEY = "tribunal.runId";

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

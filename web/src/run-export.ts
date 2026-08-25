/**
 * run-export.ts — fetching the run record and handing it to the user as a file.
 *
 * **The file is built on the server, and this only carries it.** specs.md Part 3 makes the
 * exported HTML the run record itself, and Part 2 requires its numbers to match what the
 * app showed. Both are held by there being one builder — `server/src/export.ts`, a pure
 * function of the same `RunRecord` these panels render, reachable by the test suite. A
 * second builder here would be a second place the numbers exist, and it would be checkable
 * only by someone remembering to open the file. It also has something the browser does not:
 * the raw response bodies, which Part 3 requires the record to carry.
 *
 * **It is fetched when the run finishes, not when the button is pressed.** The server holds
 * a finished run in memory for ten minutes (`run-buffer.ts`) and then lets it go; past that
 * the file is rebuilt from the archive instead, so the record itself is no longer what is at
 * risk. What asking early still buys is that the file is already in hand when the button is
 * pressed — the press is then purely local, and it works whether or not the server is still
 * reachable, which is the one thing no fallback route can promise.
 *
 * **Memoised at module scope, for the same reason `run-session.ts` is.** React runs effects
 * twice in development on purpose, and a panel that mounts, unmounts and mounts again would
 * otherwise ask three times for a file it already has. This costs nothing against the model
 * allowance — it is a request to our own server — but a screen that quietly does its work
 * three times is the pattern this app has already been bitten by once.
 */

export interface ExportedRecord {
  readonly filename: string;
  readonly html: string;
}

/** One promise per run id: asked once, reused by every panel that wants it. */
const inFlight = new Map<string, Promise<ExportedRecord>>();

const FALLBACK_NAME = "tribunal-run.html";

/**
 * The name the server chose, read off `Content-Disposition`.
 *
 * The filename carries the defendant and the run's own timestamp so two exports never land
 * on one another (and re-exporting one run twice gives one name). It is worked out where
 * the file is built rather than here, so there is one place it is decided.
 */
function filenameFrom(header: string | null): string {
  if (header === null) return FALLBACK_NAME;
  const quoted = /filename="([^"]+)"/.exec(header);
  return quoted ? quoted[1] : FALLBACK_NAME;
}

async function request(runId: string): Promise<ExportedRecord> {
  const id = encodeURIComponent(runId);
  let response = await fetch(`/api/run/${id}/export`);

  // The buffer is tried first — a run just finished is served from memory, no extra
  // round trip. A 404 there means the buffer has let the run go; the archive is tried
  // next, once, before giving up. Any other refusal (still in flight, never existed)
  // already says the right thing and is not worth a second request.
  if (response.status === 404) {
    response = await fetch(`/api/archive/${id}/export`);
  }

  if (!response.ok) {
    // The server's own words: it knows whether the run is still held, still running, or
    // simply never existed, and each of those is a different thing to tell the user.
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      body?.error ??
        `The server answered HTTP ${response.status} when asked for this run's record.`,
    );
  }

  return {
    filename: filenameFrom(response.headers.get("content-disposition")),
    html: await response.text(),
  };
}

/** The exported record for a run, fetched at most once per page load. */
export function exportOf(runId: string): Promise<ExportedRecord> {
  const held = inFlight.get(runId);
  if (held) return held;

  // A failure is not cached: the usual cause is a moment's flakiness, and a user who
  // presses "try again" should get a real second attempt rather than the first refusal.
  const pending = request(runId).catch((error: unknown) => {
    inFlight.delete(runId);
    throw error;
  });
  inFlight.set(runId, pending);
  return pending;
}

/**
 * Saves the record to disk.
 *
 * A blob URL rather than a link to the endpoint, because the file is already here: the
 * download then works without a second request, which is the point of fetching it early.
 * The object URL is released on the next frame — the download has
 * started by then, and holding it would keep 70 KB alive for the life of the tab.
 */
export function saveExport(file: ExportedRecord): void {
  const url = URL.createObjectURL(new Blob([file.html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

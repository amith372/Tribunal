/**
 * `GET /api/run/:id/export` — the run record, as the file a user keeps.
 *
 * specs.md Part 3 makes the exported HTML the run record; Part 2 requires its numbers to
 * match what the app showed. `export.test.ts` already holds the file itself to those
 * claims. What is asserted here is only what the *endpoint* is responsible for:
 *
 *   · the bytes it serves are `buildExportHtml` of the very record that closed the stream —
 *     which is what makes "the export's numbers match the panels" true by construction
 *     rather than by two renderers happening to agree;
 *   · it is served as a download, named for the defendant and the run;
 *   · a run still in flight has no record yet, and says so rather than exporting half of one;
 *   · a run the buffer has let go of says that too, in words, rather than 404-ing blankly.
 *
 * Zero model calls: the app is built with a scripted caller and no key leaves the process.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp, type AppOptions } from "../app.js";
import type { RunRecord } from "../aggregate.js";
import { buildExportHtml, exportFileName } from "../export.js";
import { loadData } from "../data.js";
import { RunBuffer } from "../run-buffer.js";
import { fakeResult } from "./fake-caller.js";
import type { CallOptions, CallResult } from "../openrouter.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";

const data = loadData();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let hadKey: string | undefined;
beforeAll(() => {
  hadKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key-never-sent-anywhere";
});
afterAll(() => {
  if (hadKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = hadKey;
});

const VALID_BODY = {
  chargeSheet: PART_4_CHARGE_SHEET,
  defendant: "jon-snow",
  advocates: PART_4_CAST,
};

function caller(delayMs = 0) {
  return async (options: CallOptions): Promise<CallResult> => {
    if (delayMs > 0) await sleep(delayMs);
    return fakeResult(
      options,
      options.label.startsWith("judge:")
        ? "Verdict: guilty. He was sworn to her. She was unarmed when he struck."
        : "The realm was already burning when he acted, and the charge sheet says so.",
    );
  };
}

async function serve(options: Omit<AppOptions, "data"> = {}): Promise<{
  url: string;
  buffer: RunBuffer;
  stop: () => Promise<void>;
}> {
  const buffer = options.buffer ?? new RunBuffer();
  const app = createApp({ data, logRuns: false, ...options, buffer });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    buffer,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * Runs a case to its end and hands back the run's id and the full record that closed it
 * — read from the buffer's own storage, not off the SSE wire, since what reaches the
 * browser there is deliberately trimmed (`record-view.ts`) and is missing the raw
 * response bodies `buildExportHtml` needs.
 */
async function runOnce(url: string, buffer: RunBuffer): Promise<{ runId: string; record: RunRecord }> {
  const response = await fetch(`${url}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(VALID_BODY),
  });
  const text = await response.text();

  let runId = "";
  for (const block of text.split("\n\n")) {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    const payload = lines.find((line) => line.startsWith("data: "))?.slice(6);
    if (event === "preflight" && payload) runId = (JSON.parse(payload) as { runId: string }).runId;
  }

  const done = buffer.get(runId)?.events.find((e) => e.event === "done");
  if (!done) throw new Error("the run produced no record");
  return { runId, record: done.data as RunRecord };
}

describe("the exported file is the record the app rendered", () => {
  it("serves exactly what the record renders to, and nothing rebuilt", async () => {
    const { url, buffer, stop } = await serve({ call: caller() });
    const { runId, record } = await runOnce(url, buffer);

    const response = await fetch(`${url}/api/run/${runId}/export`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);

    // Byte-for-byte the same file the pure builder makes from the record that closed the
    // stream. There is one place the numbers exist, and this is the proof of it.
    expect(await response.text()).toBe(buildExportHtml(record));

    await stop();
  });

  it("carries the run's own totals, so the panel and the file cannot disagree", async () => {
    const { url, buffer, stop } = await serve({ call: caller() });
    const { runId, record } = await runOnce(url, buffer);

    const html = await (await fetch(`${url}/api/run/${runId}/export`)).text();
    expect(html).toContain(record.totals.totalTokens.toLocaleString("en-US"));
    expect(html).toContain("$0");

    await stop();
  });

  it("is offered as a download, named for the defendant and the run", async () => {
    const { url, buffer, stop } = await serve({ call: caller() });
    const { runId, record } = await runOnce(url, buffer);

    const response = await fetch(`${url}/api/run/${runId}/export`);
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(exportFileName(record));
    expect(disposition).toContain("jon-snow");

    await stop();
  });
});

describe("there is nothing to export until there is a record", () => {
  it("refuses a run still in flight, rather than exporting half of one", async () => {
    const { url, stop } = await serve({ call: caller(120) });

    // Start the run and read only far enough to learn its id; the bench is still out.
    const response = await fetch(`${url}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    /**
     * Read until the id appears rather than assuming the first chunk carries it.
     *
     * `openSse` writes its `retry:` directive before any event, and whether that shares a
     * TCP chunk with the `preflight` frame is a timing accident. Taking only the first
     * chunk made this test fail about once in ten runs — which in a pre-commit gate is
     * worse than a test that fails always, because it teaches people to re-run it.
     */
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let seen = "";
    let runId = "";
    while (runId === "" && !/event: done/.test(seen)) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      runId = /"runId":"([^"]+)"/.exec(seen)?.[1] ?? "";
    }
    expect(runId).not.toBe("");

    const attempt = await fetch(`${url}/api/run/${runId}/export`);
    expect(attempt.status).toBe(409);
    expect(((await attempt.json()) as { error: string }).error).toMatch(/has not finished/);

    await reader.cancel();
    await stop();
  });

  it("says in words that a run it no longer holds is gone", async () => {
    const { url, stop } = await serve({ call: caller() });

    const response = await fetch(`${url}/api/run/00000000-0000-4000-8000-000000000000/export`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    // The user's own copy is the record; the message says so rather than only refusing.
    expect(body.error).toMatch(/not being held/);
    expect(body.error).toMatch(/still the record/);

    await stop();
  });
});

describe("the filename", () => {
  it("carries the defendant and the run's own start, so two exports never collide", () => {
    const name = exportFileName({
      defendant: { id: "jon-snow", name: "Jon Snow" },
      startedAt: "2026-08-21T10:00:00.000Z",
    } as RunRecord);
    expect(name).toBe("tribunal-jon-snow-2026-08-21T10-00-00-000.html");
  });

  it("is the same name for the same record, however often it is exported", () => {
    const record = {
      defendant: { id: "jon-snow", name: "Jon Snow" },
      startedAt: "2026-08-21T10:00:00.000Z",
    } as RunRecord;
    expect(exportFileName(record)).toBe(exportFileName(record));
  });

  it("survives a name with punctuation in it", () => {
    const name = exportFileName({
      defendant: { id: "grey-worm", name: "Grey Worm (the Unsullied)" },
      startedAt: "2026-08-21T10:00:00.000Z",
    } as RunRecord);
    expect(name).toMatch(/^tribunal-grey-worm-the-unsullied-/);
    expect(name).not.toMatch(/[()]/);
  });
});

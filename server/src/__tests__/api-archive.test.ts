/**
 * The three archive routes — `POST /api/archive/list`, `GET /api/archive/:id`,
 * `GET /api/archive/:id/export` — driven over a real socket with `memoryArchive()`.
 *
 * Mirrors the structure of `api-export.test.ts`. What is asserted here is only what the
 * routing layer is responsible for, since `archive-shape.test.ts` already holds the
 * translation itself to the round-trip:
 *
 *   · list resolves ids to summaries, newest first, and caps and rejects a bad body;
 *   · get returns the trimmed record shape — no raw response bodies, no judge `rawText`
 *     — the same one a live run's `done` event carries;
 *   · export rebuilds the same file `buildExportHtml` would, from the archive alone;
 *   · all three 404 when no archive is configured, rather than crashing.
 *
 * Zero model calls: the app is built with a scripted caller and no key leaves the process.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp, type AppOptions } from "../app.js";
import { memoryArchive, type RunArchive } from "../archive.js";
import type { RunRecord } from "../aggregate.js";
import { buildExportHtml } from "../export.js";
import { loadData } from "../data.js";
import { fakeResult } from "./fake-caller.js";
import type { CallOptions, CallResult } from "../openrouter.js";
import { PART_4_CAST, PART_4_CHARGE_SHEET } from "./preflight-cases.js";

const data = loadData();

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

function caller() {
  return async (options: CallOptions): Promise<CallResult> =>
    fakeResult(
      options,
      options.label.startsWith("judge:")
        ? "Verdict: guilty. He was sworn to her. She was unarmed when he struck."
        : "The realm was already burning when he acted, and the charge sheet says so.",
    );
}

async function serve(options: Omit<AppOptions, "data"> = {}): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const app = createApp({ data, logRuns: false, ...options });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * Runs a case to its end over the real socket, waits for the fire-and-forget save to
 * land, and hands back the full record straight from the archive — not off the SSE wire,
 * since what reaches the browser there is deliberately trimmed (`record-view.ts`).
 */
async function runAndArchive(
  url: string,
  archive: RunArchive,
): Promise<{ runId: string; record: RunRecord }> {
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

  // The response has already closed by the time it is fully read, so the fire-and-forget
  // save issued from the same `.then()` has had every chance to run by now.
  await new Promise((resolve) => setImmediate(resolve));

  const found = await archive.get(runId);
  if (!found) throw new Error("the run was not archived");
  return found;
}

describe("POST /api/archive/list", () => {
  it("resolves known ids to summaries, newest first", async () => {
    const archive = memoryArchive();
    const { url, stop } = await serve({ call: caller(), archive });

    const first = await runAndArchive(url, archive);
    const second = await runAndArchive(url, archive);

    const response = await fetch(`${url}/api/archive/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [first.runId, second.runId] }),
    });
    const body = (await response.json()) as { ok: boolean; runs: { runId: string }[] };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.runs.map((r) => r.runId)).toEqual([second.runId, first.runId]);

    await stop();
  });

  it("silently drops an id the archive has never heard of", async () => {
    const archive = memoryArchive();
    const { url, stop } = await serve({ call: caller(), archive });
    const { runId } = await runAndArchive(url, archive);

    const response = await fetch(`${url}/api/archive/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [runId, "00000000-0000-4000-8000-000000000000"] }),
    });
    const body = (await response.json()) as { runs: { runId: string }[] };

    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]?.runId).toBe(runId);

    await stop();
  });

  it("caps the id list rather than growing the query without bound", async () => {
    const archive = memoryArchive();
    const { url, stop } = await serve({ call: caller(), archive });

    const ids = Array.from({ length: 150 }, (_, i) => `not-a-real-id-${i}`);
    const response = await fetch(`${url}/api/archive/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });

    expect(response.status).toBe(200);
    await stop();
  });

  it("rejects a body whose ids are not an array", async () => {
    const { url, stop } = await serve({ call: caller(), archive: memoryArchive() });

    const response = await fetch(`${url}/api/archive/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: "not-an-array" }),
    });

    expect(response.status).toBe(400);
    await stop();
  });

  it("404s when no archive is configured", async () => {
    const { url, stop } = await serve({ call: caller() });

    const response = await fetch(`${url}/api/archive/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });

    expect(response.status).toBe(404);
    await stop();
  });
});

describe("GET /api/archive/:id", () => {
  it("returns the record shaped for the browser — no raw bodies, no judge rawText", async () => {
    const archive = memoryArchive();
    const { url, stop } = await serve({ call: caller(), archive });
    const { runId } = await runAndArchive(url, archive);

    const response = await fetch(`${url}/api/archive/${runId}`);
    const body = (await response.json()) as { ok: boolean; runId: string; record: RunRecord };

    expect(response.status).toBe(200);
    expect(body.runId).toBe(runId);
    expect(body.record.outcome.kind).toBe("verdict");
    const raw = JSON.stringify(body.record);
    expect(raw).not.toMatch(/rawText/);
    expect(raw).not.toMatch(/"raw":/);
    expect(raw).not.toMatch(/httpStatus/);
    expect(raw).not.toMatch(/retryReason/);

    await stop();
  });

  it("404s for an id the archive does not hold", async () => {
    const { url, stop } = await serve({ call: caller(), archive: memoryArchive() });

    const response = await fetch(`${url}/api/archive/00000000-0000-4000-8000-000000000000`);
    expect(response.status).toBe(404);

    await stop();
  });

  it("404s when no archive is configured", async () => {
    const { url, stop } = await serve({ call: caller() });

    const response = await fetch(`${url}/api/archive/00000000-0000-4000-8000-000000000000`);
    expect(response.status).toBe(404);

    await stop();
  });
});

describe("GET /api/archive/:id/export", () => {
  it("rebuilds the same export the live run would have served", async () => {
    const archive = memoryArchive();
    const { url, stop } = await serve({ call: caller(), archive });
    const { runId, record } = await runAndArchive(url, archive);

    const response = await fetch(`${url}/api/archive/${runId}/export`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(await response.text()).toBe(buildExportHtml(record));

    await stop();
  });

  it("404s for an id the archive does not hold", async () => {
    const { url, stop } = await serve({ call: caller(), archive: memoryArchive() });

    const response = await fetch(`${url}/api/archive/00000000-0000-4000-8000-000000000000/export`);
    expect(response.status).toBe(404);

    await stop();
  });

  it("404s when no archive is configured", async () => {
    const { url, stop } = await serve({ call: caller() });

    const response = await fetch(`${url}/api/archive/00000000-0000-4000-8000-000000000000/export`);
    expect(response.status).toBe(404);

    await stop();
  });
});

describe("GET /api/run/:id/export falls back to the archive", () => {
  it("serves the export from the archive once the buffer no longer holds the run", async () => {
    const archive = memoryArchive();
    const { url, stop } = await serve({ call: caller(), archive });
    const { runId, record } = await runAndArchive(url, archive);

    // A fresh buffer, same archive: simulates the ten-minute hold having lapsed without
    // waiting ten minutes in a test.
    const app2 = createApp({ data, logRuns: false, call: caller(), archive });
    const server2: Server = await new Promise((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    const { port } = server2.address() as AddressInfo;
    const url2 = `http://127.0.0.1:${port}`;

    const response = await fetch(`${url2}/api/run/${runId}/export`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(buildExportHtml(record));

    await new Promise((resolve) => server2.close(() => resolve(undefined)));
    await stop();
  });
});

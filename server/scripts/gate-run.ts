/**
 * gate-run.ts — the live-run gate, as one command that says what it found.
 *
 * This drives `POST /api/run` over real HTTP exactly as a browser will: it reads the
 * response body as a stream and prints each event the moment it lands, stamped with how
 * long after the request it arrived. The stamps are the point. What has to be confirmed
 * is not that the events are correct — the tests cover that — but that they arrive **one
 * at a time across a minute or two** rather than all together at the end. A buffered
 * response would show every event at nearly the same offset, and Stage 7's avatars, which
 * move as each statement lands, cannot work against a stream that behaves that way.
 *
 * It checks the server is up before spending anything, and it answers the gate's questions
 * at the end instead of leaving them to be read out of JSON by eye. Five of them are the
 * streaming endpoint's own; the last two are carried from Stage 3, which failed live on
 * 2026-08-22 — a fix nobody has watched a model meet is not a fix yet.
 *
 *   npm run gate:run              Part 4's case — SPENDS 7 LIVE REQUESTS (more with retries)
 *   npm run gate:run -- invalid   a three-to-one split — spends none, expects a 400
 *   npm run gate:run -- raw       the same live run, printed as raw SSE frames
 *
 * Start the server first, in another terminal:  npm run dev -w server
 */

import "../src/env.js";
import { FALLBACK_ROUTER } from "../src/config.js";
import type { RunRecord } from "../src/aggregate.js";
import type { JudgeOutcome } from "../src/judging.js";
import type { StatementOutcome } from "../src/statements.js";

const RULE = "═".repeat(94);
const THIN = "─".repeat(94);

const BASE = process.env.TRIBUNAL_BASE_URL ?? "http://localhost:3001";
const args = new Set(process.argv.slice(2));
const invalid = args.has("invalid");
const raw = args.has("raw");
/**
 * One model for all seven roles. Part 1 offers this as a user-facing mode, and it is also
 * the most reliable thing this app can do: it spends its seven requests on the single
 * identifier with the best measured record rather than on seven, any of which may be
 * saturated. It answers a different question than per-role does — it cannot show that the
 * voices differ — but a demo that has to work is a legitimate reason to ask it.
 */
const solo = args.has("solo");

const CHARGE_SHEET =
  "Jon Snow is charged with regicide and treason for assassinating Queen Daenerys " +
  "Targaryen in the throne room after the sack of the city. He was sworn to her service " +
  "and came to her as her lover before he struck her down.";

/** Part 4's casting, and — with `invalid` — its second invalid case, a three-to-one split. */
const ADVOCATES = invalid
  ? [
      { id: "tyrion", side: "for" },
      { id: "cersei", side: "against" },
      { id: "daenerys", side: "against" },
      { id: "grey-worm", side: "against" },
    ]
  : [
      { id: "tyrion", side: "for" },
      { id: "cersei", side: "for" },
      { id: "daenerys", side: "against" },
      { id: "grey-worm", side: "against" },
    ];

interface Frame {
  readonly event: string;
  readonly id: number;
  readonly data: Record<string, unknown>;
  /** Milliseconds after the request went out. The whole diagnosis is in this number. */
  readonly atMs: number;
}

/**
 * Ends the script without `process.exit`. Calling that here trips an assertion inside
 * libuv on Windows when a keep-alive socket from `fetch` is still closing — the exit code
 * is set instead and the loop is left to drain on its own.
 */
function fail(): false {
  process.exitCode = 1;
  return false;
}

const clock = (): string => new Date().toTimeString().slice(0, 8);
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const pad = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);

/**
 * The server must be up before anything is spent. Without this the run fails as a bare
 * connection error — or, under `curl -s`, as no output at all, which is indistinguishable
 * from a stream that produced nothing.
 */
async function checkServer(): Promise<boolean> {
  let health: Response;
  try {
    health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(
      `\n  The server is not answering on ${BASE}.\n\n` +
        "  Start it in another terminal:  npm run dev -w server\n" +
        "  Then run this again. Nothing was spent.\n",
    );
    return fail();
  }

  const body = (await health.json()) as { apiKeyConfigured: boolean; runsHeld: number };
  console.log(`  server:   ${BASE} · up · ${body.apiKeyConfigured ? "API key configured" : "NO API KEY"}`);
  console.log(`  held:     ${body.runsHeld} run(s) in the reconnect buffer`);

  if (!invalid && !body.apiKeyConfigured) {
    console.error("\n  No OPENROUTER_API_KEY on the server, so a live run cannot be made.\n");
    return fail();
  }
  return true;
}

/** One readable line per event, in place of the JSON blob behind it. */
function describe(frame: Frame): string {
  switch (frame.event) {
    case "preflight": {
      const casting = frame.data.casting as { name: string; side: string }[];
      const say = (side: string): string =>
        casting.filter((c) => c.side === side).map((c) => c.name).join(" + ");
      const defendant = frame.data.defendant as { name: string };
      return `${defendant.name} on trial · ${say("for")} defending · ${say("against")} prosecuting`;
    }
    case "statement": {
      const s = frame.data as unknown as StatementOutcome;
      const state = s.ok
        ? `${String(s.words).padStart(3)}/${s.wordCap} words${s.overCap ? " OVER CAP" : ""}`
        : `FAILED ${s.problem ?? s.errorKind ?? ""}`;
      // On a failure, name the model that actually failed — the last one tried — rather
      // than the role's first choice. Showing the first choice beside the last attempt's
      // error reads as though that model produced the error, which it may not have.
      const model = s.ok ? s.model : (s.attempts.at(-1)?.requestedModel ?? s.requestedModel);
      return `${pad(s.name, 18)} ${pad(s.side === "for" ? "defending" : "prosecuting", 12)} ${pad(state, 22)} ${model}`;
    }
    case "judge": {
      const j = frame.data as unknown as JudgeOutcome;
      const verdict = j.verdict ? j.verdict.replace("_", " ").toUpperCase() : "NO VERDICT";
      const state = `${String(j.reasoningWords).padStart(3)}/${j.wordCap} words${j.overCap ? " OVER CAP" : ""}`;
      const model = j.model ?? j.attempts.at(-1)?.requestedModel ?? j.requestedModel;
      return `${pad(j.name, 18)} ${pad(verdict, 12)} ${pad(state, 22)} ${model}`;
    }
    case "done": {
      const record = frame.data as unknown as RunRecord;
      const outcome = record.outcome;
      if (outcome.kind === "verdict") {
        return `${outcome.verdict.replace("_", " ").toUpperCase()} — ${outcome.tally.guilty} guilty, ${outcome.tally.notGuilty} not guilty, ${outcome.tally.failed} failed`;
      }
      if (outcome.kind === "aborted") return `ABORTED (${outcome.reason})`;
      return outcome.kind.toUpperCase();
    }
    case "error":
      return String((frame.data as { message?: string }).message ?? "unknown error");
    default:
      return JSON.stringify(frame.data).slice(0, 80);
  }
}

/** Reads the SSE body, printing each frame as it lands rather than collecting first. */
async function readStream(body: ReadableStream<Uint8Array>, startedAt: number): Promise<Frame[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffered = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const atMs = Date.now() - startedAt;

    let split = buffered.indexOf("\n\n");
    while (split !== -1) {
      const block = buffered.slice(0, split);
      buffered = buffered.slice(split + 2);
      split = buffered.indexOf("\n\n");

      if (raw) {
        // Exactly the bytes on the wire, for anyone who wants to see them.
        console.log(`  ${clock()}  ${secs(atMs).padStart(7)}  ${block.replace(/\n/g, " | ").slice(0, 150)}`);
      }

      const lines = block.split("\n");
      const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const payload = lines.find((line) => line.startsWith("data: "))?.slice(6);
      if (!event || !payload || id === undefined) continue;

      const frame: Frame = {
        event,
        id: Number(id),
        data: JSON.parse(payload) as Record<string, unknown>,
        atMs,
      };
      frames.push(frame);
      if (!raw) {
        console.log(
          `  ${clock()}  ${secs(atMs).padStart(7)}  ${pad(frame.event, 10)} ${describe(frame)}`,
        );
      }
    }
  }
  return frames;
}

/** The things the gate actually asks, answered rather than left to the eye. */
function report(frames: Frame[]): void {
  const done = frames.find((frame) => frame.event === "done");
  const record = done?.data as unknown as RunRecord | undefined;
  const tick = (ok: boolean): string => (ok ? "✓" : "✗");
  const line = (ok: boolean, label: string, detail: string): void =>
    console.log(`  ${tick(ok)}  ${pad(label, 34)} ${detail}`);

  console.log(`\n${RULE}`);
  console.log("WHAT THE GATE ASKS");
  console.log(RULE);
  console.log();

  // The lump test: if every event landed at nearly the same moment, the stream was
  // buffered somewhere, however correct its contents.
  const gaps = frames.slice(1).map((frame, i) => frame.atMs - (frames[i]).atMs);
  const largest = gaps.length > 0 ? Math.max(...gaps) : 0;
  line(
    largest >= 1000,
    "events arrived one at a time",
    `largest gap between events ${secs(largest)} — one lump would be near 0s`,
  );

  if (!record) {
    console.log("\n  No `done` event arrived, so there is no record to check.\n");
    return;
  }

  const statements = frames.filter((frame) => frame.event === "statement").length;
  const judges = frames.filter((frame) => frame.event === "judge").length;
  const summed = record.attempts.reduce((sum, a) => sum + (a.usage.totalTokens ?? 0), 0);

  line(record.totals.calls >= 7, "seven calls or more with retries", `${record.totals.calls}`);
  line(summed === record.totals.totalTokens, "tokens sum to the total", `${summed} = ${record.totals.totalTokens}`);
  line(record.totals.costUsd === 0, "price is $0 on free models", `$${record.totals.costUsd.toFixed(4)}`);
  line(statements === 4 && judges === 3, "four statements, three verdicts", `${statements} / ${judges}`);

  // ── The two criteria carried from Stage 3, which failed live on 2026-08-22. ──
  // Both were fixed the same day and neither has been seen against a model since, so
  // the gate answers them here rather than leaving them to be spotted in the rows above.
  const statementRows = frames
    .filter((frame) => frame.event === "statement")
    .map((frame) => frame.data as unknown as StatementOutcome);
  const judgeRows = frames
    .filter((frame) => frame.event === "judge")
    .map((frame) => frame.data as unknown as JudgeOutcome);

  // Margin is signed: positive is words to spare, negative is the overrun. Reporting the
  // tightest margin rather than a yes/no keeps the trend visible — the overrun has been
  // falling (232 → 199 → 162) and a run that only just holds is worth knowing about.
  const margins = [
    ...statementRows.filter((s) => s.ok && s.words !== null).map((s) => s.wordCap - (s.words as number)),
    ...judgeRows.filter((j) => j.ok).map((j) => j.wordCap - j.reasoningWords),
  ];
  const over = [
    ...statementRows.filter((s) => s.ok && s.overCap).map((s) => `${s.name} ${s.words}/${s.wordCap}`),
    ...judgeRows.filter((j) => j.ok && j.overCap).map((j) => `${j.name} ${j.reasoningWords}/${j.wordCap}`),
  ];
  const tightest = margins.length > 0 ? Math.min(...margins) : 0;
  line(
    over.length === 0,
    "every reply inside its word cap",
    over.length === 0
      ? `tightest margin ${tightest} words to spare`
      : `over by up to ${-tightest}: ${over.join(", ")}`,
  );

  // A seat is served by whatever *answered*, not by what was asked for: the one way an
  // unvetted model reaches a seat is the router resolving one. So both are checked —
  // that no call fell through to the router at all, and that every seat names a model.
  const seats = [
    ...statementRows.map((s) => ({ name: s.name, model: s.ok ? s.model : null })),
    ...judgeRows.map((j) => ({ name: j.name, model: j.ok ? j.model : null })),
  ];
  const routed = record.attempts.filter((a) => a.requestedModel === FALLBACK_ROUTER);
  const unpinned = seats.filter((seat) => seat.model === FALLBACK_ROUTER || seat.model === null);
  const distinct = new Set(seats.map((seat) => seat.model).filter((model) => model !== null));
  line(
    routed.length === 0 && unpinned.length === 0,
    // "pinned" until 03: nothing is pinned now, the roster is discovered. The check is
    // unchanged and still the one that matters — the router resolves to whatever it likes,
    // so a seat it served is a seat no vetting stands behind.
    "every seat served by a vetted model",
    routed.length > 0
      ? `${routed.length} call${routed.length === 1 ? "" : "s"} fell through to ${FALLBACK_ROUTER}`
      : unpinned.length > 0
        ? `no model named for: ${unpinned.map((seat) => seat.name).join(", ")}`
        : `${distinct.size} distinct models across ${seats.length} seats, router never reached`,
  );

  console.log(`\n${THIN}`);
  console.log(
    `  ${record.totals.totalTokens} tokens (${record.totals.reasoningTokens} of them thinking) · ` +
      `${secs(frames.at(-1)?.atMs ?? 0)} wall clock · run id ${(frames[0]?.data as { runId?: string }).runId ?? "—"}`,
  );
  if (record.collisions.length > 0) {
    for (const collision of record.collisions) {
      console.log(`  shared: ${collision.model} served ${collision.roles.join(" and ")}`);
    }
  }
  console.log(
    "\n  The run is held for ten minutes. Rejoin it — and see the reconnect work — with:\n" +
      `    curl -sN ${BASE}/api/run/${(frames[0]?.data as { runId?: string }).runId ?? "<id>"}/stream\n`,
  );
}

async function main(): Promise<void> {
  console.log(`\n${RULE}`);
  console.log(
    invalid
      ? "LIVE RUN GATE — the invalid case. Expect a 400 and ZERO model calls."
      : `LIVE RUN GATE — POST /api/run, live${solo ? " (SOLO: one model, all seven seats)" : ""}. THIS MAKES 7 MODEL CALLS.`,
  );
  console.log(RULE);
  console.log();

  if (!(await checkServer())) return;

  const body = JSON.stringify({
    chargeSheet: CHARGE_SHEET,
    defendant: "jon-snow",
    advocates: ADVOCATES,
    mode: solo ? "solo" : "per-role",
    // Ignored by the server on purpose, and worth proving here: no request may name a
    // model. Watch the model column — every seat is served from the server's own roster.
    model: "anthropic/claude-opus-4",
  });

  console.log(`\n  POST ${BASE}/api/run\n`);
  console.log(`  ${pad("time", 8)}  ${"since".padStart(7)}  ${pad("event", 10)} what arrived`);
  console.log(`  ${"─".repeat(8)}  ${"─".repeat(7)}  ${"─".repeat(10)} ${"─".repeat(58)}`);

  const startedAt = Date.now();
  const response = await fetch(`${BASE}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body,
  });

  if (response.status !== 200) {
    const refusal = (await response.json()) as {
      failures?: { code: string; field: string; message: string }[];
      error?: string;
    };
    console.log(`  ${clock()}  ${"—".padStart(7)}  HTTP ${response.status} — the run was refused\n`);
    for (const failure of refusal.failures ?? []) {
      console.log(`    · ${failure.code}  (field: ${failure.field})`);
      console.log(`      ${failure.message}\n`);
    }
    if (refusal.error) console.log(`    ${refusal.error}\n`);
    console.log(
      `  Expected for the invalid case. Confirm the server's terminal shows no model\n` +
        `  activity, and that runs.jsonl was not written — the refusal cost nothing.\n`,
    );
    if (!(response.status === 400 && invalid)) fail();
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    console.error(`\n  Expected an event stream, got "${contentType}".\n`);
    fail();
    return;
  }

  const frames = await readStream(response.body as ReadableStream<Uint8Array>, startedAt);
  report(frames);
}

main().catch((error: unknown) => {
  console.error(`\n  The gate check failed: ${(error as Error).message}\n`);
  fail();
});

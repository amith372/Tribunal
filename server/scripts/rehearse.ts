/**
 * rehearse.ts — the whole server, streaming a whole run, without calling a model.
 *
 * **Why this exists.** One run is seven requests out of a free tier of roughly fifty a
 * day, and the run screen is the part of the app that most needs to be watched over and
 * over: four portraits changing at four different moments, three seats resolving one at a
 * time, a card going to its error state, a dropped connection picked back up. Building
 * that against live models would burn the day's allowance on the first afternoon and give
 * a different timing every run. So this process runs the *real* app — the real routing
 * layer, the real pipeline, the real SSE frames, the real run buffer and its reconnect —
 * with one seam replaced: the function that would call OpenRouter instead waits a while
 * and returns prepared text.
 *
 * Everything the browser sees is therefore genuine except the models' words. The event
 * order, the sequence numbers, the reconnect route, the record that closes the stream and
 * every field in it are produced by the same code a live run uses.
 *
 * **The prepared text obeys the brief the real advocates are given.** Three things were
 * learned by getting it wrong, and each showed up on screen looking like a fault in the app:
 *
 *   1. **It argues the side that seat was actually cast on.** Handing the texts out in
 *      arrival order put a defence in a prosecutor's card. The side is now read out of the
 *      prompt, exactly as a model reads it.
 *   2. **It argues about the accused, and never about the other advocates.** `prompts.ts`
 *      tells every advocate to "speak only for yourself … and do not address the other side
 *      as if they were present", and text that answered an argument nobody had made yet was
 *      breaking the app's own rule inside a fixture meant to demonstrate the app.
 *   3. **It names the accused**, pulled from the prompt, so the statement is about the
 *      person actually on trial rather than about a person in general.
 *
 * **What it cannot do is sound like anyone.** A character's voice comes from a model reading
 * that character's description and its standing with the defendant, and there is no model
 * here — so the four texts are deliberately plain, and the same four serve whoever is cast.
 * Voice is the one thing only a live run can show, and it is exactly what the live run is
 * for. Do not read these as a sample of what the app writes.
 *
 * **No key is read and none is needed.** The `.env` file is deliberately not loaded, and
 * the key is set here to a string that is never sent anywhere — `app.ts` refuses a run
 * outright when no key is configured, and this satisfies that check without introducing a
 * real credential into a process whose whole purpose is not to make requests.
 *
 *   npm run rehearse            a clean run: four statements, three verdicts
 *   npm run rehearse -- fail    one advocate never answers, and one seat rules against it
 *   npm run rehearse -- hung    one seat fails and the other two split — no verdict
 *   npm run rehearse -- fast    the same, at four times the speed
 *
 * Then point the web dev server at it as usual: `npm run dev -w web`.
 */

process.env.OPENROUTER_API_KEY = "rehearsal-no-request-is-made-with-this";

import { createApp } from "../src/app.js";
import { DataError, loadData, type TribunalData } from "../src/data.js";
import type { Attempt, CallOptions, CallResult, Usage } from "../src/openrouter.js";
import { OpenRouterError } from "../src/openrouter.js";

const args = new Set(process.argv.slice(2));
const failOneAdvocate = args.has("fail");
const hungBench = args.has("hung");
const speed = args.has("fast") ? 4 : 1;
const port = Number(process.env.PORT ?? 3001);

/**
 * Four different waits, on purpose.
 *
 * The whole gate question for this screen is whether the advocates arrive *separately* —
 * a screen that flips all four at the end is the failure it is checked against. Free
 * models really do come back seconds apart, so the rehearsal spreads them the same way
 * rather than making them uniform and flattering.
 */
const ADVOCATE_DELAYS_MS = [2600, 4700, 7400, 11200];
const JUDGE_DELAYS_MS = [3400, 6100, 9200];

/**
 * Two for each side. `{who}` is filled with the name of whoever is actually on trial.
 *
 * Each argues from the shape every charge sheet has — an act, a reason, and a question the
 * tribunal was handed — so it reads correctly whoever is accused and whoever is cast. None
 * of them mentions another advocate, because the real ones are forbidden to.
 */
const DEFENCE: readonly string[] = [
  "Look at what the sheet records about {who}, and then at what it does not. It describes " +
    "an act. It does not describe what {who} gained by it — no position, no property, no " +
    "safety, nothing a person schemes for. A charge needs a reason as much as it needs an " +
    "act, and the reason here has been left for this tribunal to supply out of its own " +
    "imagination. I will not supply it. Read the record as it stands and it does not reach " +
    "the charge it makes.",
  "The sheet puts a question to this tribunal, and a question is not put to a case that " +
    "answers itself. {who} is charged on a record that says what happened and stays silent " +
    "on why. Silence is not evidence. I am not asking anyone to invent a kinder story than " +
    "the one you were handed — I am asking you to notice how much of the unkind one you " +
    "would have to invent yourselves before it convicts. On what is written, {who} is not " +
    "guilty.",
];

const PROSECUTION: readonly string[] = [
  "The sheet states what {who} did and I will not decorate it. The act is not in dispute; " +
    "only the excuse for it is. {who} was trusted, and the charge describes precisely what " +
    "that trust made possible — a thing no stranger could have done. Everyone in this room " +
    "has held a place they did not enjoy holding, and everyone managed it without this. I " +
    "am not asking for a harsher standard than this tribunal would use on anyone else. I am " +
    "asking it to use the same one.",
  "Consider what the record says {who} did: decided alone, judged alone, acted alone, with " +
    "no warning given and no hearing held. This tribunal grants an accused all three, and " +
    "is granting them to {who} today. What is asked in return is that {who} be excused for " +
    "having granted them to nobody. Certainty is not a defence. Were it one, it would be a " +
    "defence for every person who is equally certain, and the sheet would be describing the " +
    "ordinary rather than the charged.",
];

/** JSON, so the parser's first rung reads them — the fake replies test nothing it owns. */
const VERDICTS: readonly string[] = [
  JSON.stringify({
    verdict: "not_guilty",
    reasoning:
      "Two things decide this for me. First, the charge sheet itself frames the act as " +
      "either murder or prevention, which means the tribunal has been handed a question " +
      "of justification rather than of fact. Second, nothing in the record shows the " +
      "accused gained by it — no throne, no title, no protection — and a killing that " +
      "profits no one is poorly explained by ambition.",
  }),
  JSON.stringify({
    verdict: "guilty",
    reasoning:
      "The oath is the whole of it. A sworn man who uses the access his oath bought him " +
      "has done something a stranger could not have done, and that difference is the " +
      "offence. I accept that he believed he was preventing something worse; belief is " +
      "not a defence available to everyone who acts alone, and a tribunal that allowed " +
      "it would be authorising every future man who is equally certain.",
  }),
  hungBench
    ? "I would rather not commit myself on this record."
    : JSON.stringify({
        verdict: "not_guilty",
        reasoning:
          "I am persuaded by the absence of any process at all — not by the killing, " +
          "which is admitted, but by the fact that no other course was open in the " +
          "moment described. Where the record shows no alternative and no gain, I do not " +
          "find the intent the charge requires.",
      }),
];

function usage(promptTokens: number, completionTokens: number): Usage {
  return {
    promptTokens,
    completionTokens,
    reasoningTokens: 0,
    totalTokens: promptTokens + completionTokens,
    // $0, as every real run reports while the roster stays free.
    costUsd: 0,
  };
}

function attemptRow(options: CallOptions, elapsedMs: number, ok: boolean): Attempt {
  const model = options.models[0] as string;
  return {
    label: options.label,
    attempt: (options.priorAttempts ?? 0) + 1,
    isRetry: (options.priorAttempts ?? 0) > 0,
    requestedModel: model,
    respondedModel: ok ? model : null,
    ok,
    httpStatus: ok ? 200 : 503,
    finishReason: ok ? "stop" : null,
    errorKind: ok ? null : "server_error",
    errorMessage: ok ? null : "rehearsal: this advocate was scripted to fail",
    usage: usage(620 + Math.round(Math.random() * 240), ok ? 150 : 0),
    elapsedMs,
    raw: null,
  };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms / speed));

/**
 * Where each wave has got to. Wrapped by the wave's size so a *second* run in the same
 * process is staggered exactly like the first — without the wrap, run two would fall off
 * the end of the delay table, land its four advocates in the same millisecond and hand the
 * judges an advocate's statement to rule on. Both were real, and both looked like bugs in
 * the screen rather than in the rehearsal.
 */
let advocatesAsked = 0;
let judgesAsked = 0;
let defenceAsked = 0;
let prosecutionAsked = 0;

/**
 * The side and the accused, read out of the prompt the way a model would read them.
 *
 * `prompts.ts` writes "You are defending X" or "You are prosecuting X" into every
 * advocate's system message, and heads a block with "THE DEFENDANT, X:". Both facts are
 * taken from there rather than kept as a second copy of the casting here — a copy is
 * exactly what drifted last time and put a defence in a prosecutor's card.
 */
function briefOf(options: CallOptions): { side: "for" | "against"; defendant: string } {
  const system = options.messages[0]?.content ?? "";
  return {
    side: system.includes("You are defending ") ? "for" : "against",
    defendant: /^THE DEFENDANT, (.+):$/m.exec(system)?.[1] ?? "the accused",
  };
}

/**
 * The seam. It takes the same options the real client takes and returns the same shape,
 * so nothing upstream of it can tell the difference — which is the point: the pipeline,
 * the wave logic, the record and the stream are all exercised for real.
 */
async function rehearsalCaller(options: CallOptions): Promise<CallResult> {
  const judging = options.label.startsWith("judge:");
  const index = judging
    ? judgesAsked++ % JUDGE_DELAYS_MS.length
    : advocatesAsked++ % ADVOCATE_DELAYS_MS.length;
  const delay = (judging ? JUDGE_DELAYS_MS[index] : ADVOCATE_DELAYS_MS[index]) ?? 3000;
  await wait(delay);

  const elapsed = Math.round(delay / speed);

  // The third advocate to be asked is the one that fails, so the failure lands in the
  // middle of the wave rather than at its end — an error state that only ever appears
  // last is an error state nobody has really looked at.
  if (!judging && failOneAdvocate && index === 2) {
    throw new OpenRouterError(
      `${options.label} failed after 3 attempt(s): rehearsal failure`,
      "server_error",
      [attemptRow(options, elapsed, false)],
    );
  }

  let text: string;
  if (judging) {
    text = VERDICTS[index] ?? VERDICTS[0] ?? "";
  } else {
    const brief = briefOf(options);
    const pool = brief.side === "for" ? DEFENCE : PROSECUTION;
    const cursor = brief.side === "for" ? defenceAsked++ : prosecutionAsked++;
    text = (pool[cursor % pool.length] ?? "").replaceAll("{who}", brief.defendant);
  }
  return {
    label: options.label,
    text,
    model: options.models[0] as string,
    finishReason: "stop",
    usage: usage(680, judging ? 190 : 130),
    attempts: [attemptRow(options, elapsed, true)],
  };
}

let data: TribunalData;
try {
  data = loadData();
} catch (error) {
  const message = error instanceof DataError ? error.message : String(error);
  console.error(`\nCould not load the data files.\n  ${message}\n`);
  process.exit(1);
}

// `logRuns: false` — a rehearsal is not a run, and the developer's run log is for
// diagnosing what real free models actually did.
const app = createApp({ data, call: rehearsalCaller, logRuns: false });

const server = app.listen(port, () => {
  const mode = failOneAdvocate ? "one advocate fails" : hungBench ? "a hung bench" : "a clean run";
  console.log(`\nThe Tribunal — REHEARSAL on http://localhost:${port}`);
  console.log("  No model is called. No request is made. No allowance is spent.");
  console.log(`  script: ${mode}${speed > 1 ? `, at ${speed}x` : ""}`);
  console.log(
    `  waves:  advocates at ${ADVOCATE_DELAYS_MS.map((ms) => `${Math.round(ms / speed / 100) / 10}s`).join(", ")}` +
      ` · judges at ${JUDGE_DELAYS_MS.map((ms) => `${Math.round(ms / speed / 100) / 10}s`).join(", ")}`,
  );
  console.log("\n  Now start the web dev server:  npm run dev -w web\n");
});

server.keepAliveTimeout = 600_000;
server.headersTimeout = 610_000;

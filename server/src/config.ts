/**
 * config.ts — model policy, and the server's own configuration. **The non-negotiable.**
 *
 * specs.md Part 1: the identifiers live server-side; they are never editable in the app,
 * the browser never sends one, and no request may introduce one. specs.md Part 5: a
 * user-editable model field is a cost hole.
 *
 * The free rule is enforced in two layers, neither of which can be loosened:
 *   1. Every identifier this module hands out — pinned default or env override — must
 *      pass `isFreeModelId`. An override naming a paid model is a startup failure, not
 *      a silent fallback, so a misconfigured host never reaches a paid call.
 *   2. The allowlist is *composed* from exactly those validated identifiers. Nothing
 *      else is ever in it. `assertAllowedModel` is what openrouter.ts calls before a
 *      request leaves the server.
 *
 * There is deliberately no env var, flag, or request field that widens either layer.
 *
 * **What is no longer here.** Which model sits in which seat, how the seats are shuffled,
 * how a spare is claimed and where a failing seat falls next all moved to `casting.ts`.
 * That was one file holding two jobs with nothing in common: this one is small, absolute
 * and must never change quietly; the other is intricate, heuristic, and is where every
 * bug in the old file actually was — both faults of 2026-08-22 were casting faults that
 * never touched the free rule, but they were edits to the file the free rule lives in.
 *
 * The dependency runs one way and must keep running one way: `casting.ts` imports this
 * module, and this module imports nothing from it. What that buys is that casting cannot
 * name a model policy never validated — it can only be handed pools this file composed.
 */



/**
 * OpenRouter's own free router, the last entry in every fallback chain (specs.md
 * Part 5), so a mid-run delisting degrades a run instead of killing it. It ends in
 * `/free`, not `:free`, so it gets this explicit exception rather than a widened
 * suffix rule — matching `free$` would also admit whatever a future roster happens
 * to name that way.
 */
export const FALLBACK_ROUTER = "openrouter/free";

/**
 * Roster verified live and $0 on OpenRouter on 2026-08-22 (`npm run models:check`).
 *
 * **Fifteen models for seven seats: every usable free identifier the roster offers.**
 * The pools are as deep as they can be made, because depth is what a second attempt
 * spends. A run reaches for a spare whenever a pinned model is rate-limited or delisted,
 * and on 2026-08-22 that was four of the seven seats in a single run — so the question is
 * not whether the spares get used but whether there are enough of them that each failing
 * role gets its own, rather than several roles colliding on the same one or dropping
 * through to the router.
 *
 * The history is worth keeping, because two separate bugs hid this for a day. The pools
 * were widened on 2026-08-21 after five trials in which every failure went straight to
 * `openrouter/free`, and the router resolved a vision model and a code model into seats
 * writing courtroom statements. That widening then did nothing at all: `buildRegistry`
 * iterated `ENV_KEYS` rather than these lists and truncated both pools back to exactly the
 * seat count, and `resolveRunModels` handed `fallbackChainFor` the whole pool as
 * "already in use", which emptied every chain of spares. The live run of 2026-08-22 —
 * a content-safety classifier on the bench, two pairs of roles sharing a model — is what
 * finally surfaced both.
 *
 * Deliberately excluded although free and live, because a model being free is not a
 * reason to hand it a role: `cohere/north-mini-code` (a code model — 46s, then
 * `bad_response`), `nvidia/nemotron-nano-12b-v2-vl` (vision — poor prose, and a grounding
 * leak), `nvidia/nemotron-3.5-content-safety` (a classifier — it took a judge's seat off
 * the router on 2026-08-22 and returned no readable verdict at all).
 *
 * **Excluded although the roster lists them as free, because they cannot be called at all:**
 * `thinkingmachines/inkling` and `thinkingmachines/inkling-small`. Both answer every request
 * with HTTP 403, "only available on agentic harnesses", and they cost a judge and an
 * advocate their seats on 2026-08-22 before that was known. `models:check` reads the public
 * model list and cannot see this — being listed and being callable are different things, and
 * only a real request tells them apart. That is what a vetting run is for.
 *
 * The two pools are disjoint by model, which is what keeps "no two roles share a model"
 * true before `fallbackChainFor` is even consulted.
 */
const DEFAULTS = {
  solo: "nvidia/nemotron-3-ultra-550b-a55b:free",
  /**
   * Six models for three seats, across five makers — **and the bench gets the depth,
   * because writing a statement and returning a verdict are not the same job.**
   *
   * `dots-3-note-preview` was moved here on 2026-08-22 to give the judges a spare, and moved
   * straight back out the same day: it had written two good statements as an advocate and
   * then returned empty content on both of its attempts at a verdict. A model that can write
   * cannot be assumed to rule. `nemotron-3-nano-omni-30b-a3b-reasoning` replaces it — a
   * reasoning model, which is what a judge's work actually is, and one that had already
   * written a clean 89-word statement, so it is depth rather than a guess.
   *
   * The bench is the side that gets the benefit of any doubt about depth. A judge with no
   * vetted spare falls to the router, which on 2026-08-22 resolved a content-safety
   * classifier into a seat that returned no verdict at all — and a lost judge can turn a
   * decided case into a hung one. An advocate in the same position is far better defended:
   * `statement-check.ts` reads whatever comes back and refuses it if it is not a statement,
   * buying another call on a different model. The bench has no equivalent.
   *
   * The bench is where Part 1's lineage rule is a non-negotiable — two judges built from
   * shared weights can agree for reasons that are not judicial, and a majority of three
   * lets such a pair decide the verdict. So the makers here are what is capped, not the
   * models: five is every distinct maker the free roster offers that is not already
   * spending its one usable model on the advocates. `fallbackChainFor` enforces the rule
   * at failover too, refusing a spare whose maker is already seated, which is what makes
   * the sixth entry safe to add rather than a way around the rule.
   *
   * Three spares for three judges, handed out rotated, so a simultaneous failure gives
   * each judge a different one instead of all three reaching for the same model.
   */
  judges: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "google/gemma-4-31b-it:free",
    "z-ai/glm-5.2:free",
    "poolside/laguna-xs-2.1:free",
    // A second NVIDIA, which `fallbackChainFor` will only ever offer to a bench that has
    // no NVIDIA model seated — depth that cannot cost the lineage rule anything.
    "nvidia/nemotron-3-super-120b-a12b:free",
    // A reasoning model, which is what a judge's work actually is. It took an advocate
    // seat on 2026-08-22 and wrote a clean 89-word statement, so it is not a guess.
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  ],
  /**
   * Seven models for four seats, across six makers. Advocates do not vote, so several
   * models from one maker in the *pool* costs nothing — `pickSeats` fills the four seats
   * maker-first, so the four voices are always drawn from four makers however the shuffle
   * falls, and the rest sit as spares.
   *
   * Six makers for four seats also restores real run-to-run variety in *which* makers are
   * heard, not merely which model each maker sends.
   *
   * `openai/gpt-oss-20b` was here until 2026-08-22, when `models:check` reported it
   * delisted — it had been spending one guaranteed 404 per run and dropping whichever
   * advocate drew it onto the router. `poolside/laguna-s-2.1` replaces it.
   */
  advocates: [
    "poolside/laguna-s-2.1:free",
    "google/gemma-4-26b-a4b-it:free",
    // Back from the bench, where it returned empty content twice. It writes statements
    // well and cannot produce a verdict; those are different jobs.
    "dots-studio/dots-3-note-preview:free",
    // Replaces `nvidia/nemotron-3-nano-30b-a3b`, delisted by 2026-08-26. Vetted with a
    // single request the same day before being seated: 5.0s, `stop`, 64 words of usable
    // advocate prose, usage returned, $0. It holds a seat rather than a spare because it
    // is the one of the two replacements that has actually been heard from.
    "minimax/minimax-m3:free",
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-lightning:free",
    // Replaces `nvidia/nemotron-nano-9b-v2`, delisted by 2026-08-26. **The one entry here
    // that has not been watched writing anything**: its vetting request on 2026-08-26 came
    // back rate-limited upstream (GMICloud shared pool), which is a transient refusal and
    // not inkling's flat 403 — so it is unproven rather than known bad, and there was no
    // third candidate to prefer over it. The free roster offered exactly two unused
    // identifiers that day and `EXCLUDED_MODELS` already names every other one. It sits in
    // the last spare slot deliberately: nothing reaches it until a seat has already failed
    // over, and if it fails too the chain falls through to the router as it would anyway.
    // Promote it once a real run has been seen to use it.
    "minimax/minimax-m2.7:free",
  ],
};

/**
 * Models this app has measured and will not seat, **as data rather than as a comment.**
 *
 * The standing rule for the pools above is that a spare is never a guess — every entry in
 * `DEFAULTS` has been watched writing usable output in a real trial before being seated,
 * not picked off the roster listing alone. This list was written down and then quietly
 * unenforceable, because the one
 * route into a seat that no allowlist can guard is `openrouter/free`: the request names the
 * router, which is permitted, and the *response* names whatever the router chose. Twice on
 * 2026-08-22 that was a model on this list. Once it was the content-safety classifier, which
 * returned no verdict and cost the bench a seat. Once it was the code model, which wrote a
 * perfectly competent statement containing no trace of the character it was speaking as —
 * the more instructive failure of the two, because nothing in the pipeline would have caught
 * it and the run record would have carried it as Cersei's own words.
 *
 * So the list is checked against the model that *answered*, not the one that was asked for.
 * A refused resolution costs the request that was already spent and moves the role on, which
 * is the price of the guarantee being real instead of aspirational.
 */
export const EXCLUDED_MODELS: ReadonlyMap<string, string> = new Map([
  ["cohere/north-mini-code:free", "a code model — competent prose, but none of the persona in it"],
  ["nvidia/nemotron-3.5-content-safety:free", "a classifier — returned no readable verdict"],
  ["nvidia/nemotron-nano-12b-v2-vl:free", "a vision model — poor prose, and a grounding leak"],
  ["thinkingmachines/inkling:free", "gated to agentic harnesses — answers every request with 403"],
  ["thinkingmachines/inkling-small:free", "gated to agentic harnesses — answers every request with 403"],
]);

/**
 * Env vars that may swap a delisted identifier without a code change (specs.md Part 5).
 *
 * **There is one key per pool slot, spares included, and `DEFAULTS` is what decides how
 * many slots there are.** This list used to be the shorter of the two and `buildRegistry`
 * iterated *it*, which silently truncated both pools back to the number of seats: the
 * vetted spares added to `DEFAULTS` were never read, so the pools were never actually
 * widened and every chain stayed one model deep. Part 5 asks that a delisted identifier
 * be replaceable through configuration, and a spare is exactly as likely to be delisted
 * as a first choice, so each gets its own key.
 */
const ENV_KEYS = {
  solo: "TRIBUNAL_MODEL_SOLO",
  judges: [
    "TRIBUNAL_MODEL_JUDGE_1",
    "TRIBUNAL_MODEL_JUDGE_2",
    "TRIBUNAL_MODEL_JUDGE_3",
    "TRIBUNAL_MODEL_JUDGE_4",
    "TRIBUNAL_MODEL_JUDGE_5",
    "TRIBUNAL_MODEL_JUDGE_6",
  ],
  advocates: [
    "TRIBUNAL_MODEL_ADVOCATE_1",
    "TRIBUNAL_MODEL_ADVOCATE_2",
    "TRIBUNAL_MODEL_ADVOCATE_3",
    "TRIBUNAL_MODEL_ADVOCATE_4",
    "TRIBUNAL_MODEL_ADVOCATE_5",
    "TRIBUNAL_MODEL_ADVOCATE_6",
    "TRIBUNAL_MODEL_ADVOCATE_7",
    "TRIBUNAL_MODEL_ADVOCATE_8",
    "TRIBUNAL_MODEL_ADVOCATE_9",
  ],
};

export class ModelPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelPolicyError";
  }
}

/**
 * The free rule, hardcoded. A model is free if its identifier ends in `:free`, or if
 * it is the fallback router. Nothing else, under any configuration.
 */
export function isFreeModelId(id: string): boolean {
  return id === FALLBACK_ROUTER || id.endsWith(":free");
}

/** Reads one slot from env, falling back to the pinned default. A paid override throws. */
function resolveSlot(envKey: string | undefined, fallback: string): string {
  const raw = envKey ? process.env[envKey]?.trim() : undefined;
  if (!raw) return fallback;
  if (!isFreeModelId(raw)) {
    throw new ModelPolicyError(
      `${envKey} is set to "${raw}", which is not a free model. Only identifiers ` +
        `ending in ":free" (or "${FALLBACK_ROUTER}") are permitted. There is no ` +
        `setting that allows a paid model.`,
    );
  }
  return raw;
}

export interface ModelRegistry {
  /** One model for all seven roles, in solo mode. */
  readonly solo: string;
  /** The models judges draw from, in per-role mode. Larger than the bench, so spares exist. */
  readonly judgePool: readonly string[];
  /** The models advocates draw from, in per-role mode. Larger than the cast, likewise. */
  readonly advocatePool: readonly string[];
  /** Every identifier this app may ever send, and nothing else. */
  readonly allowlist: ReadonlySet<string>;
}

function buildRegistry(): ModelRegistry {
  // Driven by DEFAULTS, which is the authority on how many models each pool holds.
  // Iterating ENV_KEYS instead is what silently discarded the spares.
  const solo = resolveSlot(ENV_KEYS.solo, DEFAULTS.solo);
  const judgePool = DEFAULTS.judges.map((id, i) => resolveSlot(ENV_KEYS.judges[i], id));
  const advocatePool = DEFAULTS.advocates.map((id, i) => resolveSlot(ENV_KEYS.advocates[i], id));

  // Composed from the validated identifiers above — never widened, and never read
  // from the environment as a list of its own.
  const allowlist = new Set<string>([solo, ...judgePool, ...advocatePool, FALLBACK_ROUTER]);

  return { solo, judgePool, advocatePool, allowlist };
}

let registry: ModelRegistry | null = null;

/** The model registry, built once from code defaults plus validated env overrides. */
export function getModelRegistry(): ModelRegistry {
  registry ??= buildRegistry();
  return registry;
}

/** Test seam: forget the cached registry so a test can vary the environment. */
export function resetModelRegistry(): void {
  registry = null;
}

/**
 * The guard openrouter.ts calls before every request. Both conditions hold, always:
 * free by the hardcoded rule, and on the composed allowlist.
 */
export function assertAllowedModel(id: string): void {
  const { allowlist } = getModelRegistry();
  if (!isFreeModelId(id)) {
    throw new ModelPolicyError(`Refused to call "${id}": not a free model.`);
  }
  if (!allowlist.has(id)) {
    throw new ModelPolicyError(
      `Refused to call "${id}": not on the app's free allowlist. ` +
        `Permitted: ${[...allowlist].sort().join(", ")}.`,
    );
  }
}



export interface ServerConfig {
  readonly port: number;
  readonly apiKey: string | null;
  readonly appUrl: string;
  readonly isProduction: boolean;
}

export function getServerConfig(): ServerConfig {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return {
    port: Number(process.env.PORT ?? 3001),
    apiKey: key && key.length > 0 ? key : null,
    appUrl: process.env.APP_URL?.trim() || "http://localhost:3001",
    isProduction: process.env.NODE_ENV === "production",
  };
}

/**
 * Model calls need the key; `/api/health` and the pre-flight deliberately do not, so
 * the app is runnable and checkable without one. The message is readable on purpose —
 * a missing key should not surface as a stack trace.
 */
export function requireApiKey(): string {
  const { apiKey } = getServerConfig();
  if (!apiKey) {
    throw new ModelPolicyError(
      "OPENROUTER_API_KEY is not set. Model calls cannot run without it. Set it in a " +
        ".env file at the repo root for local development, or as an environment " +
        "variable on the host.",
    );
  }
  return apiKey;
}

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

/**
 * Models that may argue but must not judge. **Per-role eligibility, and it is not a
 * hypothesis.**
 *
 * `dots-3-note-preview` wrote two clean statements as an advocate on 2026-08-22 and then
 * returned empty content on both of its attempts at a verdict. It was moved off the bench
 * by hand, with the conclusion written beside it: a model that can write cannot be assumed
 * to rule. specs.md Part 1 now states that as a rule rather than a note — eligibility is
 * per role — and this is where the evidence for it lives.
 *
 * The bench is the side that gets the benefit of any doubt, because a lost judge can turn a
 * decided case into a hung one, while a refused statement is caught by
 * `statement-check.ts` and buys another call.
 */
export const JUDGE_INELIGIBLE: ReadonlyMap<string, string> = new Map([
  ["dots-studio/dots-3-note-preview:free", "writes well and returned empty content on both attempts at a verdict"],
]);

/** How many models each pool needs before a run can be cast at all. */
const MIN_JUDGE_POOL = 3;
const MIN_ADVOCATE_POOL = 4;

/**
 * The discovered roster, set once at startup by `index.ts`.
 *
 * **Held rather than fetched here on purpose.** Discovery is asynchronous and everything
 * downstream of the registry is not: `assertAllowedModel` is called on the hot path of
 * every request. Making the registry async would push a promise through the whole pipeline
 * to answer a question that has one answer for the life of the process.
 */
let roster: readonly string[] | null = null;

/**
 * Hands the process its roster. Every identifier is checked again on the way in — the
 * source has already filtered, and this file does not take that on trust, because it is the
 * one place the free rule is allowed to be believed.
 */
export function setRoster(models: readonly string[]): void {
  const bad = models.find((id) => !isFreeModelId(id));
  if (bad !== undefined) {
    throw new ModelPolicyError(
      `The roster carried "${bad}", which is not a free model. Only identifiers ending ` +
        `in ":free" (or "${FALLBACK_ROUTER}") may enter the pool.`,
    );
  }
  roster = [...models];
  registry = null;
}

/** Test seam, and what `index.ts` reports when discovery has not happened. */
export function hasRoster(): boolean {
  return roster !== null;
}

/**
 * Splits the eligible models into two disjoint pools, maker by maker.
 *
 * specs.md Part 1: the pools share no model, which is what keeps "no two roles share one"
 * true before `fallbackChainFor` is consulted at all. Walking makers in turn and dealing
 * alternately gives both pools makers rather than giving one pool all of a maker — the
 * bench's lineage rule needs distinct makers available to it, and a split that handed every
 * NVIDIA model to the advocates would starve it.
 *
 * The bench deals first because it is the side that cannot recover from a thin pool.
 */
function splitPools(eligible: readonly string[]): { judges: string[]; advocates: string[] } {
  const byMaker = new Map<string, string[]>();
  for (const id of eligible) {
    const maker = id.split("/")[0] ?? id;
    const models = byMaker.get(maker) ?? [];
    models.push(id);
    byMaker.set(maker, models);
  }

  const judges: string[] = [];
  const advocates: string[] = [];

  /**
   * **Each maker's models are dealt between the pools, rather than each maker being dealt
   * to a pool.** Dealing whole makers was tried first and is quietly wrong: with six makers
   * it gave each pool three, so the bench had exactly three lineages for three seats and no
   * distinct-maker spare to fall to — which is the position `fallbackChainFor` exists to
   * avoid, and the one that put a classifier in a judge's seat.
   *
   * Splitting within a maker gives both pools the full spread of makers while keeping them
   * disjoint by model, which is what specs.md Part 1 asks of them.
   */
  [...byMaker.values()].forEach((models, index) => {
    // The starting side alternates by maker, so a roster of single-model makers does not
    // hand every one of them to the bench.
    let toBench = index % 2 === 0;
    for (const id of models) {
      (toBench ? judges : advocates).push(id);
      toBench = !toBench;
    }
  });

  return { judges, advocates };
}

function buildRegistry(): ModelRegistry {
  if (roster === null) {
    throw new ModelPolicyError(
      "No model roster has been discovered, so no model may be seated. " +
        "The app asks OpenRouter which models are currently free at startup.",
    );
  }

  // Eligibility, applied after membership: the free rule again, then what this app has
  // measured and will not seat. Presence on the roster is necessary and never sufficient.
  /**
   * **The router is never a seat.** `openrouter/free` passes the free rule and appears on
   * the roster like anything else, but it resolves to whatever OpenRouter picks — which is
   * why `fallbackChainFor` puts it *last* in every chain and `openrouter.ts` checks the
   * model that answered against the exclusions. Letting it into a pool would let a judge be
   * cast straight onto a lottery, before any failure had happened at all, which is the
   * position all of that machinery exists to avoid. It stays on the allowlist, because a
   * chain still has to be allowed to reach it.
   */
  const eligible = roster.filter(
    (id) => isFreeModelId(id) && id !== FALLBACK_ROUTER && !EXCLUDED_MODELS.has(id),
  );
  const { judges, advocates } = splitPools(eligible);

  // The bench keeps only models eligible to judge; anything moved off it is still a
  // perfectly good advocate, so it is handed over rather than discarded.
  const judgePool = judges.filter((id) => !JUDGE_INELIGIBLE.has(id));
  const advocatePool = [...advocates, ...judges.filter((id) => JUDGE_INELIGIBLE.has(id))];

  if (judgePool.length < MIN_JUDGE_POOL || advocatePool.length < MIN_ADVOCATE_POOL) {
    throw new ModelPolicyError(
      `The roster yielded ${judgePool.length} models able to judge and ${advocatePool.length} ` +
        `able to argue; a run needs at least ${MIN_JUDGE_POOL} and ${MIN_ADVOCATE_POOL}. ` +
        "No run can be cast. Nothing was spent.",
    );
  }

  const solo = judgePool[0];

  // Composed from exactly the identifiers validated above — never widened, and never read
  // from the environment as a list of its own. The router is the one addition, and it is
  // guarded separately: `openrouter.ts` checks the model that *answered* against
  // `EXCLUDED_MODELS`, because only the reply names what the router resolved.
  const allowlist = new Set<string>([solo, ...judgePool, ...advocatePool, FALLBACK_ROUTER]);

  return { solo, judgePool, advocatePool, allowlist };
}

let registry: ModelRegistry | null = null;

/** The registry, composed once from the discovered roster and this app's own rules. */
export function getModelRegistry(): ModelRegistry {
  registry ??= buildRegistry();
  return registry;
}

/** Test seam: forget the composed registry so a test can vary the roster. */
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

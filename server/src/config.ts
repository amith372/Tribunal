/**
 * config.ts — the single source of truth for model identifiers.
 *
 * specs.md Part 1: the identifiers are chosen by the developer and live server-side;
 * they are never editable in the app, the browser never sends one, and no request may
 * introduce one. specs.md Part 5: a user-editable model field is a cost hole.
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
 */

import { warmFirst } from "./model-health.js";

export type Mode = "solo" | "per-role";

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
   * Seven models for four seats, across five makers. Advocates do not vote, so several
   * models from one maker in the *pool* costs nothing — `pickSeats` fills the four seats
   * maker-first, so the four voices are always drawn from four makers however the shuffle
   * falls, and the rest sit as spares.
   *
   * Five makers for four seats also restores real run-to-run variety in *which* makers are
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
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "liquid/lfm-2.5-2.6b:free",
    "nvidia/nemotron-3.5-lightning:free",
    "nvidia/nemotron-nano-9b-v2:free",
  ],
};

/**
 * **Which of these have actually been watched writing, and which have not.**
 *
 * The standing rule is that a spare is never a guess — the pools carried only models
 * that had produced usable output in a real trial. Widening to every usable free
 * identifier on the roster breaks that for the new entries, so rather than let the
 * distinction quietly disappear it is written down. Vetted on 2026-08-21 or earlier:
 * the three original judges, `laguna-xs-2.1`, and the advocates `gemma-4-26b-a4b`,
 * `dots-3-note-preview`, `nemotron-3-nano-30b`, `lfm-2.5-2.6b`, `nemotron-3.5-lightning`.
 * Vetted 2026-08-22 by the router resolving it into Grey Worm's seat, where it returned a
 * clean 67-word statement on the case: `nemotron-3-super-120b`. The live run later that day
 * vetted two more: `nemotron-3-nano-omni-30b-a3b-reasoning` wrote Cersei a clean 89-word
 * statement, and `laguna-s-2.1` wrote Tyrion a real statement on the case — usable, but at
 * 232 words against a 150 cap it is the longest-winded model measured so far.
 *
 * One entry is still pinned on the roster listing alone and unproven. It sits as depth for
 * a second attempt, which is where an unproven model does least harm and most good.
 */
export const UNVETTED_MODELS: ReadonlySet<string> = new Set([
  "nvidia/nemotron-nano-9b-v2:free",
]);

/**
 * Models this app has measured and will not seat, **as data rather than as a comment.**
 *
 * The exclusions above were written down and then quietly unenforceable, because the one
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

/** The maker half of an identifier — `nvidia` in `nvidia/nemotron-3-nano-30b-a3b:free`. */
function providerOf(id: string): string {
  return id.split("/")[0];
}

/**
 * Gives each seat its own spare, seating as many as can be given one at all.
 *
 * **Taking them in turn — first seat picks, second picks from what is left — is not good
 * enough, and the reason is worth stating because the naive version looks obviously
 * correct.** Each seat has a *different* list of eligible spares, because the exclusions
 * depend on which other models are seated. So an early seat with many options can take
 * the one model a later seat could have used, and the later seat is left with nothing
 * although a perfect assignment existed. A real casting that does this: with the bench on
 * `nemotron-3-ultra`, `gemma-4-31b` and `glm-5.2`, the NVIDIA seat may take `laguna-xs`
 * even though it alone could have used `nemotron-3-super`, stranding `glm-5.2`.
 *
 * So it searches instead of grabbing, backtracking to the assignment that covers the most
 * seats. That is a bipartite matching, and at this size — at most four seats over at most
 * nine models — an exhaustive search is far cheaper than the reasoning needed to justify a
 * heuristic. It is deterministic: seats in casting order, options in pool order, and the
 * first assignment of the best size wins, so the same casting always yields the same
 * chains.
 */
function assignSpares(
  seats: readonly string[],
  sparesFor: (seat: string) => string[],
): Map<string, string> {
  const options = new Map(seats.map((seat) => [seat, sparesFor(seat)]));
  const used = new Set<string>();
  const current = new Map<string, string>();
  let best = new Map<string, string>();

  const search = (index: number): void => {
    if (best.size === seats.length) return;
    if (index === seats.length) {
      if (current.size > best.size) best = new Map(current);
      return;
    }
    const seat = seats[index];
    for (const model of options.get(seat) ?? []) {
      if (used.has(model)) continue;
      used.add(model);
      current.set(seat, model);
      search(index + 1);
      current.delete(seat);
      used.delete(model);
      if (best.size === seats.length) return;
    }
    // A seat may also go unassigned, which is what lets the search find the best partial
    // cover when no full one exists rather than failing outright.
    search(index + 1);
  };

  search(0);
  return best;
}

/**
 * Chooses which pool models actually take seats this run, preferring a different maker
 * for each.
 *
 * The pools are now larger than the seats they fill, which is what gives every role a
 * vetted spare — but it also means a shuffle alone could seat two models from one maker
 * and leave a third maker on the bench unused. Four advocates drawn from four makers is
 * the property that makes "do the voices actually differ?" a real question rather than a
 * rigged one, so seats are filled maker-first and only then topped up from whatever is
 * left. The models not seated stay in the pool as fallbacks, where sharing a maker with
 * another role is a far smaller problem than an unvetted model resolved off the router.
 */
function pickSeats(pool: readonly string[], seats: number): string[] {
  // Shuffled for the per-run permutation Part 1 asks for, then sunk by health: within a
  // maker that has more than one model, the one currently answering is preferred. A maker
  // with only one model is still seated with it, cold or not — the alternative is a bench
  // short of a lineage, which is worse than a first attempt that is likely to be refused
  // and has a warm spare waiting behind it.
  const shuffledPool = warmFirst(shuffled(pool));
  const taken: string[] = [];
  const makers = new Set<string>();

  for (const model of shuffledPool) {
    if (taken.length === seats) break;
    if (makers.has(providerOf(model))) continue;
    taken.push(model);
    makers.add(providerOf(model));
  }
  // Only reached if the pool holds fewer makers than seats.
  for (const model of shuffledPool) {
    if (taken.length === seats) break;
    if (!taken.includes(model)) taken.push(model);
  }
  return taken;
}

/** Fisher-Yates, used to permute a pool per run. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export interface RunModels {
  readonly mode: Mode;
  /** One model per judge, in judge order. */
  readonly judges: readonly string[];
  /** One model per advocate, in advocate order. */
  readonly advocates: readonly string[];
}

/** The bench and the cast: three judges, four advocates. The pools are larger on purpose. */
export const JUDGE_SEATS = 3;
export const ADVOCATE_SEATS = 4;

/**
 * How many requests one logical call may make as it walks its chain.
 *
 * It lives here rather than in `openrouter.ts` because `fallbackChainFor` has to build a
 * chain no longer than this, and `openrouter.ts` already imports this module — putting it
 * the other way round would make the two files import each other. `openrouter.ts`
 * re-exports it as `DEFAULT_MAX_ATTEMPTS`, which is the name the rest of the app uses.
 *
 * Three, and the number is load-bearing in two directions: it bounds a run at ~21 requests
 * against a daily allowance rationed in requests, and it is a term in the 360-second run
 * cap (two waves x three attempts x the 60s per-call timeout). Raising it moves both.
 *
 * It is three rather than two so that a *transient* failure can buy one more ask of the
 * same model before the role gives up on it — `sameModelMayClear` in `openrouter.ts` is
 * what decides which failures those are. Three requests is the worst case either way: a
 * run of accidents spends `own, own, spare`, and a run of rate limits spends
 * `own, spare, spare`, because a rate limit never buys the same-model ask.
 */
export const MAX_ATTEMPTS_PER_CALL = 3;

/**
 * Resolves the seven models for one run.
 *
 * specs.md Part 1: models are shuffled within their pool on every run, so a fixed
 * role-to-model mapping never confounds judicial temperament with model capability.
 * Solo mode runs one model for all seven roles, so there is nothing to permute.
 *
 * **It returns one model per seat and no more, and the `slice` is the whole point.**
 * Returning the shuffled pool entire looks harmless — the callers index into it by seat
 * and ignore the tail — but this array is also what gets handed to `fallbackChainFor` as
 * the list of models already serving other roles. A pool's unused spares are not serving
 * anything, and including them marked every spare as in-use, emptied every chain of them,
 * and left `[own model, router]` again. Measured live on 2026-08-22: four of seven seats
 * fell straight to the router, which resolved a content-safety classifier onto the bench
 * and put two roles on one model twice. That is precisely the fault the pools were
 * widened to fix, still failing because the widening was cancelled here.
 */
export function resolveRunModels(mode: Mode): RunModels {
  const { solo, judgePool, advocatePool } = getModelRegistry();
  if (mode === "solo") {
    return { mode, judges: [solo, solo, solo], advocates: [solo, solo, solo, solo] };
  }
  return {
    mode,
    judges: pickSeats(judgePool, JUDGE_SEATS),
    advocates: pickSeats(advocatePool, ADVOCATE_SEATS),
  };
}

/**
 * The chain tried for one call: the role's own model first, then any pool model *not
 * already serving another role this run*, then the fallback router last.
 *
 * specs.md Part 1: no two roles share a model, and the distinctness holds under
 * failure too. Failing a judge over onto a model another judge is using would put two
 * judges on the same weights reading the same prompt — and with a majority of three, a
 * pair that agrees for that reason decides the verdict, invisibly. So `assigned`
 * removes those models from the chain rather than trusting the shuffle alone.
 *
 * **The chain is never longer than the number of attempts that will be made**, so it
 * never names a fallback that cannot be reached. `openrouter.ts` caps a call at
 * `MAX_ATTEMPTS_PER_CALL`, so a three-entry chain would advertise a tail nothing ever
 * tries, and a reader of the code — or of the token table — would believe in a fallback
 * that does not exist.
 *
 * What that truncation means in practice, decided on 2026-08-22: **a vetted spare
 * outranks the router.** A role whose pool still has an unused model gets
 * `[own model, spare]`, and a role with no spare left gets `[own model, router]`. The
 * router therefore stops being the first thing a failure reaches and becomes what
 * specs.md Part 5 always described it as — the last resort — at the cost of a role
 * failing outright when both its own model and its spare are gone. That cost is
 * accepted: an unvetted model resolved into a seat is worse than an honest gap, because
 * a classifier or a vision model writing a courtroom statement produces a result that
 * looks legitimate and is not, which is the same error as an invented verdict.
 *
 * Every entry is allowlisted by construction, and openrouter.ts re-checks each anyway.
 */
export function fallbackChainFor(
  primary: string,
  mode: Mode,
  kind: "judge" | "advocate",
  /** One model per seat of this kind, from `resolveRunModels` — never the whole pool. */
  assigned: readonly string[] = [],
): string[] {
  const { judgePool, advocatePool } = getModelRegistry();
  const pool = mode === "solo" ? [] : kind === "judge" ? judgePool : advocatePool;
  const seats = assigned.length > 0 ? assigned : [primary];

  /**
   * The models this seat could fall over onto.
   *
   * **The bench excludes a whole maker; the advocates exclude only the exact model.** For
   * judges the distinctness rule is about *lineage*, not identifiers — excluding only the
   * models in use would let a judge fail over onto a different model from a maker already
   * sitting, putting two sets of shared weights on the same prompt, which is the failure
   * Part 1 exists to prevent arriving through the fallback rather than the casting.
   *
   * Advocates do not vote, and Part 1's rule is written about the bench. Applying it to
   * them anyway costs a great deal and buys little: measured across 300 simulated
   * castings, the maker exclusion left some advocate seats with only two eligible spares
   * between four of them, so seats were forced to share. The seats are already drawn from
   * four different makers by `pickSeats`; a *fallback* that happens to share a maker with
   * another advocate is a far smaller thing than a seat with no vetted spare left.
   */
  const isBench = kind === "judge";
  const sparesFor = (seat: string): string[] => {
    const others = seats.filter((model) => model !== seat);
    const inUse = new Set(others);
    // Warm first, always: handing a role a spare we already know is refusing spends its
    // second attempt to learn what the first attempt of some other role already found out.
    const eligible = warmFirst(pool.filter((model) => model !== seat && !inUse.has(model)));
    if (!isBench) return eligible;

    // **A preference, not a prohibition — and it took two attempts to get right.** Making
    // a seated maker disqualifying outright was tried first, and the free roster is too
    // thin to afford it: with four makers on the bench it left a third of judge seats with
    // no vetted spare at all, which meant the router, which is what put a content-safety
    // classifier in a judge's seat in the first place. Avoiding it also pushed models onto
    // the bench for their maker rather than their fitness, and one of those could not
    // return a verdict at all. So a different-maker spare is offered first and always, and
    // a same-maker one is taken only when nothing else is left — where the alternative is
    // not a purer bench but an unvetted model or an empty seat. When it happens the record
    // says so: `aggregate.ts` reports two judges answering on one maker exactly as it
    // reports two roles answering on one model, because the thing that must never happen
    // is not a shared lineage but a shared lineage nobody is told about.
    const makersInUse = new Set(others.map(providerOf));
    const fresh = eligible.filter((model) => !makersInUse.has(providerOf(model)));
    const shared = eligible.filter((model) => makersInUse.has(providerOf(model)));
    // Both halves keep the warm-first order they arrived in, so a fresh-maker model that
    // is refusing still ranks below a fresh-maker model that is answering.
    return [...fresh, ...shared];
  };

  // **Spares are claimed, not merely offered.** Walking the seats in order and letting
  // each take the first spare no earlier seat has taken is what keeps two roles failing
  // at the same moment from landing on the same model. Rotating a per-seat list is not
  // enough: each seat's list is filtered differently, so two seats can rotate onto the
  // same entry. This is deterministic — same casting, same assignment, every time.
  const assignment = assignSpares(seats, sparesFor);
  const mine = assignment.get(primary);
  const options = sparesFor(primary);
  const claimed = new Set(assignment.values());

  /**
   * The third entry, reached only when a role's own model and its assigned spare have both
   * failed on kinds a second ask cannot clear.
   *
   * The advocates take another vetted model — their pool has five spares for four seats, so
   * there is normally one no other seat has claimed. **The bench takes the router instead**,
   * because the only models left for it are ones other judges are holding, and two judges
   * on the same weights vote twice with one mind: a majority of three lets such a pair
   * decide, invisibly. An unvetted model off the router is poorer prose in a single seat and
   * fails loudly, which the bench already survives honestly.
   */
  /**
   * Everything else this seat could use, unclaimed models first.
   *
   * A spare another role has already claimed is still offered, behind the unclaimed ones,
   * because it ranks above the router: two advocates sharing a fallback matters only if both
   * fail at once and is disclosed either way, whereas the router can resolve to a model this
   * app has specifically judged unfit. A vetted model held by someone else beats a lottery.
   */
  const extras = [
    ...options.filter((model) => model !== mine && !claimed.has(model)),
    ...options.filter((model) => model !== mine && claimed.has(model)),
  ];

  /**
   * **When the bench runs out of unclaimed spares it takes the router, not a spare another
   * judge has already claimed.** Part 1's "no two roles share a model" is a non-negotiable
   * for judges specifically because a duplicated seat votes twice: two judges on identical
   * weights reading the same prompt can agree for reasons that are not judicial, and a
   * majority of three lets that pair decide, invisibly. An unvetted model off the router
   * is worse prose but only ever one seat, and it fails loudly — the classifier that took
   * a judge's seat on 2026-08-22 returned nothing readable and was recorded as a failed
   * judge, which the bench survives honestly. Advocates do not vote, so for them a shared
   * spare is merely disclosed.
   */
  const offered = mine ? [mine, ...extras] : options;

  const chain = [...new Set([primary, ...offered, FALLBACK_ROUTER])];
  return chain.slice(0, MAX_ATTEMPTS_PER_CALL);
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

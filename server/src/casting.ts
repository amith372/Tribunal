/**
 * casting.ts — which model sits in which seat, and where a seat falls when its own model
 * will not answer.
 *
 * **Split out of `config.ts`, and the split is the point.** That file held two jobs with
 * nothing to do with each other: the free-model *policy* — small, absolute, and the app's
 * hardest safety guarantee — and this, which is intricate, heuristic, and where every bug
 * in that file has actually been. Both faults of 2026-08-22 were casting faults:
 * `buildRegistry` truncating the pools back to the seat count, and `resolveRunModels`
 * handing `fallbackChainFor` the whole pool as "already in use", which emptied every chain
 * of spares. Neither touched the free rule, but both were changes to the file the free rule
 * lives in.
 *
 * **The dependency runs one way and cannot run the other.** This module asks `config.ts`
 * for the pools and never decides what may be in them: every identifier it can reach has
 * already passed `isFreeModelId`, and `openrouter.ts` re-checks with `assertAllowedModel`
 * before a request leaves the server regardless. Casting is safe here by construction
 * rather than by remembering to check — which is exactly the property the split had to
 * preserve, since the old file got it by holding both halves at once.
 */

import { FALLBACK_ROUTER, getModelRegistry } from "./config.js";
import { warmFirst } from "./model-health.js";

/** How the seven seats are cast: one model for all of them, or one each. */
export type Mode = "solo" | "per-role";

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

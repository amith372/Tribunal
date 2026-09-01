/**
 * dispatch.ts — how a wave of calls is released.
 *
 * A run is two waves of parallel calls: four advocates, then three judges. Both waves used
 * `Promise.all` over a `map`, which is the same idiom written twice and, more to the point,
 * left nobody owning *when* the requests leave. This module owns that and nothing else.
 *
 * ---------------------------------------------------------------------------------------
 * **What the runs actually say**, measured over the nine recorded in `runs.jsonl`:
 *
 *     104 attempts, 42 of them failed
 *      31 rate-limited — 30% of every request this app has ever made
 *      25 of those 31 on the role's *first* attempt
 *       9 of 9 runs hit at least one
 *
 * That is severe enough to be worth acting on. But the measurement also **refutes the
 * obvious explanation**, and the refutation is the interesting part.
 *
 * The tempting story is that four simultaneous requests trip a per-model limit. They cannot:
 * in per-role mode the four advocates are on four *different* models, so a burst sends each
 * model exactly one request. And the limits arrive on three, and once six, distinct models
 * *within a single run* — a per-model limiter cannot do that either.
 *
 * So what is being hit is shared: an account-wide or provider-pool ceiling, not this app
 * hammering one model. The judge wave is limited more often than the advocate wave (36% vs
 * 25%) despite being smaller, which fits — it fires seconds after four requests have already
 * gone out.
 *
 * **Which leaves the honest position: spacing is worth trying and is not proven.** Against a
 * pool that is momentarily saturated, arriving a few hundred milliseconds apart genuinely
 * helps. Against a limiter that counts requests per minute, seven requests spread over a
 * second and a half are still seven requests in that minute, and this buys nothing at all.
 * Which of the two OpenRouter's free tier applies is not something this app can see from
 * outside, and no amount of reasoning here will settle it.
 *
 * So this is built as the place the question can be *answered* rather than as a fix asserted
 * to work: the pacing is one constant in one module, and `runs.jsonl` already records the
 * error kind of every attempt. Comparing the rate-limited share before and after is a real
 * experiment, and it is the only thing that should decide whether this constant stays.
 * ---------------------------------------------------------------------------------------
 *
 * The cost is bounded and small: at four seats a wave is delayed by three intervals, and a
 * run that takes 47 to 171 seconds pays about a second and a half in total. `run.ts`'s
 * whole-run deadline is unchanged — it has minutes of headroom over this.
 */

/**
 * How long to wait between releasing one call and the next, within a wave.
 *
 * **Deliberately a guess, and labelled as one.** Long enough that a saturated pool has a
 * moment to drain, short enough that nobody watching the trial screen can see it. Every
 * other number in this project carries the measurement that produced it; this one carries
 * the experiment that has not been run yet, which is a different thing and should not be
 * dressed up as the first.
 */
export const WAVE_STAGGER_MS = 300;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A run must never be held open by a pending timer once its work is done.
    timer.unref?.();
  });

/**
 * Runs every task in a wave, releasing them `staggerMs` apart, and resolves when all have
 * settled — the same contract `Promise.all` gave, with the launches spread out.
 *
 * **They still overlap.** This paces the *starts*, not the calls: task one is already in
 * flight while task two is being released, so a wave still costs about as long as its
 * slowest member rather than the sum of them. Turning parallel calls into sequential ones
 * would multiply a run's wall clock by four and is not what any of this is for.
 *
 * Nothing is waited for before the first task, and nothing after the last, so a wave of one
 * is exactly as fast as it was.
 */
export async function releaseWave<T>(
  tasks: readonly (() => Promise<T>)[],
  staggerMs: number = WAVE_STAGGER_MS,
): Promise<T[]> {
  const running: Promise<T>[] = [];
  for (const [index, task] of tasks.entries()) {
    if (index > 0 && staggerMs > 0) await sleep(staggerMs);
    running.push(task());
  }
  return Promise.all(running);
}

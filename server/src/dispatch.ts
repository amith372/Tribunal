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
 * So this was built as the place the question could be *answered* rather than as a fix
 * asserted to work: the pacing is one constant in one module, and `runs.jsonl` records the
 * error kind of every attempt.
 *
 * **The experiment has since been run, and it supports the stagger.** Two runs on 2026-09-02:
 *
 *                        first attempts rate-limited      all attempts
 *     before (no wait)          25 / 63  = 39.7%          31 / 104 = 29.8%
 *     after  (300ms)             1 / 14  =  7.1%           5 /  21 = 23.8%
 *
 * The first column is the one the stagger can affect and it moved (z = 2.33). The second
 * did not (z = 0.55), which is what should happen: a stagger spaces *first* attempts, and
 * retries and fallbacks are already spread out in time by the failures that caused them.
 * The prediction that first attempts were the burst position was written down before these
 * two runs existed, so the subgroup was not chosen after seeing the result.
 *
 * **It is not settled.** Fourteen first attempts is a small sample, two runs is a small
 * sample, and the free tier's behaviour is not stable week to week. What can be said is that
 * the number is no longer a guess, and that the evidence points the way the mechanism said
 * it would. Re-run the comparison before trusting it further.
 * ---------------------------------------------------------------------------------------
 *
 * The cost is bounded and small: at four seats a wave is delayed by three intervals, and a
 * run that takes 47 to 171 seconds pays about a second and a half in total. `run.ts`'s
 * whole-run deadline is unchanged — it has minutes of headroom over this.
 */

/**
 * How long to wait between releasing one call and the next, within a wave.
 *
 * Long enough that a saturated pool has a moment to drain, short enough that nobody watching
 * the trial screen can see it. It began as a guess and is no longer one: measured over two
 * runs on 2026-09-02, first-attempt rate limits fell from 39.7% to 7.1% while the overall
 * share did not move, which is exactly the shape a working stagger has. The sample is small
 * and the docblock above says so — what it is not any more is an assertion with nothing
 * behind it.
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

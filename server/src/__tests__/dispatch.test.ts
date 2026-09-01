/**
 * How a wave is released.
 *
 * Two properties pull against each other and both have to hold: the calls must be *spread*
 * (or the stagger does nothing) and they must still *overlap* (or a run's wall clock
 * multiplies by four). Before `dispatch.ts` existed neither was expressible as a test —
 * `Promise.all` over a `map` was written out in two files and nobody owned the timing.
 *
 * **The margins here are deliberately loose.** These are wall-clock assertions, and this
 * project has already lost a commit to a timing test that sat ten milliseconds from its own
 * limit. What is being checked is the difference between "spread out" and "all at once",
 * which is an order of magnitude, not a stopwatch reading — so every bound below is set far
 * from the value it is testing.
 */

import { describe, expect, it } from "vitest";

import { releaseWave, WAVE_STAGGER_MS } from "../dispatch.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Tasks that record when each was released, and take `durationMs` to finish. */
function tracked(count: number, durationMs = 100) {
  const startedAt: number[] = [];
  const began = Date.now();
  const tasks = Array.from({ length: count }, (_, index) => async () => {
    startedAt.push(Date.now() - began);
    await sleep(durationMs);
    return index;
  });
  return { tasks, startedAt };
}

describe("a wave is released a stagger apart", () => {
  it("spreads the starts instead of firing them together", async () => {
    const { tasks, startedAt } = tracked(4, 50);
    await releaseWave(tasks, 40);

    // Four starts, each meaningfully after the last. A `Promise.all` would put all four
    // within a millisecond or two of zero.
    expect(startedAt).toHaveLength(4);
    for (let i = 1; i < startedAt.length; i += 1) {
      expect((startedAt[i]) - (startedAt[i - 1])).toBeGreaterThanOrEqual(20);
    }
  });

  /**
   * The property that stops this being an accidental rewrite into sequential calls. Four
   * hundred-millisecond tasks run one after another take 400ms; released 20ms apart and
   * overlapping, they take a little over 100.
   */
  it("still overlaps, so a wave costs its slowest member and not their sum", async () => {
    const { tasks } = tracked(4, 100);
    const began = Date.now();
    await releaseWave(tasks, 20);
    const elapsed = Date.now() - began;

    expect(elapsed).toBeLessThan(300);
  });

  it("returns results in the order the tasks were given, not the order they finished", async () => {
    const out = await releaseWave(
      [
        async () => {
          await sleep(60);
          return "slow-first";
        },
        async () => "fast-second",
      ],
      10,
    );
    expect(out).toEqual(["slow-first", "fast-second"]);
  });

  it("waits before nothing: a wave of one is not delayed at all", async () => {
    const began = Date.now();
    await releaseWave([async () => "only"], 500);
    expect(Date.now() - began).toBeLessThan(200);
  });

  /**
   * The seam the timing-sensitive suites use. `statements.test.ts` and `judging.test.ts`
   * measure whether a wave is parallel, and `run.test.ts` measures the whole-run deadline
   * against timeouts of a few tens of milliseconds — none of which should be able to fail
   * because of pacing.
   */
  it("releases everything at once when the stagger is zero", async () => {
    const { tasks, startedAt } = tracked(4, 20);
    await releaseWave(tasks, 0);
    expect((startedAt.at(-1) as number) - (startedAt[0])).toBeLessThan(20);
  });

  it("rejects like Promise.all when a task fails", async () => {
    await expect(
      releaseWave([async () => 1, () => Promise.reject(new Error("upstream refused"))], 5),
    ).rejects.toThrow("upstream refused");
  });

  /**
   * The cost, stated as a number rather than left to be discovered: four seats is three
   * intervals, and a run measured at 47 to 171 seconds pays about a second for the wave.
   */
  it("costs a bounded and small amount at the size a run actually uses", () => {
    expect(WAVE_STAGGER_MS * 3).toBeLessThan(2_000);
  });
});

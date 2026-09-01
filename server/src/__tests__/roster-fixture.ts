/**
 * The roster every test runs against, set before any of them.
 *
 * The app discovers its roster from OpenRouter at startup (specs.md Part 1), so nothing
 * downstream of `config.ts` can compose a registry until one has arrived. A test suite must
 * not depend on a network call — and must not depend on what OpenRouter happens to be
 * offering today, which is the whole reason the roster stopped being written down.
 *
 * So the suite is handed a fixed one. **These identifiers are deliberately invented**: what
 * every test below the registry actually needs is a roster with enough models, spread over
 * enough makers, to cast seven seats and leave spares — not the real roster, whose contents
 * are a fact about a Tuesday.
 *
 * Six makers, twelve models. That is enough for the bench's lineage rule to have somewhere
 * to go and for `fallbackChainFor` to find a spare that no other seat has claimed, which is
 * what the interesting tests are about.
 */

import { beforeEach } from "vitest";

import { resetModelRegistry, setRoster } from "../config.js";

export const FIXTURE_ROSTER: readonly string[] = [
  "alpha/one-large:free",
  "alpha/one-small:free",
  "beta/two-large:free",
  "beta/two-small:free",
  "gamma/three-large:free",
  "gamma/three-small:free",
  "delta/four-large:free",
  "delta/four-small:free",
  "epsilon/five-large:free",
  "epsilon/five-small:free",
  "zeta/six-large:free",
  "zeta/six-small:free",
];

/**
 * Applied at load as well as before each test.
 *
 * Several suites build their fixtures at module scope — `run.test.ts` reads the pools into
 * a `MODELS` constant, for one — and module bodies run before any hook does. Setting it
 * here as well is what lets those files be imported at all.
 */
setRoster(FIXTURE_ROSTER);

/**
 * Reset before *each* test rather than once for the file.
 *
 * `model-guard.test.ts` deliberately varies the roster to prove the policy refuses what it
 * should, and a test that left a narrowed roster behind would fail whichever test happened
 * to run next — the kind of order-dependent failure that costs an afternoon.
 */
beforeEach(() => {
  resetModelRegistry();
  setRoster(FIXTURE_ROSTER);
});

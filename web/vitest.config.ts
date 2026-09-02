import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The browser half's test runner — deliberately without a DOM.
 *
 * **There is very little left here, and that is the point.** What used to live in this
 * workspace was `results-model.ts`: the sentences the results screen makes about a run,
 * kept as a mirror of the server's `summary.ts` and held against it by a test in the
 * server's suite. There is one copy now — the server's, which the browser reads through
 * the `@record` alias — so those assertions moved to `server/src/__tests__/summary.test.ts`,
 * where the code they test lives, and the mirror test they needed no longer exists.
 *
 * What remains is what is genuinely the browser's: which panel is on screen, and what a tab
 * remembers between page loads. Neither is part of the record.
 *
 * `setup-checks.ts` is tested from the *server's* suite for the same reason, and it is no
 * longer an exception to the arrangement above — it was `preflight-mirror.ts`, and its
 * copies of the pre-flight's predicates went the way `results-model.ts` went. What its test
 * still checks is the part that was never shared: that the screens' own assembly of the
 * checks, and their own casting rules, accept exactly the drafts the server accepts. A test
 * beside only one of those two halves cannot check that they agree.
 */
export default defineConfig({
  // The alias `vite.config.ts` sets, repeated because vitest reads this config and not
  // that one. The browser's modules reach the record through it, so the tests must too.
  resolve: {
    alias: { "@record": fileURLToPath(new URL("../server/src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});

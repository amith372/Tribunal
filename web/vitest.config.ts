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
 * `preflight-mirror.ts` is still the exception that proves the arrangement: it is tested
 * from the *server's* suite, against the same case catalogue the server's own pre-flight
 * runs — because what matters about it is that the two agree, and a test that lives beside
 * only one of them cannot check that.
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

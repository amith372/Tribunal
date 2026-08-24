import { defineConfig } from "vitest/config";

/**
 * The browser half's test runner — new at Stage 8, and deliberately without a DOM.
 *
 * What is worth testing here is not that React renders: it is the claims the results
 * screen makes about a run. How many judges agreed, who dissented, whether a trial is
 * reported as incomplete, which side reads left, how the call table groups into waves —
 * those are sentences and orderings, and they are wrong in ways a rendered snapshot would
 * not notice. So they live in `results-model.ts` as plain functions, and this runs them
 * directly, with no jsdom, no test renderer and nothing to keep in step with React.
 *
 * `preflight-mirror.ts` is the exception that proves the arrangement: it is already tested,
 * from the *server's* suite, against the same case catalogue the server's own pre-flight
 * runs — because what matters about it is that the two agree, and a test that lives beside
 * only one of them cannot check that.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});

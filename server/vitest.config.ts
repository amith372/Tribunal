import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  /**
   * `@record` resolved to this workspace's own `src`, which reads oddly until you see who
   * needs it: `setup-checks.test.ts` imports `web/src/setup-checks.ts`, and that file reads
   * the pre-flight's predicates through the alias. So the *server's* runner has to resolve
   * the browser's spelling of a path into this directory.
   *
   * It is the same target the browser's two configs point at — one directory, three configs
   * naming it, because vite, vitest-web and vitest-server each read only their own.
   */
  resolve: {
    alias: { "@record": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Source only. Without this a stale `dist/` would be collected as well and every
    // test would silently run twice.
    include: ["src/**/*.test.ts"],
    // The roster is discovered from OpenRouter at startup, so nothing can compose a model
    // registry until one arrives. The suite is handed a fixed one instead of a network
    // call — see `roster-fixture.ts` for why the identifiers in it are invented.
    setupFiles: ["src/__tests__/roster-fixture.ts"],
  },
});

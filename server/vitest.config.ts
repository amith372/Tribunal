import { defineConfig } from "vitest/config";

export default defineConfig({
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

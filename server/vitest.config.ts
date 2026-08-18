import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Source only. Without this a stale `dist/` would be collected as well and every
    // test would silently run twice.
    include: ["src/**/*.test.ts"],
  },
});

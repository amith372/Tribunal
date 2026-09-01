import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * `@record` points at the server's source, and that is deliberate.
 *
 * specs.md Part 3: one run produces one record, and the panels, the stream's closing
 * message and the exported file are three renderings of *that one object*. That only holds
 * if the three agree about what the object is and what it says — and for a long time it was
 * held by a test instead, with `web/src/results-model.ts` mirroring `server/src/summary.ts`
 * line for line and `summary-mirror.test.ts` proving the two had not drifted.
 *
 * The mirror's stated justification was that the workspaces compile separately. They do —
 * but the *browser* was never the authority on what a run says; the server is, which is why
 * the mirror test lived in the server's suite. So the browser now reads the server's copy
 * rather than keeping one of its own, and the drift it was guarding against cannot happen.
 *
 * **What crosses the boundary is safe to cross.** `summary.ts` has no runtime imports at
 * all — every one of them is `import type`, so nothing but the string-building itself is
 * bundled. No model identifier, no key, no Node built-in and no Express can reach the
 * browser through this alias, and specs.md Part 1's rule that the client names no model
 * is untouched.
 */
const record = fileURLToPath(new URL("../server/src", import.meta.url));

// One URL in production: Express serves this build plus /api, so there is no CORS.
// In development Vite proxies /api to the Express process instead.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@record": record },
  },
  server: {
    port: 5173,
    // The alias reaches one directory above this workspace, so the dev server has to be
    // allowed to read it. The build has no such restriction.
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

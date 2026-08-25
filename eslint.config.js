// @ts-check
/**
 * eslint.config.js — the third kind of check.
 *
 * Tests catch behaviour and type checks catch wrong kinds; both were already in the gate.
 * A linter catches a third class neither of them sees: patterns that compile, typecheck
 * and pass, and are still wrong. The ones that matter here are all about *async*, because
 * this app is almost entirely async and its failure mode is silence — a promise nobody
 * awaited does not crash, it just never happens, and a run that quietly loses a wave looks
 * exactly like a slow free model.
 *
 * **Type-aware rules, not just syntactic ones.** `no-floating-promises` and
 * `no-misused-promises` need the type checker to work at all, and they are the two rules
 * this codebase most needs. Linting is slower for it. It runs in the pre-commit hook and
 * in the stage gate, neither of which is a hot path.
 *
 * Where a rule is switched off below, the reason is written down. A rule turned off without
 * one is how a linter becomes decoration.
 */

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output and dependencies. `**/dist/**` covers both workspaces' builds.
    ignores: ["**/node_modules/**", "**/dist/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        /**
         * Every tsconfig in the repo, listed rather than discovered.
         *
         * `projectService` finds the nearest `tsconfig.json` and stops, which leaves both
         * `scripts/` folders unparsed — they sit outside their workspace's `include` on
         * purpose and are typechecked on configs of their own. A tool that silently skips
         * ten files is worse than one that fails loudly, so the list is explicit: if a new
         * config appears and is not added here, its files stop being linted, and that is
         * the kind of quiet gap this whole exercise is about closing.
         */
        project: [
          "./server/tsconfig.json",
          "./server/tsconfig.scripts.json",
          "./web/tsconfig.json",
          "./tsconfig.scripts.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * The two rules this config exists for.
       *
       * A dropped promise in this app is a wave that never reports, a stream that never
       * closes, or a record that is never written — none of which raises anything. Where a
       * promise really is meant to be abandoned, `void` says so on purpose, which is a
       * decision a reader can see rather than an omission they cannot.
       */
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // `any` erases the checking the rest of the toolchain is doing. `unknown` is the
      // honest version and the codebase already uses it at every trust boundary.
      "@typescript-eslint/no-explicit-any": "error",

      // An unused argument is usually a half-finished refactor. Leading underscore is the
      // documented way to say "required by the signature, deliberately unread".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Debug output left behind in a server that streams is noise in the one place a real
      // fault would show. `console.error` and `console.warn` are how this app reports for
      // real, and the scripts are console programs, so both are allowed.
      "no-console": ["warn", { allow: ["warn", "error", "log"] }],
    },
  },

  {
    // The build's own config files belong to no tsconfig — they configure compilation
    // rather than being compiled. Linted without type information, which is all a
    // fifteen-line config needs.
    files: ["**/*.config.js", "**/*.config.ts", "eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    // The browser half. The hooks rules are the reason this plugin is here: Stage 7 hit the
    // exact failure they exist to prevent — an effect whose dependencies re-ran it — and in
    // this app re-running one effect meant spending seven more model requests.
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    files: ["server/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    /**
     * Test files, fixtures and console scripts. Four rules are relaxed here and each has a
     * reason, because a rule switched off without one is how a linter becomes decoration.
     *
     *   · `no-console` — the scripts *are* console programs and a test may report.
     *   · the three `no-unsafe-*` — a test that hands the endpoint a deliberately malformed
     *     payload has to construct one, and constructing an invalid value is the assertion.
     *   · `require-await` — a fake standing in for `callChat` implements an async interface
     *     and has nothing to await. Wrapping every return in `Promise.resolve` to satisfy a
     *     rule would make the fixtures harder to read and no safer. The rule stays on
     *     everywhere it can catch a real missing `await`.
     */
    files: ["**/__tests__/**/*.ts", "**/*.test.ts", "**/scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/require-await": "off",
      /**
       * `no-redundant-type-constituents` — the scripted-caller fixture types a reply as
       * `string | ErrorKind`, which does collapse to `string`, and the rule is correct that
       * the compiler learns nothing from it. It is kept because a reader does: it says a
       * scripted reply is either text to return or a kind of failure to throw, which is
       * exactly what the fixture then branches on. Documentation the type system cannot
       * enforce is still documentation.
       */
      "@typescript-eslint/no-redundant-type-constituents": "off",
    },
  },
);

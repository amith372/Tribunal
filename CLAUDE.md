# CLAUDE.md — The Tribunal

Standing instructions for Claude Code in this repo. This is the only file loaded into *every* session, so it stays short.

> **This file = *how* to build.** **`specs.md` = *what* to build** — five prose parts, read on demand, never auto-loaded. It is the source of truth for behavior and wins if the two disagree.

## What this is
A school project for a vibe-coding class. A charge sheet goes in; four advocates — two for, two against, cast by the user — each make one statement; three judges each return a verdict and reasoning; the app shows the majority verdict with a real token and price breakdown, and exports the run as a self-contained HTML file. Seven free OpenRouter model calls per run. **The graded deliverable is the specification and the record of how we collaborate with and verify the AI** — the running app matters less than showing that process. So when an unwritten decision comes up, resolve it toward what makes the spec correct and the process legible.

## Stack
| Layer | Choice |
|---|---|
| Backend | Node + TypeScript (Express); pure pipeline modules, thin routing layer |
| Frontend | React + Vite + TypeScript, single page, SSE-driven |
| Assets | Avatar art: 17 source PNGs in `C:\Users\Amit_PC\Downloads\Tribunal` — `idle_*` / `thinking_*` / `happy_*` per character (`jon`, `daenerys`, `tyrion`, `worm`, `cersei`) plus a shared `judge.png` / `undone_judge.png`. Downsample to ≤256 px WebP into `web/public/avatars/`; commit the WebP only, never the multi-MB originals |
| Models | OpenRouter, free (`:free`) models only, identifiers server-side |
| Persistence | **None** — the exported HTML file is the run record |
| Deploy | Render free Web Service, kept awake by an external keep-warm pinger; `OPENROUTER_API_KEY` is a Render env var, never in the repo |
| Tests | Vitest — pre-flight, judge parser, aggregation, model guard, and the client's mirror of the pre-flight |
| Gate | `.githooks/pre-commit` refuses a commit that leaks a key, names a model in `web/src`, or fails typecheck, lint or tests. Enable per clone with `npm run hooks`; ~13s |

## Working rules
1. **Spec first.** Fix `specs.md` before you fix code; never patch code around a stale spec. Judge quality by the spec, not the code.
2. **Ask when unclear.** If a requirement is ambiguous or you are about to guess, stop and ask one focused question before coding.
3. **Change the file and log it together, under today's date.** When a decision changes behavior, edit whichever file it belongs to — `specs.md` (what to build) or `CLAUDE.md` (how to build) — and *in the same step* add an entry to `spec_logs.md`. Each entry states **what changed, why, and which Part or section**. Put it under a section header for the **actual date the change is made** — **confirm the real current date rather than assuming it**; this plan was first drafted under the wrong date, which is exactly what this guards against. If today has no section yet, start a new one at the top (newest first). Never append today's change to an earlier date's section, and never backdate. **When a decision supersedes an earlier logged one, delete the superseded entry in the same step** — the log keeps only what still stands, so a reader never has to work out which of two contradicting entries is current. The edit and its log entry always move together — the spec file is the truth, `spec_logs.md` is the standing record of why.
4. **The mechanical checks are not yours to judge.** `npm run typecheck`, `npm run lint` and `npm test` all pass before anything is committed, and the pre-commit hook enforces that with nobody present. Never commit with `--no-verify`, and never turn a lint rule off without writing the reason beside it.
5. **Don't drift from the non-negotiables below.**

## Non-negotiables
Duplicated here on purpose, so they still hold in a session that never opens `specs.md`. On any conflict, `specs.md` wins.

- Personas are voice only, never a fact source; a missing fact is labelled an assumption. (Part 1)
- No model call before the pre-flight check passes. (Parts 1 & 4)
- Judges return one verdict (`guilty`/`not_guilty`) plus reasoning — salvaged leniently from the text, retried once, never fabricated. (Part 5)
- Token and price numbers are read from the API response, never invented. (Parts 1–2)
- Free models only: an allowlist plus the `:free` rule, enforced server-side. No env var, flag, or request field may permit a paid model. (Parts 1–2, 5)
- The defendant is never also an advocate, and the split is exactly 2 for / 2 against. (Part 1)
- The HTML export is the run record — self-contained, opens offline, numbers matching the app. (Part 3)

## Where to read
| Working on | Read |
|---|---|
| setup, casting, pre-flight, models, sizes | `specs.md` Part 1 |
| what "done" means, anything test-shaped | Part 2 |
| server/client boundary, no-database stance, the export | Part 3 |
| the Jon Snow validation case and the invalid cases | Part 4 |
| failures, parsing, timeouts, rate limits, cost holes | Part 5 |
| the look of a screen — frame, palette, type, tiles, buttons | the design canvas (all four screens, cast from the Jon Snow case): https://claude.ai/code/artifact/d7decf08-3027-4163-bab6-e03d67995478 — then Part 1 |
| **why** a rule exists | `spec_logs.md` — read it only then. It is long, grows forever, and is rarely needed to build. Past ~150 KB, archive older months to `spec_logs_archive.md`. |

## Code conventions
- Explicit, readable pipeline: `setup → statements → judging → aggregate`, one module each, framework-agnostic and unit-testable.
- Type the OpenRouter request and response shapes; read the `usage` field for real token counts.
- Small, testable prompt-building functions; unit-test the judge-output parser against malformed input.

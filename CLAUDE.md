# CLAUDE.md — The Tribunal

Standing instructions for Claude Code in this repo. This is the only file loaded into *every* session, so it stays short.

> **This file = *how* to build.** **`specs.md` = *what* to build** — five prose parts, read on demand, never auto-loaded. It is the source of truth for behavior and wins if the two disagree.

## What this is
A school project for a vibe-coding class. A charge sheet goes in; four advocates — two for, two against, cast by the user from the five characters, the accused included — each make one statement; three judges each return a verdict and reasoning; the app shows the majority verdict with a real token and price breakdown, and exports the run as a self-contained HTML file. Seven free OpenRouter model calls per run. **The graded deliverable is the specification and the record of how we collaborate with and verify the AI** — the running app matters less than showing that process. So when an unwritten decision comes up, resolve it toward what makes the spec correct and the process legible.

## Stack
| Layer | Choice |
|---|---|
| Backend | Node + TypeScript (Express); pure pipeline modules, thin routing layer |
| Frontend | React + Vite + TypeScript, single page, SSE-driven |
| Assets | Avatar art: 17 source PNGs in `C:\Users\Amit_PC\Downloads\Tribunal` — `idle_*` / `thinking_*` / `happy_*` per character (`jon`, `daenerys`, `tyrion`, `worm`, `cersei`) plus a shared `judge.png` / `undone_judge.png`. Downsample to ≤256 px WebP into `web/public/avatars/`; commit the WebP only, never the multi-MB originals |
| Models | OpenRouter, free (`:free`) models only, identifiers server-side |
| Case data | `data/characters.md`, `data/relations.md`, `data/judges.md` — the only source of character facts. Five characters, ten relations, three judges (Barak, Elon, Shamgar), each judge's persona adapted from three of their reported opinions, which the file cites |
| Persistence | MongoDB Atlas archives every finished run server-side (`MONGODB_URI` / `MONGODB_DB`, unset means no archive and the app degrades cleanly); the exported HTML file is the portable copy, rebuildable from the archive |
| Deploy | Render free Web Service at `tribunal-sflw.onrender.com`, built with `npm ci --include=dev && npm run build` — the `--include=dev` matters, since Render sets `NODE_ENV=production` and vite and tsc are devDependencies. Three env vars on the host — `OPENROUTER_API_KEY`, `MONGODB_URI`, `MONGODB_DB` — none of them ever in the repo; Atlas must allow `0.0.0.0/0`, because the free tier has no static outbound IP. Kept awake by an external pinger on `/api/health` every 10 minutes over a bounded daily window: the free instance sleeps after 15 minutes idle, so a longer interval keeps nothing warm. See the README's Deployment section |
| Tests | Vitest in **both** workspaces; `npm test` runs both. Server: pre-flight, judge parser, aggregation, model guard, the export and its palette against `tokens.css`, and the archive's round trip — a record survives being broken into the archive's two documents and put back together identical, byte-identical export included, with no test opening a real database connection. Web: the sentences the results panels derive from a record — and those same sentences are held against the server's copy from the *server* suite, since the exported file and the panels must word a run identically. The client's pre-flight mirror is tested from the *server* suite on purpose — it exists to agree with the server's pre-flight, and a test beside only one of them cannot check agreement |
| Gate | `.githooks/pre-commit` refuses a commit that leaks a credential (an API key or a Mongo connection string), names a model in `web/src`, or fails typecheck, lint or tests. Enable per clone with `npm run hooks`; ~13s |

## Working rules
1. **Spec first.** Fix `specs.md` before you fix code; never patch code around a stale spec. Judge quality by the spec, not the code.
2. **Ask when unclear.** If a requirement is ambiguous or you are about to guess, stop and ask one focused question before coding.
3. **Change the file with the code.** When a decision changes behavior, edit whichever file it belongs to — `specs.md` (what to build) or `CLAUDE.md` (how to build) — in the same step as the code that implements it. The spec file is the truth; it does not trail the code that was supposed to follow it.
4. **The mechanical checks are not yours to judge.** `npm run typecheck`, `npm run lint` and `npm test` all pass before anything is committed, and the pre-commit hook enforces that with nobody present. Never commit with `--no-verify`, and never turn a lint rule off without writing the reason beside it.
5. **Don't drift from the non-negotiables below.**

## Non-negotiables
Duplicated here on purpose, so they still hold in a session that never opens `specs.md`. On any conflict, `specs.md` wins.

- Personas are voice only, never a fact source; a missing fact is labelled an assumption. The character descriptions carry manner, values and argumentative habit and no plot at all — no place, house, office, army or event — because a name is a fact. (Part 1)
- No model call before the pre-flight check passes. (Parts 1 & 4)
- Judges return one verdict (`guilty`/`not_guilty`) plus reasoning — salvaged leniently from the text, retried once, never fabricated. (Part 5)
- Token and price numbers are read from the API response, never invented. (Parts 1–2)
- Free models only: an allowlist plus the `:free` rule, enforced server-side. No env var, flag, or request field may permit a paid model. (Parts 1–2, 5)
- The accused may argue their own defence and may never prosecute themselves. Four seats are drawn from all five characters, so one character sits every case out, and the split is exactly 2 for / 2 against. (Part 1)
- The HTML export is the portable run record — self-contained, opens offline, numbers matching the app — rebuildable from the archive as well as from a run still in flight. (Part 3)
- A browser's archive list is per-browser: the server archives every run, but a browser lists only the ids it kept itself, and character relations stored with an archived run stay server-side, never reaching the browser or the export. (Part 3)

## Where to read
| Working on | Read |
|---|---|
| setup, casting, pre-flight, models, sizes | `specs.md` Part 1 |
| what "done" means, anything test-shaped | Part 2 |
| server/client boundary, the archive, the export | Part 3 |
| the Jon Snow validation case and the invalid cases | Part 4 |
| failures, parsing, timeouts, rate limits, cost holes | Part 5 |
| the look of a screen — frame, palette, type, tiles, buttons | the design canvas (all four screens, cast from the Jon Snow case): https://claude.ai/code/artifact/d7decf08-3027-4163-bab6-e03d67995478 — then Part 1 |

## Code conventions
- Explicit, readable pipeline: `setup → statements → judging → aggregate`, one module each, framework-agnostic and unit-testable.
- Type the OpenRouter request and response shapes; read the `usage` field for real token counts.
- Small, testable prompt-building functions; unit-test the judge-output parser against malformed input.

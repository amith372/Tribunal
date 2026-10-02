# CLAUDE.md — The Tribunal

Standing instructions for Claude Code in this repo. This is the only file loaded into *every*
session, so it stays short: what the project is, how to work in it, and where to read the rest.

> **This file = *how* to build.** **`specs.md` = *what* to build** — five prose parts, read on
> demand, never auto-loaded. It is the source of truth for behavior and wins if the two disagree.

## What this is
A school project for a vibe-coding class. A charge sheet goes in; four advocates — two for, two
against, cast by the user from the five characters, the accused included — each make one
statement; three judges each return a verdict and reasoning; the app shows the majority verdict
with a real token and price breakdown, and exports the run as a self-contained HTML file. Seven
free OpenRouter model calls per run.

**The graded deliverable is the specification and the record of how we collaborate with and
verify the AI** — the running app matters less than showing that process. So when an unwritten
decision comes up, resolve it toward what makes the spec correct and the process legible.

## Stack
| Layer | Choice |
|---|---|
| Backend | Node + TypeScript (Express); pure pipeline modules, thin routing layer. Model **policy** (`config.ts`) and model **casting** (`casting.ts`) are separate, and the dependency runs one way — a test fails if it ever reverses |
| Frontend | React + Vite + TypeScript, single page, SSE-driven |
| Assets | Avatar art as ≤256 px WebP in `web/public/avatars/` — `idle_*` / `thinking_*` / `happy_*` per character (`jon`, `daenerys`, `tyrion`, `worm`, `cersei`) plus a shared `judge.png` / `undone_judge.png`. The 17 source PNGs live in `C:\Users\Amit_PC\Downloads\Tribunal` and are never committed |
| Models | OpenRouter, free (`:free`) models only. Roster membership discovered from OpenRouter at runtime; eligibility and casting server-side, never user-reachable |
| Case data | `data/characters.md`, `data/relations.md`, `data/judges.md` — the only source of character facts. Five characters, ten relations, three judges (Barak, Elon, Shamgar), each judge's persona adapted from three of their reported opinions, which the file cites |
| Persistence | MongoDB Atlas archives every finished run server-side (`MONGODB_URI` / `MONGODB_DB`, unset means no archive and the app degrades cleanly); the exported HTML file is the portable copy, rebuildable from the archive |
| Deploy | Render free Web Service at `tribunal-sflw.onrender.com`. Build with `npm ci --include=dev && npm run build` — the `--include=dev` matters, since Render sets `NODE_ENV=production` and vite and tsc are devDependencies. The three env vars (`OPENROUTER_API_KEY`, `MONGODB_URI`, `MONGODB_DB`) live on the host and never in the repo. **The rest — Atlas access, the keep-awake pinger, why there is no `render.yaml` — is the README's Deployment section** |
| Tests | Vitest in **both** workspaces; `npm test` runs both. Everything server-side lives in the server suite, including the setup screens' checks — they must accept exactly the drafts the server accepts, and a test beside only one of them cannot check agreement. No test opens a real database connection. Web keeps only what is genuinely the browser's: which panel is on screen, and what a tab remembers between loads. **Part 2's table says which test holds each criterion; Part 4 says what makes a test worth having** |
| Gate | `.githooks/pre-commit` refuses a commit that leaks a credential (an API key or a Mongo connection string), names a model in `web/src`, or fails typecheck, lint or tests. Enable per clone with `npm run hooks`; ~13s |

## Working rules
1. **Spec first, and never rewrite the spec without saying so.** Fix `specs.md` before you fix
   code, never patch code around a stale spec, and judge quality by the spec rather than by the
   code. Where the spec itself looks wrong, stale, or too thin for the work being asked for,
   **stop and say so before editing it** — an agent free to edit the source of truth can settle
   any disagreement by rewriting the thing it was going to be judged against, and in a file of
   long paragraphs nobody would see it happen.
2. **Ask when unclear.** If a requirement is ambiguous or you are about to guess, stop and ask
   one focused question before coding.
3. **Don't invent behavior.** Never add a feature, field, screen, rule, refusal or user-facing
   wording because it seems useful or conventional. It rests on `specs.md`, on the design canvas,
   or on a decision the user actually made; where those disagree or leave a real gap, ask. A
   plausible invention is the hardest kind of wrong answer to find later.
4. **Change the file with the code.** When a decision changes behavior, edit whichever file it
   belongs to — `specs.md` (what to build) or `CLAUDE.md` (how to build) — in the same step as
   the code that implements it.
5. **Every stage ends with a check a person runs.** Before a stage is committed, write down what
   to open, type or click to confirm it works, and what a failure would look like. An agent
   verifying its own work only proves the code does what the agent thought. The stage list and
   its gates live in `tribunal_plan.md`, which is local and never committed; a rule that a gate
   changed moves into `specs.md`.
6. **A measurement carries its date and its sample.** "31 of 104 attempts, across nine runs to
   2026-09-01" rather than "often" — the free tier moves week to week, and an undated number can
   neither be re-checked nor retired. Write the prediction down before the run that tests it, and
   say when a figure is still provisional.
7. **The mechanical checks are not yours to judge.** `npm run typecheck`, `npm run lint` and
   `npm test` all pass before anything is committed, and the pre-commit hook enforces that with
   nobody present. Never commit with `--no-verify`, and never turn a lint rule off without
   writing the reason beside it.
8. **Don't drift from the non-negotiables below.**

## Non-negotiables
Duplicated here on purpose, so they still hold in a session that never opens `specs.md`. On any
conflict, `specs.md` wins.

- Personas are voice only, never a fact source; a missing fact is labelled an assumption. The
  character descriptions carry manner, values and argumentative habit and no plot at all — no
  place, house, office, army or event — because a name is a fact. (Part 1)
- No model call before the pre-flight check passes. (Parts 1 & 4)
- Judges return one verdict (`guilty`/`not_guilty`) plus reasoning — salvaged leniently from the
  text, retried once on the judge's own model, never fabricated. (Part 5)
- Token and price numbers are read from the API response, never invented. (Parts 1–2)
- Free models only. **Membership is discovered from OpenRouter, never hand-maintained**;
  eligibility is decided server-side after discovery and is **per role**. Model-health orders the
  choice among eligible models and never establishes eligibility. Discovery failure falls back to
  the last cached roster, and with no cache the run is refused rather than seated on unvetted
  models. No env var, flag, or request field may permit a paid model. (Parts 1–2, 5)
- The accused may argue their own defence and may never prosecute themselves. Four seats are
  drawn from all five characters, so one character sits every case out, and the split is exactly
  2 for / 2 against. (Part 1)
- The HTML export is the portable run record — self-contained, opens offline, numbers matching
  the app — rebuildable from the archive as well as from a run still in flight. (Part 3)
- A browser's archive list is per-browser: the server archives every run, but a browser lists
  only the ids it kept itself, and character relations stored with an archived run stay
  server-side, never reaching the browser or the export. (Part 3)

## Where to read
| Working on | Read |
|---|---|
| setup, casting, pre-flight, models, sizes | `specs.md` Part 1 |
| whether something was considered and declined | Part 1, *What it deliberately does not do* |
| what "done" means, the numbered criteria | Part 2 |
| which test holds a given criterion | Part 2, the criterion table at its end |
| server/client boundary, the archive, the export | Part 3 |
| the Jon Snow validation case and the invalid cases | Part 4 |
| what makes a test valid rather than what is tested | Part 4, *What a test has to prove* |
| failures, parsing, timeouts, rate limits, cost holes | Part 5 |
| the look of a screen — frame, palette, type, tiles, buttons | the design canvas (all four screens, cast from the Jon Snow case): https://claude.ai/code/artifact/d7decf08-3027-4163-bab6-e03d67995478 — then Part 1 |

`specs.md` is prose in long paragraphs and is read a part at a time, never whole. Find a part
with `grep -n '^## Part' specs.md` and read from that line to the next heading. Part 2's
criteria are numbered and are cited by number from the other parts, so find one with
`grep -n '^[0-9]' specs.md` rather than by scrolling.

## Code conventions
- Explicit, readable pipeline: `setup → statements → judging → aggregate`, one module each,
  framework-agnostic and unit-testable.
- Type the OpenRouter request and response shapes; read the `usage` field for real token counts.
- Small, testable prompt-building functions; unit-test the judge-output parser against malformed
  input.

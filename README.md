# The Tribunal

A charge sheet goes in. Four advocates — two for, two against, cast by you — each make
one statement. Three judges, modelled on real Israeli Supreme Court presidents, each
return a verdict and their reasoning. The app shows the majority verdict with a real
token and price breakdown, and exports the run as a self-contained HTML file.

Seven free OpenRouter model calls per run. No database: **the exported HTML file is the
run record.**

- `specs.md` — what to build, in five prose parts. The source of truth.
- `spec_logs.md` — every decision that shaped it, and why.
- `CLAUDE.md` — how to build, for the agent.
- `data/` — the five characters, their relations, and the three judges. The only source
  of character facts.

## Running it locally

```
npm install
npm run dev
```

Express on `http://localhost:3001`, Vite on `http://localhost:5173` proxying `/api` to
it. `http://localhost:5173/api/health` should report five character names and three
judge names read from `data/`.

```
npm test           # Vitest, server-side
npm run models:check  # are the pinned free models still live?
npm run record:demo   # print a finished run record and write a sample export, no calls spent
npm run build   # web → web/dist, server → server/dist
npm start       # one process serving both, http://localhost:3001
```

## Configuration

| Variable | Needed for | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | model calls only | Everything else — health, the data files, the pre-flight — runs without it. |
| `PORT` | no | Defaults to 3001. The host sets this in production. |
| `TRIBUNAL_MODEL_*` | no | Swaps a delisted model identifier without a code change. `npm run models:check` says which one died and what is free to replace it. |

Put them in a `.env` file at the repo root for local development. It is gitignored; the
key never belongs in the repo.

**Only free models can ever be called.** The identifiers live in `server/src/config.ts`,
the browser never receives an editable one and never sends one, and the OpenRouter
client refuses anything not on the allowlist and not ending in `:free` before the
request leaves the server. A `TRIBUNAL_MODEL_*` override naming a paid model is a
startup failure. There is no setting that permits one.

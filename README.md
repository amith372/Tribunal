# The Tribunal

A charge sheet goes in. Four advocates — two for, two against, cast by you — each make
one statement. Three judges, modelled on real Israeli Supreme Court presidents, each
return a verdict and their reasoning. The app shows the majority verdict with a real
token and price breakdown, and exports the run as a self-contained HTML file.

Seven free OpenRouter model calls per run. The server archives every finished run; **the
exported HTML file is the portable copy**, rebuildable from the archive as well as from a
run still in flight.

- `specs.md` — what to build, in five prose parts. The source of truth.
- `CLAUDE.md` — how to build, for the agent.
- `data/` — the five characters, their relations, and the three judges. The only source
  of character facts.

## Running it locally

```
npm install
npm run hooks     # one-off per clone: enables the pre-commit gate in .githooks/
npm run dev
```

Express on `http://localhost:3001`, Vite on `http://localhost:5173` proxying `/api` to
it. `http://localhost:5173/api/health` should report five character names and three
judge names read from `data/`.

```
npm test              # Vitest, server-side
npm run lint          # ESLint, type-aware, whole repo
npm run typecheck     # tsc across all four tsconfigs
npm run rehearse      # a whole run streamed with the model call faked — costs no requests
npm run models:check  # are the pinned free models still live?
npm run record:demo   # print a finished run record and write a sample export, no calls spent
npm run build   # web → web/dist, server → server/dist
npm start       # one process serving both, http://localhost:3001
```

### The commit gate

`.githooks/pre-commit` runs on every commit and refuses one that would leak a credential
(an API key or a Mongo connection string), write a model identifier into `web/src`, or
fail typecheck, lint or tests. It takes about
thirteen seconds. It lives in the repo rather than in `.git/hooks` so it can be read and
reviewed like anything else — but git does not enable a hooks directory on clone, so
`npm run hooks` is a one-off step per checkout.

A run costs seven OpenRouter requests out of a free daily allowance of roughly fifty.
`npm run rehearse` streams a complete run with the model call replaced by a timed fake, so
the interface can be built and watched for nothing; `-- fail` fails one advocate, `-- hung`
splits the bench, `-- fast` runs at four times the speed.

## Configuration

| Variable | Needed for | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | model calls only | Everything else — health, the data files, the pre-flight — runs without it. |
| `PORT` | no | Defaults to 3001. The host sets this in production. |
| `TRIBUNAL_MODEL_*` | no | Swaps a delisted model identifier without a code change. `npm run models:check` says which one died and what is free to replace it. |
| `MONGODB_URI`, `MONGODB_DB` | archiving only | Unset means no archive: runs still work, they just are not saved anywhere past the buffer's own few-minute hold. |

Put them in a `.env` file at the repo root for local development. It is gitignored; the
key never belongs in the repo.

**Only free models can ever be called.** The identifiers live in `server/src/config.ts`,
the browser never receives an editable one and never sends one, and the OpenRouter
client refuses anything not on the allowlist and not ending in `:free` before the
request leaves the server. A `TRIBUNAL_MODEL_*` override naming a paid model is a
startup failure. There is no setting that permits one.

# The Tribunal

A charge sheet goes in. Four advocates — two for, two against, cast by you from the five
characters, the accused included — each make one statement. Three judges, modelled on the
reasoning of real Israeli Supreme Court justices, each return a verdict and their
reasoning. The app shows the majority verdict with a real token and price breakdown, and
exports the run as a self-contained HTML file.

Seven free OpenRouter model calls per run. The server archives every finished run; **the
exported HTML file is the portable copy**, rebuildable from the archive as well as from a
run still in flight.

- `specs.md` — what to build, in five prose parts. The source of truth.
- `CLAUDE.md` — how to build, for the agent.
- `data/` — the five characters, their relations, and the three judges. The only source
  of character facts. The descriptions are voice and values only: no places, houses,
  titles or events, because a name is a fact and these files are not a fact source.

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
npm test              # Vitest in both workspaces, server then web
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

## Deployment

Live at **https://tribunal-sflw.onrender.com** — a single Render free Web Service running one
Express process that serves both the API and the built front end.

| Setting | Value |
|---|---|
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instance type | Free |

`--include=dev` is not optional. Render sets `NODE_ENV=production`, and vite and `tsc` are
devDependencies — a plain `npm ci` omits them and the build fails at the first compile.

Three environment variables live on the host and nowhere else: `OPENROUTER_API_KEY`,
`MONGODB_URI` and `MONGODB_DB`. `APP_URL` is optional and worth setting to the live URL, since
it is the `HTTP-Referer` OpenRouter attributes the calls to; left unset it reports `localhost`.
**Unset Mongo variables are not an error** — the app degrades to no archive and says so in its
startup log — which means a deploy can look healthy while silently archiving nothing. The log
line is the thing to check.

Two pieces of setup are easy to miss because neither lives in this repo. **Atlas must allow
`0.0.0.0/0`** in Network Access: Render's free tier has no static outbound IP, so there is no
narrower rule to write, and the connection string's own credentials are what actually guard the
database. And **Render's GitHub app needs access to this repository specifically** — a private
repo is not visible to it by default.

### Keeping it awake

A free instance sleeps after **15 minutes** of inactivity and takes about a minute to wake, so a
first-time visitor clicking a cold link waits through it. An external pinger on `/api/health`
prevents that. The endpoint needs no API key by design, precisely so a pinger can use it.

The interval must be under 15 minutes — 10 works, 45 does not, because a ping arriving at an
already-sleeping instance keeps nothing warm and only pays the cold start again. The window is
bounded rather than round-the-clock: Render's free allowance is 750 instance-hours a month and a
31-day month is 744, so pinging continuously consumes essentially all of it.

```
*/10 7-21 * * *     Asia/Jerusalem
```

Ninety pings a day from 07:00 to 21:50, leaving the service awake until roughly 22:05 — about
468 instance-hours a month, 62% of the allowance, with room to spare for a second free service.
**Set the schedule's timezone explicitly.** In UTC those same hours land at 10:00–00:50 local,
which is three hours wrong and looks exactly like working.

Expect the first execution of each day to be recorded as a failure. That ping lands on a
sleeping instance and the wake takes longer than the pinger's request timeout — the wake still
succeeds, and the next ping ten minutes later is served warm. It is worth turning notifications
off for that job rather than reading the same false alarm every morning.

### There is no `render.yaml`

The plan called for one and it was dropped deliberately. A `render.yaml` in the repo does nothing
to a service that already exists — Render reads it only when creating a Blueprint — so it would
document the deploy without defining it, and converting a running service to a Blueprint can
produce a *new* service on a *new* URL. With a pinger and a shared link already pointing at the
current one, that is a real risk bought for no benefit. This section is the record instead: it
carries the same facts, and it is the one a person reads.

**Only free models can ever be called.** The identifiers live in `server/src/config.ts`,
the browser never receives an editable one and never sends one, and the OpenRouter
client refuses anything not on the allowlist and not ending in `:free` before the
request leaves the server. A `TRIBUNAL_MODEL_*` override naming a paid model is a
startup failure. There is no setting that permits one.

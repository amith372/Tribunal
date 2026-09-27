# ⚖️ The Tribunal

A charge sheet goes in. **Four advocates** — two for, two against, cast by you from the five
characters, the accused included — each make one statement. **Three judges**, modelled on the
reasoning of real Israeli Supreme Court justices, each return a verdict and their reasoning.
The app shows the majority verdict with a real token and price breakdown, and exports the
whole run as a single self-contained HTML file.

**Seven free OpenRouter calls per run.** Every finished run is archived server-side; the
exported HTML file is the portable copy, and it can be rebuilt from the archive as well as
from a run still in flight.

🔗 **Live:** https://tribunal-sflw.onrender.com

## 📚 What's in here

| Path | What it is |
|---|---|
| `specs.md` | **What** to build — five prose parts. The source of truth. |
| `CLAUDE.md` | **How** to build, for the agent. |
| `data/` | The five characters, their ten relations, the three judges. The only source of character facts — voice and values only, no places, houses, titles or events, because a name is a fact. |
| `server/` | Express + TypeScript. The pipeline: `setup → statements → judging → aggregate`. |
| `web/` | React + Vite, one page, driven by SSE. |

## 🚀 Run it locally

```bash
npm install
npm run hooks     # one-off per clone: enables the pre-commit gate
npm run dev
```

Express on `http://localhost:3001`, Vite on `http://localhost:5173` proxying `/api` to it.
Open `http://localhost:5173/api/health` — it should report five character names and three
judge names, read from `data/`.

## 🧰 The scripts

| Command | What it does |
|---|---|
| `npm test` | Vitest in both workspaces, server then web |
| `npm run lint` | ESLint, type-aware, whole repo |
| `npm run typecheck` | `tsc` across all four tsconfigs |
| `npm run rehearse` | 🎭 a whole run streamed with the model call faked — **costs no requests** |
| `npm run models:check` | 🔍 which free models arrived, which this app refuses to seat, and how the rest were dealt between bench and advocates |
| `npm run record:demo` | prints a finished run record and writes a sample export, no calls spent |
| `npm run build` | web → `web/dist`, server → `server/dist` |
| `npm start` | one process serving both, on `http://localhost:3001` |

A real run costs **seven** OpenRouter requests out of a free daily allowance of roughly
fifty — so build against `rehearse`, which replaces the model call with a timed fake.
Add `-- fail` to fail one advocate, `-- hung` to split the bench, `-- fast` for 4× speed.

## 🔒 The commit gate

`.githooks/pre-commit` refuses any commit that would:

- 🔑 leak a credential (an API key or a Mongo connection string),
- 🏷️ write a model identifier into `web/src`,
- ❌ fail typecheck, lint or tests.

About thirteen seconds. It lives in the repo rather than in `.git/hooks` so it can be read and
reviewed like anything else — but git does not enable a hooks directory on clone, so
`npm run hooks` is a one-off step per checkout.

## 🤖 Models

**Only free models can ever be called.** Nothing about that is configurable:

- 🌐 The roster is **discovered from OpenRouter at startup**, never hand-maintained — so a
  delisted model drops out on its own and there is no list in the repo to rot.
- ✅ Eligibility is decided server-side *after* discovery: the `:free` rule re-applied to the
  identifier, this app's own recorded exclusions, and fitness **for the role** — a model that
  writes well is not assumed able to rule.
- 🚫 The browser never receives an editable identifier and never sends one. The OpenRouter
  client refuses anything off the allowlist before the request leaves the server, and it
  checks the model that *answered* too, since the fallback router picks its own.
- 🛑 There is **no env var, flag or request field** that permits a paid model. Discovery
  failure falls back to the last cached roster; with no cache the run is refused rather than
  seated on unvetted models.

`npm run models:check` prints that whole decision as it stands today.

## ⚙️ Configuration

| Variable | Needed for | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | model calls only | Everything else — health, the data files, the pre-flight — runs without it. |
| `MONGODB_URI`, `MONGODB_DB` | archiving only | Unset means no archive: runs still work, they just are not saved past the buffer's own few-minute hold. |
| `PORT` | no | Defaults to 3001. The host sets this in production. |
| `APP_URL` | no | The `HTTP-Referer` OpenRouter attributes calls to. Left unset, it reports `localhost`. |

Put them in a `.env` file at the repo root for local development. It is gitignored — the key
never belongs in the repo.

## ☁️ Deployment

One Render **free** Web Service running a single Express process that serves both the API and
the built front end.

| Setting | Value |
|---|---|
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instance type | Free |

⚠️ **`--include=dev` is not optional.** Render sets `NODE_ENV=production`, and vite and `tsc`
are devDependencies — a plain `npm ci` omits them and the build fails at the first compile.

Three environment variables live on the host and nowhere else: `OPENROUTER_API_KEY`,
`MONGODB_URI` and `MONGODB_DB`.

Two more pieces of setup are easy to miss, because neither lives in this repo:

- 🌍 **Atlas must allow `0.0.0.0/0`** in Network Access. Render's free tier has no static
  outbound IP, so there is no narrower rule to write; the connection string's own credentials
  are what actually guard the database.
- 🔐 **Render's GitHub app needs access to this repository specifically** — a private repo is
  not visible to it by default.

👀 **Unset Mongo variables are not an error.** The app degrades to no archive and says so in
its startup log — which means a deploy can look perfectly healthy while archiving nothing.
That log line is the thing to check.

### ⏰ Keeping it awake

A free instance sleeps after **15 minutes** of inactivity and takes about a minute to wake, so
a first-time visitor clicking a cold link waits through it. An external pinger on
`/api/health` prevents that — the endpoint needs no API key by design, precisely so a pinger
can use it.

```
*/10 7-21 * * *     Asia/Jerusalem
```

- The interval must be **under** 15 minutes. 10 works; 45 does not, because a ping arriving at
  an already-sleeping instance keeps nothing warm and only pays the cold start again.
- The window is bounded rather than round-the-clock. Render's free allowance is 750
  instance-hours a month and a 31-day month is 744, so pinging continuously consumes
  essentially all of it. Ninety pings a day from 07:00 to 21:50 leaves the service awake until
  roughly 22:05 — about 468 instance-hours, 62% of the allowance, with room to spare for a
  second free service.
- 🕒 **Set the schedule's timezone explicitly.** In UTC those same hours land at 10:00–00:50
  local, which is three hours wrong and looks exactly like working.
- 📭 Expect the first execution of each day to be recorded as a **failure**. That ping lands on
  a sleeping instance and the wake takes longer than the pinger's request timeout — the wake
  still succeeds, and the next ping ten minutes later is served warm. Turn notifications off
  for that job rather than reading the same false alarm every morning.

### 🗂️ There is no `render.yaml`

The plan called for one and it was dropped deliberately. A `render.yaml` in the repo does
nothing to a service that already exists — Render reads it only when creating a Blueprint — so
it would document the deploy without defining it, and converting a running service to a
Blueprint can produce a **new** service on a **new** URL. With a pinger and a shared link
already pointing at the current one, that is a real risk bought for no benefit. This section is
the record instead: it carries the same facts, and it is the one a person actually reads.

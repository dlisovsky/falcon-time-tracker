# Time Tracker

A small web app for tracking employees' working time: add employees, start and stop a timer with a task description, and see each employee's records and total time for any period. Data is stored in SQLite, so it survives restarts, including a timer that is still running.

> All names and tasks in the app and tests are fictional.

**Live demo:** _see the link in the repository description_ (free tier: the first request after a period of inactivity can take ~30–50 s while the instance wakes up)

## Features

- **Employees:** add an employee by name (validated, trimmed, max 100 chars).
- **Timer:** start with a required task description and stop with one click. Each employee can have at most one running timer, enforced both in code and by a partial unique index in the database. Different employees' timers are independent.
- **Report:** pick a date range (or Today / This week / This month) and either all employees or one. You get every record plus a total per employee and an overall total. A record that crosses the period boundary (for example an overnight task) counts only the time inside the period. A running timer counts up to "now".
- **Persistence:** SQLite file (`data/timetracker.db` by default). Restarting the server keeps all data, and a timer started before the restart can be stopped after it.
- **Empty states:** an empty database or a period with no records shows a clear "No time recorded" message and zero totals.

## Run it

Requirements: Node.js 22 or newer.

```bash
npm install
npm run seed      # optional: fictional demo employees + a week of records
npm start         # http://localhost:3000
```

Other commands:

```bash
npm test          # all tests (node:test, no extra test dependencies)
npm run dev       # restart on file changes
```

Environment variables:

| Variable    | Default               | Meaning                                              |
|-------------|-----------------------|------------------------------------------------------|
| `PORT`      | `3000`                | HTTP port                                            |
| `DB_PATH`   | `data/timetracker.db` | SQLite file location                                 |
| `SEED_DEMO` | unset                 | `true` adds fictional data on start if the DB is empty |

### Docker

```bash
docker build -t time-tracker .
docker run -p 3000:3000 -v tt-data:/app/data time-tracker
```

The named volume keeps the database between container restarts.

### Deploy (free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/dlisovsky/falcon-time-tracker)

`render.yaml` is a Render Blueprint: click the button above, or on render.com choose **New → Blueprint** and select this repo. Render's free tier has an ephemeral disk, so the hosted demo resets to the seeded fictional data when the instance restarts. Locally, and in Docker with a volume, data persists.

## Stack and structure

Node.js + Express 5 + better-sqlite3 on the backend, and plain HTML/CSS/JS (ES modules, no build step) on the frontend. I picked a deliberately small stack: one runtime dependency for HTTP, one for storage, and zero for tests.

```
src/
  db.js        schema + connection (WAL, foreign keys, one-running-timer index)
  service.js   business logic: employees, timers, reports (clock is injectable)
  app.js       Express routes, input parsing, JSON error handling
  seed.js      fictional demo data
  server.js    entry point, graceful shutdown
public/
  index.html, styles.css, app.js   UI
  format.js    pure helpers (durations, local date ranges), unit-tested
test/
  service.test.js  business rules, timer restart, empty reports, restart persistence
  api.test.js      HTTP end-to-end through a real server on a random port
  format.test.js   date/duration helpers
```

Design decisions:
- **Timestamps** are stored as UTC epoch milliseconds. The browser turns the chosen local dates into a half-open UTC range `[from, to)`, so time zones and DST are handled where the user's time zone is known.
- **The service takes a `clock` function**, so tests control time exactly instead of sleeping.
- **Errors** are typed (`400/404/409`) and returned as `{ error: { code, message } }`. The UI shows the message in a toast.
- **Start and stop run in transactions**, and the database also blocks a second running timer, so a double click can't create two of them.

### API

| Method | Path | Body / query |
|---|---|---|
| GET  | `/api/employees` | list, with each employee's running entry |
| POST | `/api/employees` | `{ "name": "..." }` |
| POST | `/api/employees/:id/timer/start` | `{ "description": "..." }` → 409 if already running |
| POST | `/api/employees/:id/timer/stop` | → 409 if nothing is running |
| GET  | `/api/report` | `?from=ISO&to=ISO[&employeeId=N]` |
| GET  | `/api/health` | health check |

## Tests

`npm test` runs 23 tests, including:

- **Main scenario:** add an employee → start → stop → report, through the service and through HTTP.
- **Restarting the timer:** start → stop → start again creates a separate second record. The break between them isn't counted, and a second start while one is running is rejected (409).
- **Empty report:** an empty database gives an empty list, a period without records gives zero totals and no entries, and the same holds over HTTP.
- **Restarting the application:** the database is closed and reopened from the same file. Employees, records and the running timer are still there, and the timer can be stopped afterwards.
- **Edge cases:** an entry crossing midnight is split correctly between days, a running timer is counted up to now, plus validation (empty or too-long input, unknown employee, invalid or reversed period, malformed JSON).

CI (GitHub Actions) runs the suite on Node 22 and 24.

## How AI was used

**Tool:** [Claude Code](https://claude.com/claude-code) (desktop app) running **Claude Opus 5.5** (`claude-opus-5-5`), an agentic coding model that writes files, runs commands and drives a browser. I used it for planning, code, tests, Docker/CI config and this README, and reviewed and checked the output as described below.

**Why this model:** one agent can write the code, run the tests, start the app and click through the UI in a real browser. That made it possible to verify each change instead of trusting the generated code.

### Example prompts

The initial prompt (the assignment text, plus):

> go ahead build that with best practices and gimme demo url, would be nice to host and run working demo somewhere (any free places)

From that one prompt the agent planned and carried out the steps itself. Here are the key steps written as standalone prompts, which also work if you want to reproduce or extend the work with any coding model:

> Store time as UTC epoch ms and report on a half-open [from, to) range; clip entries that cross the boundary so an overnight task is split between days. Add a test for it.

> Enforce "one running timer per employee" in the database, not only in code — a double click must not create two running entries.

> Write tests for: restarting the timer (start→stop→start), an empty report, and data surviving an app restart (close and reopen the same DB file).

> The Docker build fails in node:24-slim with a node-gyp/Python error — find out why and fix it without adding a compiler toolchain to the image.

> Open the app in the browser at phone width and check there is no horizontal scroll and the forms are usable.

### Errors found and fixed

These were caught by running the tests, the app or the Docker build, not just by reading the code:

1. **The test script didn't run at all.** The generated `"test": "node --test test/"` fails on Node 22+ with `Cannot find module '.../test'`, because a directory argument is treated as a file. The fix uses a glob: `node --test "test/**/*.test.js"`.
2. **The Docker build failed** with `gyp ERR! find Python` in `node:24-slim`. npm ran a default `node-gyp rebuild` for better-sqlite3 because the package ships a `binding.gyp`, even though v13 already bundles prebuilt binaries for linux x64/arm64 (glibc and musl). The fix is `npm ci --ignore-scripts` in Docker, CI and Render, which also avoids running third-party install scripts. A heavier fix (installing python/make/g++ into the image) wasn't needed.
3. **Inconsistent timestamps on start.** `startTimer` called `clock()` twice, once for `started_at` and again for the returned duration, so the response could disagree with the stored row. It now reads the clock once.
4. **The report row for a running timer stayed frozen.** In manual testing in the browser, the running row and totals only updated when something else triggered a reload. While any timer runs, the report now refreshes every 30 s. The per-employee counter already ticks every second.
5. **A suspected wrong total that turned out to be correct.** A screenshot showed the overall total not matching the per-employee sum. Comparing against the API (`totalMs === sum(employee.totalMs)`) and the DOM showed the screenshot was stale, not the data. I'm keeping this one because checking against the source of truth before "fixing" is part of the process.

Pitfalls covered from the start, each with a test:
- **Filtering only by start time** would lose tasks that cross a boundary. The report uses an overlap query plus clipping.
- **`Date.prototype.toISOString()` for date inputs** gives the UTC date, which is off by one near midnight in non-UTC zones. A local-date helper (`toDateInput`) is used instead.
- **XSS:** task descriptions are escaped before being inserted into the report HTML. I checked this in the browser with `<b>xss</b>` as a description.
- **Clock skew:** `stopTimer` never produces a negative duration.

### What I would improve next

Editing and deleting entries (for a forgotten "stop"), CSV export, pagination for long periods, a managed database (e.g. Turso or Postgres) so the hosted demo keeps data, and Playwright UI tests.

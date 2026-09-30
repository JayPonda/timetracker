# Personal Day Manager (PDM)

A single-user, Docker-run day manager for one office worker. It combines a Clockify-style
time tracker, a task and project manager with a mandatory acceptance-criteria closure gate,
a calendar with daily events, hourly and custom reminders, a searchable knowledge library,
reports, and an MCP server so an AI assistant can search and create planning items.

Everything runs on your own laptop. Nothing is sent anywhere. There is no account, no cloud
service, and no external request of any kind.

> **Status: planning complete, implementation not started.**
> The plan for all twelve releases from 0.1.0 to 1.0.0 is written and approved in
> [`docs/ROADMAP.md`](docs/ROADMAP.md). No application code exists yet. Start with
> [`docs/PLAN.md`](docs/PLAN.md).

---

## What it will do

| Area | What you get |
| --- | --- |
| **Time tracking** | Start a timer on a task with one click, optionally against a todo and with tags. One timer at a time. It survives a refresh, a closed browser and a container restart. Entries can be added by hand, edited, and archived but never deleted. Totals per task, todo, tag, project, day and phase. |
| **Projects and tasks** | Projects hold many tasks. Each task carries a description, up to three links, a score, an estimate, planned start and due dates, todos, acceptance criteria and reference materials. |
| **Quality gate** | A task cannot be ended without an acceptance-criteria review. If any criterion is not met, a written reason for the lag is mandatory. Every closure is stored as a record and is never overwritten. |
| **Calendar and events** | Month, week and day views with events, reminders, due dates and time entries as blocks. Quick-create by clicking an empty slot. |
| **Reminders** | "Remind me at" reminders with repeat rules, plus an hourly pulse during working hours that shows what is running — or warns that nothing is. |
| **Knowledge** | Reference materials on a task — notes, links, snippets, lessons learned, decisions — kept after the task ends, plus a global search across everything in under a second. |
| **Day log and reports** | Pick any date and see what you worked on, with a copy-for-timesheet text. Reports by project, task, tag or phase, with estimate versus actual. |
| **AI assistant** | An MCP server that lets an assistant search and read everything, and create projects, tasks, tags, events, reminders and reference notes. It cannot start a timer, edit, close, archive or delete anything — and that limit is enforced by the app, not by the assistant. |

**Nothing is ever deleted.** There is no delete button anywhere. Removing something means
archiving it, and archiving is reversible in one click. The database itself refuses hard
deletes, so a bug cannot erase your work.

## Requirements

- Docker Desktop or Docker Engine installed
- A modern desktop browser: the latest two versions of Chrome, Edge or Firefox
- About 500 MB of disk for the image, plus your data
- No internet connection needed for normal use

## How it will run

```bash
cp .env.example .env      # optional; every value has a working default
docker compose up -d      # start (migrates first, then serves)
docker compose logs -f pdm
docker compose down       # stop, keeping data
docker compose down -v    # remove, including the data
```

Then open `http://127.0.0.1:8080`.

## Operations

Every command is run from the repository root, with Docker Desktop running.

### Install

1. Install Docker Desktop or Docker Engine.
2. **Start Docker at login.** The container has `restart: unless-stopped`, so it
   comes back after a reboot — but only if Docker itself is running. On macOS:
   *Settings → General → Start Docker Desktop at login*.
3. Clone the repository and start it:

   ```bash
   docker compose up -d
   ```

   The first run builds the image, applies every migration, and seeds the
   settings. It takes a couple of minutes. Nothing is installed on the host
   except Docker: no Node, no database, no runtime.

There is **no `chown` step and no directory to create.** The data lives in
Docker-managed volumes, so it works the same for every user on the first run.

### Start

```bash
docker compose up -d          # start
docker compose up -d --wait   # start and block until healthy
```

Check it is up:

```bash
docker compose ps             # pdm: running (healthy)
curl -fsS http://127.0.0.1:8080/health
```

### Stop

```bash
docker compose down           # stop, keep the data
```

### Restart

```bash
docker compose restart pdm          # restart the app
docker compose restart              # restart everything, including the migrator
```

`docker compose restart pdm` deliberately does **not** re-run migrations. It
restarts only the application. Use `docker compose up -d` after a rebuild when
the schema has changed.

### Logs

```bash
docker compose logs -f pdm          # follow the app
docker compose logs pdm-migrate     # what the migration run did
docker compose logs --tail=100 pdm  # last 100 lines
```

`pdm-migrate` is a one-shot job container, so its logs end with the migrations
it applied and then stop. Seeing it `exited (0)` is the healthy state.

Every line has the same shape, whatever produced it — the API, a CLI command or
the browser:

```text
[2026-09-29T08:26:23.571Z] [INFO] (migrate.ts) (migrate) migration applied migration=0001_settings
[2026-09-29T08:25:37.610Z] [INFO] (index.ts) (boot) listening host=0.0.0.0 port=8080
```

That is `[datetime] [level] (file) (function) message key=value key1=value1`, so a
line can be found by level, by file, or by any value in it:

```bash
docker compose logs pdm | grep '\[ERROR\]'
docker compose logs pdm | grep 'task_id=42'
```

One variable controls how much is printed: `LOG_LEVEL` in `.env`, one of
`trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent`. It defaults to
`info`, and it applies to both containers. The **good path is logged, not just
failures** — a timer started, a backup written, a migration applied — because a
log that records only problems cannot answer "what was this process doing at
14:03". Set `LOG_LEVEL=debug` while diagnosing, `trace` to see every branch.

### Backup

Automatic daily backups arrive in 0.9.0. Take one now with:

```bash
docker compose exec pdm node api/cli/backup.js
```

It writes to the backups volume and prints the path. The output is a consistent
snapshot taken with SQLite's `VACUUM INTO` — never a plain file copy, which
under WAL would capture a torn database.

Every migration also takes a backup of the pre-migration database first, and
restores it automatically if that migration fails.

### Restore

```bash
docker compose ls                       # find the backup file name
docker compose down                     # the app must be stopped first
docker compose run --rm --no-deps -T pdm node api/cli/restore.js /backups/<file>.db
docker compose up -d --wait
```

The app **must be stopped** before restoring. Overwriting a database that is
open and being written to is how a database gets corrupted, so the sequence
above stops the app, restores in a one-off container that mounts the same
volumes, and only then starts the app again.

`docker compose run` is used rather than `exec` because `exec` needs a running
container, and the whole point is that nothing should be running.

Verified: a database with 8 settings rows was restored to 7, the extra row gone,
and the app came back healthy.

List the available backups with:

```bash
docker compose run --rm --no-deps -T pdm ls -1 /backups
```

### Upgrade

```bash
git pull
docker compose build        # required: migrations are baked into the image
docker compose up -d --wait # the migrator applies anything new, then the app starts
```

The `build` step is not optional. A migration is a file inside the image, so
without a rebuild the migrator reports "up to date" and starts the app on the
old schema.

If a migration fails, it is rolled back, the pre-migration backup is restored,
the migrator exits non-zero naming that backup, and **the app is never started.**

### Remove

```bash
docker compose down -v    # stop and delete the containers and the data volumes
```

This destroys the database. Take a backup first if you want to keep it.

### Reaching the database

The database is a plain SQLite file. To open it with any SQLite client, copy it
out first — do not point a client at the live file while the app is running:

```bash
docker compose cp pdm:/data/pdm.db ./pdm.db
sqlite3 ./pdm.db 'select count(*) from settings;'
```

### Where the data lives

```bash
docker volume ls | grep pdm       # pdm_pdm-data, pdm_pdm-backups
```

Host bind mounts were tried first and abandoned: they failed intermittently on
the development machine (1 of 5 runs from the repository folder, 2 of 5 from a
local path, against 6 of 6 for a named volume — same image, same command). The
symptom was `SQLITE_CANTOPEN`, and once the running app was caught holding
`/data/pdm.db (deleted)`, which is a live database that disappears on restart. A
named volume removes that failure class instead of documenting around it. The
reasoning is recorded in `docker-compose.yml` itself.

## How it is built

React and TypeScript on the front end, Node.js and TypeScript on the back, SQLite for
storage, one application container plus a data volume, started by one
`docker compose up -d`. Roughly ten runtime dependencies in total. The decisions and the
rejected alternatives are in [`docs/adr/`](docs/adr/).

## The plan

| Release | What you get |
| --- | --- |
| 0.1.0 | Runs in Docker, survives restarts, reports health, migrates its own schema |
| 0.2.0 | The full data model; projects, tasks and tags; nothing can be deleted |
| 0.3.0 | The timer, time entries, tags on entries, task totals, phase timeline |
| 0.4.0 | Today page, Day log for any date, copy-for-timesheet text |
| 0.5.0 | The closure gate: no task ends without an acceptance-criteria review |
| 0.6.0 | Calendar and events |
| 0.7.0 | Custom reminders, the hourly reminder, browser notifications |
| 0.8.0 | Reference materials and global search |
| 0.9.0 | Reports, export and import, backups, operations |
| 0.10.0 | MCP server, read-only |
| 0.11.0 | MCP server, create tools, audit page, safety rules |
| 1.0.0 | General availability: every requirement verified, documented and tested |

Each release has its own specification with scope, requirements, acceptance criteria and an
exit test you run before the next one starts.

## Documentation

| Start here | |
| --- | --- |
| [`docs/PLAN.md`](docs/PLAN.md) | **Read this first.** Current release, rules, what to do next |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Strategy, all twelve releases, traceability, risks |
| [`docs/INDEX.md`](docs/INDEX.md) | Reading order for everything else |
| [`requirnment.md`](requirnment.md) | The requirements specification this was planned from |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every judgement call, recorded once |
| [`docs/DEFERRED.md`](docs/DEFERRED.md) | What is deliberately not in 1.0.0, and why |
| [`docs/TESTING.md`](docs/TESTING.md) | How it is tested and what must be tested |
| [`docs/PERF.md`](docs/PERF.md) | Performance budgets and measured results |
| [`docs/RELEASES/`](docs/RELEASES/) | One specification per release |
| [`docs/adr/`](docs/adr/) | Architecture decision records |

## Repository layout

```
requirnment.md          The SRS this project is built from
docs/                   Plan, release specs, ADRs, decisions, testing, performance
apps/api/               REST API, migrations, scheduler            (0.1.0)
apps/web/               Frontend                                 (0.1.0)
apps/mcp/               MCP server                               (0.10.0)
packages/shared/        Types and schemas shared across apps      (0.1.0)
data/                   Your database, on your disk               (git-ignored)
backups/                Automatic and manual backups              (git-ignored)
```

## Privacy

- All data is in one SQLite file in `./data` on your laptop.
- The app makes no outgoing network requests, and uses no analytics, no external fonts, no
  CDN and no third-party service.
- It listens on `127.0.0.1` only, so nothing on your network can reach it.
- The MCP server talks to the app on your machine and to nothing else. Its token is stored
  hashed.
- The only data you could lose is a hardware failure, which is what the daily backups and
  the export are for.

## Licence

Private, personal use.

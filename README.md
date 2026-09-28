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
docker compose up -d      # start
docker compose logs -f pdm
docker compose down       # stop, keeping data
docker compose down -v && rm -rf ./data   # remove, including data
```

Then open `http://127.0.0.1:8080`.

The full operations guide — start, stop, restart, logs, backup, restore, upgrade, removal,
and configuring an MCP client — is written in 0.1.0 and 0.9.0. The release plan for those
is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

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

# Testing

How this project is tested, what must be tested, and how to run it. Requirement IDs are the
vocabulary: a test that protects `FR-GATE-05` says so in its name.

## 1. Principles

1. **Business rules are tested at the service, not through the HTTP surface.** The route is
   plumbing; the rule lives in the service.
2. **Every non-negotiable rule in §3 has a test before 1.0.0.** That list is the real
   quality bar, not a coverage percentage.
3. **A test names the requirement it protects.** If it cannot, the requirement is probably
   not implemented, or not understood.
4. **The clock is injectable.** `nowMs()` is the only clock, so timer, reminder and
   day-boundary tests are deterministic and never sleep.
5. **No test touches the owner's real database.** Every test gets its own temporary file or
   in-memory database.
6. **The owner's exit test is part of the suite.** A release is not done until it passes.

## 2. Layers

| Layer | What it covers | Tool | Runs on |
| --- | --- | --- | --- |
| **Service unit** | Timer, totals, closure gate, reminders, archive rules, import merge, capability checks | Vitest, temp-file SQLite per test file | every commit |
| **API contract** | Every route: status code, validation, error shape, capability denial, capability declaration | Vitest with `app.inject()`, no network | every commit |
| **Schema integrity** | The no-delete triggers, the max-3-links trigger, the single-open-entry index, enum constraints, foreign keys | Vitest, raw SQL against a real file | every commit |
| **Integration** | SSE stream, migration runner including the failure path, backup and restore | Vitest with a real port and a real file | every commit, from 0.7.0 and 0.9.0 |
| **End to end** | Critical paths of the 29 user stories | Playwright | 1.0.0, then on the previous release's exit test |
| **Manual** | The owner exit test script | Written per release | every release, before the next starts |
| **Performance** | The `NFR-PERF-01`…`03` budgets on the `seed:perf` fixture | A script that writes results to `PERF.md` | before 0.9.0 and at 1.0.0 |

Coverage target: **at least 95% on business-rule modules** (`NFR-MAINT-01`), which are
`apps/api/src/services/**` and `packages/shared`. The floor was 80% until 2026-09-29, when
the owner raised it; raising it immediately found `dateKeyRange` in
`packages/shared/src/time.ts` with no test at all, which is the strongest argument for the
higher number.

The floor lives in `vitest.config.ts` as a `thresholds` block, so `pnpm test:coverage` fails
below it and the CI `gates` job runs that command as its own step. It is not a number anyone
has to read in a report and remember to check. The threshold was verified to fail by raising
it to 100% and watching the command exit 1, which is the only way to know a gate is a gate.

Overall coverage is reported but not gated, because a gated global number produces tests that
exist to be counted. `repositories/**` and `middleware/**` are in the report for the same
reason: visible when they collapse, not able to fail a build on their own.

## 3. The non-negotiable test list

These twenty must exist and pass before 1.0.0. Each is one of the promises the product
makes that would be expensive to break later.

| # | Test | Protects | First written in |
| --- | --- | --- | --- |
| 1 | Starting a second timer saves the first; two can never be open | `BR-01`, `FR-TIME-04`, `DATA-02` | 0.3.0 |
| 2 | A running timer survives reload, browser close and container restart | `FR-TIME-06`, `FR-TIME-10`, `NFR-REL-02` | 0.3.0 |
| 3 | An entry with `ended_at < started_at` is rejected | `FR-TIME-16` | 0.3.0 |
| 4 | Overlapping entries warn but are allowed | `FR-TIME-16` | 0.3.0 |
| 5 | Totals recalculate on edit and archive; archived entries excluded and the excluded amount shown | `FR-TIME-15`, `DATA-12` | 0.3.0 |
| 6 | A fourth task link is refused by the API **and** by the database | `DATA-01`, `BR-04` | 0.2.0 |
| 7 | No user-data table accepts a hard delete — all 13 enumerated | `DATA-10` | 0.2.0 |
| 8 | No API route exposes a delete of user data | `DATA-09` | 0.2.0 |
| 9 | Ending a task by any route without a valid closure payload is impossible | `FR-STAT-01`, `FR-GATE-08` | 0.5.0 |
| 10 | An unmet criterion without a lagging reason cannot be confirmed, in the UI and the API | `FR-GATE-05`, `BR-03` | 0.5.0 |
| 11 | Closure records are append-only across reopen cycles | `FR-GATE-09`, `BR-10` | 0.5.0 |
| 12 | A reminder occurrence is never delivered twice, across restart and two tabs | `FR-REM-10` | 0.7.0 |
| 13 | Reminders missed while closed appear as Missed with the original time | `FR-REM-09` | 0.7.0 |
| 14 | The hourly reminder fires only inside the configured hours and days | `BR-12`, `FR-REM-05` | 0.7.0 |
| 15 | A day total splits an entry at local midnight while the task total does not | `FR-TIME-17`, S3 | 0.4.0 |
| 16 | The MCP token cannot mutate, close, archive or delete anything, by any route | `MCP-14`, `US-25` | 0.10.0 |
| 17 | `create_task` is atomic: an invalid part creates nothing | `MCP-13` | 0.11.0 |
| 18 | `create_task` is duplicate-safe | `MCP-27`, `US-27` | 0.11.0 |
| 19 | Import merges and never overwrites or removes | `DATA-13` | 0.9.0 |
| 20 | A backup taken with the online API restores to an identical state | `NFR-REL-03` | 0.9.0 |

## 4. Fixtures

| Command | Produces | Used for |
| --- | --- | --- |
| `pnpm seed:dev` | 2 projects, 6 tasks, todos, acceptance criteria, references, tags, a week of entries, events, reminders | Development, demos, the manual smoke test |
| `pnpm seed:perf` | 5,000 tasks and 100,000 time entries (`NFR-PERF-02`) | Measuring `PERF.md` baselines |
| `pnpm seed:firstrun` | What a brand-new install shows | 1.0.0 |

Seeds are **deterministic**: a fixed seed produces the same data every run, so a performance
number is comparable to last week's and a test failure is reproducible.

`seed:perf` writes to a separate file and never to `./data/pdm.db`, unless explicitly told
to. It is a measurement tool, not a demo.

## 5. Running the tests

```bash
pnpm install

pnpm test                # everything, once
pnpm test:watch          # watch mode
pnpm test:coverage       # with coverage, fails below 95% on business modules
pnpm test:int            # integration: SSE, migrations, backup and restore
pnpm test:e2e            # Playwright, from 1.0.0
```

A single test by requirement:

```bash
pnpm test -t 'FR-GATE-05'
pnpm test -t 'DATA-10'
```

## 6. Conventions

- Test files sit beside the code they test: `src/services/timer.test.ts`.
- A test's `describe` block names the requirement, not the function:

  ```ts
  describe('FR-TIME-04: only one timer may run at a time', () => { ... })
  ```

- **Unit** for a rule in isolation. **Integration** for a rule that touches the database
  together. No mocking of the database — a temp file, because the triggers and views are
  part of what is being tested.
- Mock only what crosses a process boundary: the clock, and the network in the MCP client
  tests.
- One behaviour per test. If a test name contains "and", split it.
- A bug fix comes with a test that fails without the fix, named after the requirement that
  was broken.

## 7. What is deliberately not tested

- **Pixel-level UI.** Brittle and low value here. Covered by the owner's exit test and,
  from 1.0.0, by a critical-path Playwright smoke suite.
- **The browser's notification permission prompt.** Cannot be scripted meaningfully.
  Covered by a manual test: deny permission, confirm the in-app banner and the instruction
  appear (`FR-REM-14`).
- **Timing under real load.** Simulated with the `seed:perf` fixture, not with a load
  generator.
- **Third-party MCP client behaviour.** Out of our control. Covered by the manual
  acceptance test with a real client, recorded in the release notes.

## 8. Before 1.0.0

- [ ] All twenty non-negotiable tests exist and pass
- [ ] Business-module coverage at or above 95%, measured by `pnpm test:coverage`
- [ ] Every Must requirement maps to a test or a written deferral
- [ ] Playwright smoke covers the critical path of all 29 user stories
- [ ] Performance baselines recorded in `PERF.md` on `seed:perf`
- [ ] A restore drill performed and its result written into the 0.9.0 release notes
- [ ] The owner has run every exit test from 0.1.0 to 1.0.0

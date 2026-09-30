# Backlog

Everything that is not in the release currently being built. This is the file that makes
the scope-freeze rule in [`docs/PLAN.md`](docs/PLAN.md) workable: anything discovered while
a release is in progress lands here with a target, instead of quietly entering the release.

## How this file works

| Column | Meaning |
| --- | --- |
| **Item** | What it is, in one line, with the requirement ID if the SRS has one |
| **Why** | Why it exists, or why it is not planned |
| **Priority** | MoSCoW, as the SRS uses it |
| **Target** | Which release it should land in, or *unplanned* |
| **From** | Which release it was found in, or *2026-09-28 planning* |

**Rules**

1. A release's scope is frozen when it moves to `in progress`. New findings never enter it.
2. A Must item found mid-release either displaces something in that release — a visible
   trade-off the owner decides — or moves to the next release.
3. An item with no target is not forgotten; it is waiting for a version to finish early.
4. When an item ships, delete the row and add a `CHANGELOG.md` entry. Do not keep history
   here; that is what the changelog is for.

---

## Ideas raised during planning

Decisions from these are already recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md) and
[`docs/DEFERRED.md`](docs/DEFERRED.md). They are listed so they are not re-raised as if
they were new.

| Item | Why | Priority | Target | From |
| --- | --- | --- | --- | --- |
| Sub-todos, one level | The user needs a flat phase list; nesting would change the timeline, the timer picker and the gate | Could | unplanned | planning |
| Acceptance-criteria templates | `R7` mitigation; the keyboard-first popup is the mitigation that matters | Could | unplanned | planning |
| Bulk tag edit across entries | A convenience, not a rule; entries and tags are never removed | Could | unplanned | planning |
| Drag to move and resize calendar events | The most bug-prone UI in the app; quick-create covers the common case | Could | unplanned | planning |
| Save a search as a named filter | Filters are already shareable as a URL | Could | unplanned | planning |
| Home dashboard widgets | The Today page already carries this | Could | unplanned | planning |
| End-of-day review prompt | A habit prompt; `R3` covers forgotten timers more directly | Could | unplanned | planning |
| File attachments on reference items | Adds file storage, a download route and a backup problem the user has not asked for | Could | unplanned | planning |
| Duplicate a task | Export and import already cover copying | Could | unplanned | planning |
| Local semantic search | Needs a model and an embedding step; designed to sit beside FTS5 | Could | unplanned | planning |
| Local PIN or password | `Q9` puts it out of scope; the trust boundary is the OS user | Could | unplanned | planning |
| Pause and resume a timer | The data model already supports it; wanted only if 0.3.0 finishes early | Should | 0.3.1 at the earliest | planning |
| Event repeat rules | A real gap for a daily agenda; planned into 0.6.0 | Should | 0.6.0 | planning |
| Board view with drag and drop | Planned, with drag-to-Ended opening the closure gate rather than bypassing it | Should | 0.5.0 | planning |

---

## Open for the owner

| Item | Why it needs a decision | Priority | Target | From |
| --- | --- | --- | --- | --- |
| `OQ-1` Is MCP in scope for 1.0.0? | Determines whether 1.0.0 is 0.9.0 or 0.11.0 | — | before 0.10.0 | planning |
| `OQ-5` The office timesheet text format | `Q8` is answered with a default that is configurable; a real format would remove the setting | Should | 0.4.0 | planning |
| `OQ-8` Any notification path when the browser is closed? | Currently answered as *no*, with the Missed tab. A container-side notifier would mean host-level software, which `C1` forbids | — | before 0.7.0 | planning |

---

## Found during a release

Add new sections below this line, one per release.

### Found in 0.1.0, open for 0.2.0

| Item | Why it matters | Priority | Target | Status |
| --- | --- | --- | --- | --- |
| `drizzle-orm` is declared, unused, and has no ADR | Dropped 2026-09-29 by owner decision in favour of hand-written SQL over `better-sqlite3`; ADR 0009 amended, `AGENTS.md` and `docs/ROADMAP.md` corrected. Accepted cost: no compile-time column checking. Closes the only open DoD box from 0.1.0 | — | done | closed |
| `autoprefixer` declared in `apps/web` but referenced by nothing | Tailwind 4's `@tailwindcss/postcss` bundles it, so the declaration was dead weight | — | done | closed |
| `/health` version was hardcoded, not read | Fixed after the 0.1.0 tag in `a599758`; recorded here so the reason survives | — | done | closed |
| `uptime_s` was always 0 | Same commit; it read the clock inside the request handler | — | done | closed |
| React 18 / Tailwind 3 vs the roadmap's React 19 / Tailwind 4 | Resolved by upgrading the code, ADR 0011 | — | done | closed |

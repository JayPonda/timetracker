# ADR 0005: Search uses SQLite FTS5 over a denormalised document table

- **Status:** Accepted
- **Date:** 2026-09-28
- **Affects:** `FR-SRCH-01`, `FR-SRCH-02`, `FR-SRCH-03`, `FR-SRCH-04`, `FR-SRCH-05`,
  `FR-SRCH-06`, `DATA-11`, `NFR-PERF-02`, `R6`; release 0.8.0

## Context

`FR-SRCH-01` requires one search box, on `Ctrl+K`, that searches across task name,
description, links, todos, acceptance criteria, lagging reasons, reference materials, time
entry notes, projects, tags and events. `FR-SRCH-02` adds filters for project, status, tag,
closure result and a date range. `FR-SRCH-04` requires the matching text highlighted and
each result to carry its project, status and total time. `FR-SRCH-05` requires
case-insensitive, partial-word matching with the first page in under one second, and
`NFR-PERF-02` sets the expected volume at 5,000 tasks and 100,000 time entries.

That rules out a per-entity `LIKE '%word%'` fan-out. On 100,000 entry notes, a leading
wildcard is a full scan per entity type, and the project, status and date filters would
have to be applied afterwards, meaning the scans happen regardless.

`R6` warns that feature growth is the main schedule risk, so search must not become a
subsystem with a service to run.

## Decision

**Search is a first-class feature of the database, not of the application.** SQLite is
compiled with FTS5 in the `better-sqlite3` build used by the image, verified at container
startup by a one-line self-check; if FTS5 is unavailable the container refuses to boot
rather than silently degrading.

**One denormalised table, one index.** A `search_documents` table holds one row per
searchable *chunk*, not per entity:

| Column | Meaning |
| --- | --- |
| `id` | surrogate key |
| `uid` | the source row's `uid`, so a chunk can be traced and re-indexed |
| `entity_type` | `task`, `todo`, `acceptance_criterion`, `closure_record`, `reference`, `time_entry`, `project`, `tag`, `event`, `task_link` |
| `entity_id` | the source row's id |
| `parent_task_id` | the owning task, for grouping and permission-free filtering |
| `project_id` | denormalised so a project filter is an indexed column, not a join |
| `status` | denormalised for the status filter |
| `tag_ids` | denormalised for the tag filter |
| `body` | the searchable text |
| `title` | the display label for the result row |
| `time_total_seconds` | denormalised so a result can show its total time without a join |
| `archived_at` | denormalised so archived rows can be filtered by index |
| `date_created`, `date_started`, `date_ended`, `date_due`, `date_worked` | denormalised so `FR-SRCH-03`'s choice of date target is an indexed column |
| `closure_result` | denormalised for the closure-result filter |
| `updated_at` | for incremental re-indexing |

A linked table maps each `search_documents` row to a **FTS5 virtual table** using
`content=''` — a contentless FTS index that stores only the inverted index, since the text
lives in `search_documents` anyway.

**Chunking, not one row per entity.** A task with four todos and three criteria produces
eight rows, not one. This is what makes `FR-SRCH-04`'s highlighting point at the right
place: a hit on a lagging reason highlights inside the reason, not inside a blob of
concatenated task text. It also means a match on a todo title does not drag the whole
description into the result.

**Writes go through the service layer, and the service layer is the only writer.** When a
task, todo, criterion, closure, reference, entry, project, tag or event is created, edited
or archived, the same transaction updates `search_documents` and the FTS index. There are
no database triggers on the search tables, because trigger logic would duplicate the write
path and reintroduce the drift risk this design is meant to avoid.

**Drift is detected, not hoped for.** Two mechanisms:

1. `pnpm --filter api search:rebuild` empties the document table, re-inserts every chunk
   from the source tables, and marks the index fresh. Available to the owner through
   Settings as *Rebuild search index*.
2. A CI test seeds a fixture, deliberately corrupts a handful of index rows, rebuilds, and
   asserts the result set is identical to the unclean one. If the two paths ever diverge,
   the build fails.

**Query shape.** The API builds one FTS5 `MATCH` with a prefix query per token
(`ref*`), so partial words work (`FR-SRCH-05`), and combines it with indexed equality
filters for project, status, tag, closure result, archived state and the chosen date
target. A ranking expression boosts title hits, then exact matches, then body hits. Results
are paged with a cursor, not an offset, and the default page size is 25 (`MCP-11` uses the
same shape).

**Local-only.** Everything happens inside the database file. There is no embedding model,
no vector store, no outbound request, which keeps `NFR-PRIV-01` intact. Semantic search is
`MCP-25` and `FR-SRCH` Could, deliberately not built now.

**Archived handling.** `archived_at` is denormalised onto the document, so *Show archived*
is an index filter and never a post-filter that would break paging.

## Consequences

Easy: sub-second search at the required volume, with highlighting, prefix matching and
several combined filters, and no service to run, no model to download, no network.

Hard: a write must update the index in the same transaction, so every service that touches
a searchable entity also touches `search_documents`. This is deliberate — it is the reason
drift is structurally unlikely — but it means a new searchable entity type needs three
changes: the column, the service hook, and the rebuild function.

Hard: a schema change to a searchable field requires a re-index. Handled by the rebuild
command and by running a rebuild as the last step of any migration that touches a
searchable column.

Accepted: the document table duplicates text. On the expected volume this is a few tens of
megabytes, and the backup is a single file.

Accepted: the FTS index is not transactionally consistent with the source tables in one
specific case — a crash between a source write and its index write. Both are in the same
SQLite transaction, so this cannot happen; the rebuild command exists for a future where it
somehow does.

## Alternatives considered

**Per-entity FTS5 tables with a `UNION ALL` across them.** More faithful to the data model
and no denormalisation, but the union, the per-table filters and the cross-table ranking
would all live in query code, and every new searchable type would need a new branch there.
Rejected in favour of one code path.

**`LIKE '%word%'` over a concatenated blob per task.** Simple, no schema. Rejected: it
cannot do prefix matching cheaply, it cannot rank, and it is the exact case `FR-SRCH-05`
and `NFR-PERF-02` exist to rule out.

**A separate search service such as Meilisearch or Typesense in Compose.** Powerful, but
it adds a container, a second persistence target, another backup, and a network path that
tension with `NFR-PRIV-01` and with `R6`. Rejected for a single-user laptop app.

**Local embeddings with `sqlite-vec` for semantic search.** Attractive for the
second-brain goal, but it introduces a model, an embedding step on every write, a
meaning-versus-lexical decision, and a large dependency, all before the keyword search is
proven. Deferred as `MCP-25`, and designed so it can be added beside FTS5 rather than
replacing it.

# ADR 0009: Migrations run through Umzug, not a hand-rolled runner

- **Status:** Superseded by [ADR 0012](0012-migration-runner-knex.md)
- **Date:** 2026-09-28
- **Affects:** `DEP-09`, `NFR-MAINT-02`, `NFR-REL-01`, `DATA-07`; release 0.1.0
- **Supersedes:** the runner described in ADR 0001's "Data access" row
  (Drizzle ORM for typed queries, **hand-written SQL migrations**). The SQL files stay;
  the runner does not.

## Context

0.1.0 shipped a migration runner written by hand: 293 lines in
`apps/api/src/db/migrate.ts` that globbed the `.sql` files, ordered them, recorded them,
opened a transaction per file, backed up first, and restored on failure. It worked, and it
was tested.

The owner's instruction was explicit: **the library should run migrations, and our code
should be a thin wrapper.** The reason is not that the hand-rolled runner was buggy. It is
that it was code this project would own, test, and maintain for the rest of its life, and
that none of the hard part of it is specific to PDM.

A migration runner's job — glob, sort, skip what is recorded, apply, record — is solved
problem. Umzug is a small, dependency-light library that does exactly that, keeps the
migrations as plain SQL files, and lets the storage backend be replaced. That last point
is what makes it usable here: the ledger can stay in the project's own
`schema_migrations` table instead of Umzug's default JSON file, so nothing about the
agreed data model changes.

The part that is **not** generic, and that no library can do for us, is unchanged: a
pre-migration online backup, a restore on failure, an aborting boot that names the backup
file, and the immutability and contiguity checks that stop a deleted or edited migration
from silently diverging two environments.

## Decision

`umzug` is a runtime dependency of `apps/api`. Migrations remain plain, hand-written
`.sql` files named `NNNN_name.sql`, applied in numeric order.

`apps/api/src/db/migrate.ts` is a wrapper of roughly 200 lines, of which the Umzug-specific
parts are small: a `resolve` that reads the file and runs its SQL in one transaction, and a
`UmzugStorage` implementation backed by the `schema_migrations` table. Everything Umzug
provides — ordering, pending detection, the ledger, skipping what is already applied — is
delegated rather than reimplemented.

The wrapper retains, because they are requirements rather than conveniences:

- **Plain `.sql` files.** `NFR-MAINT-02` wants a migration to be auditable by a human
  reading one file. Generating migrations from a schema object would trade that
  auditability for a tool nobody on this project has asked for.
- **The ledger in SQLite**, not a JSON file, because `schema_migrations` is part of the
  agreed data model (AGENTS.md Part 7) and is what `/health` reports.
- **A pre-migration backup** via `VACUUM INTO`, and a **restore on failure** that names
  the file, so a bad migration is recoverable without the owner having taken a copy.
- **Immutability and contiguity checks**, run as a preflight **before any statement is
  applied**, so an edited or deleted migration stops the boot with the database untouched.
- **`migrate()` is async**, because Umzug's API is. Boot already was, so this changed only
  the test and CLI call sites.

## Consequences

What this makes easy: the runner is no longer ours to maintain or get subtly wrong;
Umzug's own tests cover the mechanics; a future contributor reading `migrate.ts` sees
PDM's rules and not a reimplementation of a solved problem.

What this makes hard, and what we accept as a cost:

- **Umzug calls `up()` and then records the row, so the DDL and its ledger row are two
  transactions.** A crash in that window leaves an applied migration unrecorded; the next
  boot re-runs it and fails loudly, with a named backup. We accept this: a loud failure is
  the failure mode this project prefers (`AGENTS.md` Part 8), and the alternative would be
  the same code we just removed.
- **Umzug's storage contract wants filenames; our ledger stores slugs and versions.** The
  wrapper translates through the manifest. This is the only genuinely awkward part, and it
  exists because the ledger is a documented system table rather than an implementation
  detail of the runner.
- **One more runtime dependency**, against a target of about ten for the whole product.
  Umzug adds `emittery` and `pony-cause` and nothing that opens a socket or touches the
  filesystem beyond reading the migration files, so `NFR-PRIV-01` is unaffected.

The 16 tests in `migrate.test.ts` were kept unchanged in what they assert — order,
idempotency, rollback, backup-per-migration, immutability, contiguity, status — and all
still pass against Umzug. That is the evidence that the swap was behaviour-preserving.

## Alternatives considered

**Keep the hand-rolled runner.** Rejected by the owner, and the reasoning holds: it was
293 lines of code owned by this project whose generic half duplicated a solved problem.

**`drizzle-kit`, generating migrations from a TypeScript schema.** Rejected because it
would become the migration author, which is the auditability trade in `NFR-MAINT-02`
written in a different font. It is worth revisiting only if the schema work in 0.2.0 makes
hand-writing 15 tables painful — at which point the right answer is a generated-SQL review
step, not an ORM standing in for the ledger.

**`drizzle-orm` as the query layer.** Rejected by the owner on 2026-09-29, and this ADR
was amended to match. It had been declared in `apps/api/package.json` since 0.1.0 without a
single import — a dependency the documentation described but the code never adopted, which
is the worst of both worlds. `better-sqlite3` is synchronous, so a query builder adds an
abstraction over prepared statements rather than replacing them, and every existing query
in this repository is already hand-written `db.prepare(...)` SQL. Dropping it also settles
the `AGENTS.md` rule 10 exception that 0.1.0 shipped with. The cost is real and accepted:
no compile-time column checking, so a renamed column becomes a runtime error caught by
tests rather than by `tsc`. `drizzle-kit` is rejected on its own merits above, independent
of this decision.

**Knex.** Rejected: it brings its own query builder, duplicating what `better-sqlite3`
already does directly, and its migrations are JS or generated SQL rather than the plain
files we want.

**`node-pg-migrate`.** Rejected: Postgres only.

**Prisma.** Rejected: a large dependency, a generated client, its own query layer, and a
migration DSL — for a single-user SQLite app that must run offline in Docker.

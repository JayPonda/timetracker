# ADR 0012: Migrations run through Knex; the ledger is `knex_migrations`

- **Status:** Accepted
- **Date:** 2026-09-29
- **Supersedes:** ADR 0009's runner choice (Umzug). The values 0009 was written to
  preserve — a pre-migration backup, a restore-and-abort that names the file, a
  ledger in SQLite, contiguity — are carried over here, not abandoned.
- **Affects:** `DEP-09`, `NFR-MAINT-02`, `DATA-10`, `DATA-07`; release 0.2.0;
  `apps/api/src/db/migrate.ts`, `apps/api/src/db/migrations/`

## Context

0.2.0's repository layer needs a query builder — the agreed shape is
services → repository → Knex (AGENTS.md Part 5, as corrected on 2026-09-29 by
`D-25`; this citation pointed at a three-layer split that the layout did not yet
contain when the ADR was written). Knex is already in `apps/api` for that. The
migrations were still running through Umzug, which meant
the project carried **two** libraries with **two** ideas of what a migration is,
and every migration written this release — fifteen tables, constraints, views and
triggers — would live inside the runner's ledger model forever.

The owner chose **Full Knex** on 2026-09-29: Knex runs the migrations and owns the
ledger, and the hand-rolled Umzug wrapper disappears. The whole of a migration
runner — glob, sort, skip what is recorded, apply, record — is a solved problem;
Knex is the same solved problem the repository layer was already adopting, and
one tool for both halves of the data layer beats two.

## Decision

- **`knex` is a runtime dependency of `apps/api`; `umzug` is removed.**
- **A migration is `NNNN_name.js`** exporting `up(knex)` and `down(knex)`. Each
  file embeds the reviewed schema SQL, kept byte-identical to the hand-written
  SQL it was generated from (verified at generation time), so `.js` is a shape
  change, not a rewrite of the schema (`NFR-MAINT-02` stays about auditability:
  one file per migration, read top to bottom).
- **`knex_migrations` is the only ledger**, with Knex's own `knex_migrations_lock`.
  The hand-rolled `schema_migrations` table and migration `0001_schema_migrations`
  are gone; the remaining migrations renumber to `0001_settings`,
  `0002_data_model`, `0003_invariants` so versions stay contiguous from 0001.
- **One SQLite transaction per migration.** Knex runs with
  `disableTransactions: true` (its own wrapper would make every migration one
  giant transaction and leave the ledger inside it); instead each migration acquires
  the native better-sqlite3 connection and runs its DDL inside
  `conn.transaction(...)`. A failure rolls back that migration completely and the
  failed migration's name never reaches `knex_migrations` (`DATA-10`: no half
  schema).
- **The wrapper in `migrate.ts` keeps the PDM-specific rules** a library cannot
  know: a pre-migration `VACUUM INTO` backup per file, a restore-and-abort on
  failure that names the backup, and a contiguity check run before anything is
  applied (a gap means a migration was deleted).
- **The immutability checksum is dropped, by owner decision.** Umzug's ledger
  never carried a checksum either, and `knex_migrations` does not, so the
  guarantee was ours to maintain against a ledger that could not enforce it. Every
  migration in this project is `IF NOT EXISTS`, so a repeat run is a safe no-op —
  the thing a checksum was invented to forbid — and the real divergence risk this
  release faced was a deleted migration, which the contiguity check still catches.

## Consequences

What this makes easy:

- **One tool for the whole data layer.** Repositories and migrations speak the same
  Knex dialect, and there is no second migration model to learn or maintain.
- **In-place upgrades.** The live volume has an empty `knex_migrations`, so the
  three `IF NOT EXISTS` migrations re-run as no-ops and get recorded the first
  time Knex runs. Verified against a copy of the real 0.1.0 data directory: all
  rows and settings preserved, `knex_migrations` populated, second run idempotent.
- **The ledger is the same table `/health` reads**, so no second place can
  disagree with the database.

What we accept as a cost:

- **Immutability is now a review practice, not a machine check.** An edited, already
  applied migration would re-run as an `IF NOT EXISTS` no-op and diverge two
  environments silently if a human does not notice the diff. The owner accepted
  this explicitly; it is recorded here so the trade is never re-made silently.
- **Migration files are `.js`, not `.sql`.** A reader must tolerate the module
  wrapper around the DDL. The DDL itself is untouched, and the generation script
  diffed each file against the source SQL before the `.sql` files were removed.
- **`migrate.test.ts` re-expressed against `knex_migrations`**, and the checksum
  test was removed as part of the decision.

## Alternatives considered

- **Keep Umzug.** It never wrote a checksum either, so it would keep the same
  immutability gap while adding a second migration model next to Knex, which was
  already entering the tree for repositories. Rejected once Knex was chosen as the
  query layer.
- **Knex migrations but keep the `schema_migrations` ledger.** Rejected: Knex
  computes pending migrations from its own `knex_migrations` table, so a hand-rolled
  parallel ledger would exist only for reporting — two sources of truth for the same
  fact.
- **A hand-rolled runner on top of `knex.raw`.** Rejected: re-creating glob, sort,
  skip, and record is the 293-line problem ADR 0009 removed.
- **`drizzle-kit` as the migration author.** Still rejected on ADR 0009's grounds:
  the migration author becomes a schema object, which `NFR-MAINT-02` refuses.
## Addendum, 2026-09-29: one migration, and no upgrade path

This ADR says `knex_migrations` is the only ledger, and that a parallel
`schema_migrations` table would be two sources of truth. On a **fresh** database
that is true. On a database **upgraded** from 0.1.0 it was not: the 0.1.0
`schema_migrations` table survived, with its four rows, because nothing read it
and therefore nothing removed it.

Two things came out of finding that.

**The three migrations became one.** `0001_settings`, `0002_data_model` and
`0003_invariants` are now `0001_initial_schema`, containing the same DDL. The
trigger was stale numbering left by the renumbering above: each file's own
comment opened `-- 0002:`, `-- 0003:` or `-- 0004:` while its filename said
`0001`, `0002`, `0003`. Nobody had opened the files since. One file cannot carry
a stale version number, and the migrator container now either produces a
complete database or changes nothing at all.

The consolidation is verified rather than assumed: a test reads the real
`sqlite_master` after migrating and asserts 15 user-data tables, 14 no-delete
triggers and 30 indexes, so a migration that quietly lost a table or a trigger
fails instead of shipping.

**0.2.0 does not upgrade a 0.1.0 data directory.** The owner's call, 2026-09-29:
nothing is released, the database held one archived probe row and seven seeded
settings, and recreating it was cheaper than supporting a migration path that
would be exercised exactly once. A 0.1.0 `data/` directory is discarded and
rebuilt, not migrated. **The next migration to be added is `0002`.**

What this costs, stated plainly: a future release that *does* need to move an
existing database has no upgrade path, and the first release that needs one
writes it against real data on the owner's laptop. That is the trade the owner
made knowingly, which is why it is written down rather than left implicit in a
deleted file.

What this cost already, and is worth remembering: a clean run is not an upgrade.
Every test in the suite migrates an empty file, and the three integration tests
in `migrate.int.test.ts` are about the migrator's exit code on a clean run. The
upgrade path was untested because there was no test for it, and the release spec
claimed it had been "verified against a real data directory" when it had not been
run at all. Both the claim and the gap are recorded because the same release also
shipped a hand-written count that was wrong twice.

The migrator's own contract is verified end to end, on a deliberately broken
migration: the file is named, the SQL error is given, the pre-migration backup is
named and restored, the partial schema is rolled back, the exit code is 1, and
`pdm` does not start because compose waits on `service_completed_successfully`.

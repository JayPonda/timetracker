# ADR 0010: A one-shot container applies migrations; the server refuses to run without them

- **Status:** Accepted
- **Date:** 2026-09-28
- **Affects:** `DEP-09`, `DEP-04`, `NFR-REL-01`, `NFR-MAINT-02`; release 0.1.0
- **Related:** [ADR 0001](0001-stack-and-deployment.md) (one application container),
  [ADR 0009](0009-migration-runner-umzug.md) (migration running, superseded by
  [ADR 0012](0012-migration-runner-knex.md))

## Context

0.1.0 originally applied migrations inside the application process at boot:
`boot()` opened the database, called `migrate()`, then called `listen()`. The container
did one job, and the ordering rule was one line of code — migrate, then listen.

That works, and it is what most single-container apps do. It has three problems here.

**The server owned a second responsibility.** `boot()` was not just "start the server";
it was "change the schema, then start the server". A read-only mistake in that path
becomes a schema change, and the process that serves requests is the process that
performs DDL.

**A failed migration left an ambiguous container.** A migration that failed during boot
aborted the process, so `docker compose` reported the app as down with no way to ask
"did the migration run?". The owner's question when the container is unhealthy is
"which stage failed?", and one container answering two questions gives one answer.

**Restoring a backup while the server is involved.** A failed migration restores a
pre-migration snapshot over the live database. Doing that while the same process, and
potentially a second connection, holds the file open is the riskiest thing in the
migration path.

The owner's instruction was to split it: a container that applies migrations, stops,
and only then allows the application container to start.

## Decision

`docker-compose.yml` defines two services from the same image.

`pdm-migrate` is a **one-shot job container**: `restart: "no"`, no ports, the same
volumes, the same non-root user and the same dropped capabilities, running
`node api/cli/migrate.js`. It applies every pending migration, seeds settings, and
exits 0.

`pdm` declares `depends_on: pdm-migrate: { condition: service_completed_successfully,
restart: false }`. Compose starts the migrator, waits for it, and starts the app only
if it exited 0. A non-zero exit leaves the app in `created`, never `running`.

**The application no longer applies migrations.** `boot()` calls `assertSchemaReady()`,
which throws `SchemaNotReadyError` if anything is pending. This is a check, not a second
implementation, and it is what makes the ordering safe rather than merely conventional:
if someone starts `pdm` without the migrator, it refuses and says how to fix it, instead
of half-migrating or serving against a schema it did not verify.

`restart: false` on the dependency means `docker compose restart pdm` restarts only the
app and does not re-run migrations. Use `docker compose up -d` when the schema changes.

Locally there is no second container, so `pnpm dev` runs `pnpm --filter api migrate`
first — the same entry point, so the rule is identical in both environments.

Migrations remain baked into the image. **Adding a migration requires rebuilding the
image**, which ties the schema to the exact build that expects it rather than to
whatever happens to be in the working tree.

## Consequences

What this makes easy: a failed migration is unambiguous — one container exited non-zero
with a message naming the migration and the backup file, and the app is visibly not
running. `docker compose logs pdm-migrate` is the only place to look. The server has one
responsibility. And because nothing holds `/data` open while the schema changes, the
restore-on-failure path is safer than it was, not merely relocated.

What this makes hard, and what we accept:

- **Two containers instead of one.** ADR 0001's "one application container" is now "one
  application container and one job container". The job container is not an application
  service: it serves nothing, publishes no port, and is expected to be `exited`.
- **A failed migration now means "the app is down", not "the app is degraded".** Before,
  an already-migrated database would boot fine. This is stricter on purpose
  (`DEP-09`: refuse rather than serve a schema you have not verified) but it does mean a
  bad migration stops the app until it is fixed.
- **Local dev and Docker take the same rule by different means.** `pnpm dev` migrates
  then starts; Docker starts a container, waits, then starts a container. If those two
  ever disagree, the integration test that runs the CLI as a child process and asserts
  its exit code is what catches it.
- **`restart: unless-stopped` on `pdm` means a bypassed dependency produces a restart
  loop.** Only reachable by starting the app manually without its dependency. Accepted:
  it recovers by itself once the schema is fixed.

## Alternatives considered

**Keep migrating in `boot()`.** Rejected: it leaves the server owning DDL, and the failure
is indistinguishable from any other boot failure. The idempotent no-op case is the
comfortable one, and comfortable is exactly the wrong property for the path that has to
fail loudly.

**A separate migration image.** Rejected: a second build to keep in step with the first.
Same image, different command, so the migrator cannot run migrations the app does not
have.

**`docker compose run --rm pdm-migrate` by hand, before `up`.** Rejected: it works, and
it is a step the owner has to remember. A forgotten step is a boot failure. Declaring the
dependency makes the correct thing the default and the mistake impossible to make
silently.

**Wait for a database healthcheck instead of exit codes.** Rejected: there is no
database server. SQLite is a file, so the migrator's exit code is the only signal that
exists, and `service_completed_successfully` is exactly the right shape for it.

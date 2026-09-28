# ADR 0001: Stack and deployment shape

- **Status:** Accepted
- **Date:** 2026-09-28
- **Affects:** `DEP-01`…`DEP-11`, `NFR-SEC-01`, `NFR-SEC-04`, `NFR-PORT-01`,
  `NFR-PRIV-01`, `NFR-COMP-01`, `Q5`, `Q10`, `DEP-10`; releases 0.1.0, 0.10.0

## Context

The SRS requires an app that runs with `docker compose up -d`, installs nothing on the
host, publishes a configurable port on loopback only, persists data in a host folder,
restarts after a reboot, runs as a non-root user, and needs no internet. It must work on
Windows, macOS and Linux hosts.

The SRS proposes React with TypeScript, Node.js with TypeScript, SQLite, and an
in-process scheduler, and leaves the backend language open as `Q5`.

Two constraints from the SRS collide and must be resolved before any container is written.

**The loopback conflict (S1 in the roadmap).** `DEP-02` and `NFR-SEC-01` require the app to
be reachable on `127.0.0.1` only. `MCP-01` requires a second container, `pdm-mcp`, that
calls the app's API. Two containers on a Compose bridge network can only reach each other
if the listener accepts connections on the container's own routable address. If the app
binds `127.0.0.1` inside its own container, the MCP container cannot reach it and there is
no fix short of a shared volume or a Unix socket, both of which weaken the isolation the
SRS is asking for.

**The single-container preference.** A separate frontend container would need a reverse
proxy or CORS, both of which add moving parts for no benefit on a single-user localhost
app.

## Decision

**Language and runtime.** TypeScript everywhere, on Node.js 22 or newer. One language
across the stack keeps the container small and the mental model small. This closes `Q5`
in favour of the SRS's own proposal.

**Layout.** npm workspaces monorepo:

```
apps/api        Fastify REST API, migrations, scheduler, static file serving
apps/web        Vite + React frontend, built to static files
apps/mcp        MCP server (added in 0.10.0)
packages/shared Types and zod schemas shared by api, web and mcp
```

**One container serves both.** The image builds the frontend and serves it from the same
Fastify process that serves the API, with an SPA fallback to `index.html` for client-side
routes. There is no second application container, no proxy, and no CORS. `pdm-mcp` is the
only other container, added in 0.10.0.

**The loopback boundary is the published port, not the bind address.** The API process
listens on `0.0.0.0:${PDM_INTERNAL_PORT}` inside the container. Compose publishes it as:

```yaml
ports:
  - "127.0.0.1:${PDM_PORT:-8080}:${PDM_INTERNAL_PORT:-8080}"
```

Docker's port publishing is the network boundary. The app is unreachable from the LAN and
from any other machine; the only other listener on that network is `pdm-mcp`, which the
user started deliberately. `NFR-SEC-01` is satisfied at the only place that matters.

**The MCP server's own port.** `pdm-mcp` publishes `127.0.0.1:${PDM_MCP_PORT}` for the
Streamable HTTP transport, and also supports stdio for clients that launch servers
themselves. `PDM_MCP_PUBLISH=false` publishes nothing at all, which is the recommended
daily-use configuration; the README leads with the stdio setup.

**Container hardening.** Multi-stage build; the runtime stage contains only production
dependencies and the built frontend; a dedicated non-root user owns `/data` and
`/backups`; `restart: unless-stopped`; a health check hitting `/health`; no host mounts
other than `./data` and `./backups`; no capabilities, no privileged mode, no host
network.

**Client.** A modern desktop browser. No CDN, no external fonts, no analytics, no
outgoing request of any kind from the app or the frontend (`NFR-PRIV-01`). The reminder
sound is synthesised with WebAudio so there is not even a static asset to fetch.

**Naming.** The repository, the folder and the container keep their current names. The
product is Personal Day Manager, short name PDM, everywhere in the interface and the
documentation (S9).

## Consequences

Easy: one image to build and one command to run; no CORS anywhere; one language and one
toolchain; inter-container MCP calls work without a socket or a proxy; the app is
genuinely unreachable from the network.

Hard: the API process must remember to bind `0.0.0.0`, which is counter-intuitive for a
privacy-focused app, so it is stated in one constant with a comment and checked by an
integration test that connects from a second container. The frontend cannot be hot-reloaded
in the container, so development uses a local dev server and only the built artefact is
verified in Docker — verified at every release by the exit test.

Accepted: the app's port is open to anything running as the same OS user on the laptop.
That is the same trust boundary as every other localhost app, and the SRS puts a password
in Could (`NFR-SEC-05`, `Q9`).

## Alternatives considered

**NestJS.** Decorators, dependency injection and a large surface. More ceremony than a
single-user app needs, and a slower cold start in a container.

**Prisma.** A generated client is a build step and a migration language of its own. The
SRS requires auditable, versioned migrations (`NFR-MAINT-02`); hand-written SQL with a
thin typed query layer is easier to audit and has no codegen.

**Python with FastAPI.** Diverges from the SRS's own proposal and puts a second language in
the stack for the MCP server.

**Separate frontend and API containers with a reverse proxy (nginx or Caddy).** Three
containers, an extra configuration file, and a proxy hop for every request, in exchange
for hot reloading in development that `docker compose run` already gives us.

**A shared volume or a Unix socket between the API and the MCP server.** Avoids the bind
address question but puts the MCP server on the data path, which contradicts `MCP-03` —
the assistant must go through the API so the business rules are enforced in one place.

**Binding the API to `127.0.0.1` inside the container and giving the MCP container
`network_mode: service:pdm`.** This works and keeps the literal bind address loopback, but
it couples the two containers' lifecycles: the MCP server cannot restart without the app
restarting, and `depends_on` semantics get confusing. Rejected as more fragile than a
published-port boundary.

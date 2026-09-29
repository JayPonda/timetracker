# syntax=docker/dockerfile:1
#
# One application container serves the API and the built frontend, so there is no
# frontend container, no proxy and no CORS (ADR 0001).
#
# Three stages, so a native-module rebuild never happens in the final image and
# dev dependencies never ship.

# ---------------------------------------------------------------------------
# Stage 1: dependencies. Pinned so a lockfile change is the only way the
# dependency set moves.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

# better-sqlite3 needs a C toolchain to build from source. It normally uses a
# prebuilt binary, but the toolchain is here so a missing prebuild for a Node
# version does not fail the image build (0.1.0 risk table).
RUN apk add --no-cache python3 make g++

WORKDIR /repo

# Copy the manifests alone, so a source-only change reuses this layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# `pnpm-workspace.yaml` carries `allowBuilds` for better-sqlite3 and esbuild.
# Without it the install appears to succeed and the first query fails.
RUN corepack enable \
 && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: build the API and the frontend.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++

# The build stage needs pnpm itself. `corepack enable` from the deps stage does
# not carry into this one, because the two stages have separate filesystems.
RUN corepack enable

WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

COPY . .

RUN pnpm --filter @pdm/shared build \
 && pnpm --filter @pdm/api build \
 && pnpm --filter @pdm/web build \
 && pnpm --filter @pdm/api deploy --prod /prod/api

# ---------------------------------------------------------------------------
# Stage 3: runtime. No compiler, no dev dependencies, non-root.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# `tzdata` is required for `TZ` to mean anything (DEP-05, NFR-TIME-01).
RUN apk add --no-cache tzdata curl

# A fixed uid/gid so a bind-mounted volume has a predictable owner. The owner
# does not match the host user, which is why the README documents one `chown` on
# a fresh Linux host (0.1.0 risk table).
RUN addgroup -g 10001 pdm \
 && adduser -D -u 10001 -G pdm pdm

WORKDIR /app

COPY --from=build --chown=pdm:pdm /repo/apps/api/dist ./api
COPY --from=build --chown=pdm:pdm /repo/apps/web/dist ./web

# `pnpm deploy` produces the API's production dependency tree with the workspace
# link resolved to real files, which is the only arrangement that works here: a
# symlink into a layer that is not copied would resolve to nothing at runtime.
COPY --from=build --chown=pdm:pdm /prod/api/node_modules ./node_modules

# The migration files sit next to the compiled runner, which is where it
# looks for them. Shipping them as plain files is what keeps a migration an
# auditable unit of DDL rather than something generated (NFR-MAINT-02).
COPY --from=build --chown=pdm:pdm /repo/apps/api/dist/db/migrations ./api/db/migrations

# The mounts. Created here with the right ownership so a named volume inherits
# it, and so a bind mount on a host that already has the directories keeps
# working.
RUN mkdir -p /data /backups && chown -R pdm:pdm /data /backups /app

VOLUME ["/data", "/backups"]

USER pdm

# The version, baked in from the tag at build time (`VERSIONING.md`).
#
# It is an ARG and not only a build-time constant because the fallback to
# reading the root `package.json` cannot be relied on in the image: the runtime
# stage copies `apps/api/dist`, not the repository root. A build arg makes the
# image self-describing — two builds of two different tags cannot report the
# same version even if the file lookup is ever removed.
#
# Defaults to empty so `docker build .` with no arguments still works, and the
# app then falls back to reading `package.json`.
ARG PDM_VERSION=""
ENV PDM_VERSION=${PDM_VERSION}

ENV NODE_ENV=production \
    PDM_DATA_DIR=/data \
    PDM_BACKUP_DIR=/backups \
    PDM_WEB_DIR=/app/web \
    PDM_BIND_HOST=0.0.0.0 \
    PDM_INTERNAL_PORT=8080

EXPOSE 8080

# A real check, not a process check: the endpoint runs `SELECT 1` and counts
# migrations, so a container that is up but broken is reported unhealthy
# (acceptance criterion 1).
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PDM_INTERNAL_PORT}/health" || exit 1

CMD ["node", "api/main.js"]

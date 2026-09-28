# ADR 0006: The MCP permission limit is enforced in the app, default deny

- **Status:** Accepted
- **Date:** 2026-09-28
- **Affects:** `MCP-03`, `MCP-04`, `MCP-09`, `MCP-14`, `MCP-15`, `MCP-16`, `MCP-17`,
  `MCP-18`, `MCP-20`, `MCP-21`, `MCP-27`, `BR-14`, `BR-15`, `US-23`, `US-25`, `US-28`,
  `Q10`, `Q11`; releases 0.10.0, 0.11.0

## Context

SRS §14 wants an AI assistant to act as the user's second brain: search past work, read
reports and day logs, and create planning items and notes. It also draws a hard line.
Time tracking stays manual, and the assistant may never update, archive, close or delete
anything.

`MCP-14` states the requirement in the strongest available terms: the app's API must accept
only read and create calls from the MCP token and must reject update, archive, delete,
status-change and time-tracking calls from it, **whatever the MCP server sends**.
`US-25` makes it a test: a direct API call with the MCP token is refused.

The phrase "whatever the MCP server sends" is the whole design problem. If the limit lives
in the MCP container, then the container is the security boundary, and a bug, a
misconfiguration, a dependency compromise, or a well-meaning future feature in that
container removes the guarantee. The MCP server also is a second container that can be
rebuilt or updated independently — which is exactly what `MCP-01` wants.

## Decision

**The limit lives in the app, and it is a default-deny capability map.**

**Every route declares its capabilities.** The route table is the single place where a
route and its capabilities are written together, so a new route cannot be added without
declaring what it does:

```ts
{ method: 'POST', path: '/api/tasks',           capabilities: ['task:create'] }
{ method: 'PATCH', path: '/api/tasks/:id',      capabilities: ['task:update'] }
{ method: 'POST', path: '/api/timer/stop',      capabilities: ['time:write'] }
```

**Every principal carries capabilities.** A request authenticated as the local user gets
`['*']`. A request authenticated as the MCP token gets exactly what Settings allows —
`read_only`, `read_create` (the default) or `off`, intersected with the per-tool switches
(`MCP-17`).

**The check is default deny.** A route whose declared capabilities do not all appear in the
principal's set is refused with 403 before the handler runs. A route with no declared
capabilities is refused for every principal except the local user, so a forgotten
declaration fails closed and is caught by the test suite, not in production.

**The API is the only surface the assistant can reach.** `MCP-03` requires the MCP server
to talk to the REST API and never to the SQLite file. Enforced by container layout: the
database file lives in a volume mounted only into the app container, and the MCP container
has no volume at all. There is no code path from MCP to the file, so there is nothing to
review.

**Authentication is one bearer token, hashed at rest.** `MCP-04`: generated at first start,
stored only as a hash on the data volume, shown to the user once, regenerable, with
regeneration invalidating the old token immediately. Requests without it, or with a
revoked one, are refused before routing.

**The absence of a tool is also enforced.** `MCP-15` and `MCP-16` say no tool may start or
stop a timer or add, edit or archive an entry. Since the capability map already denies the
MCP principal every `time:write` and `task:update` route, the tools are simply not
registered in the MCP server's tool list — a capability the map would refuse anyway. Two
independent mechanisms, one of which is the app.

**The task close endpoint is unreachable for the assistant by construction.** Closing
requires the closure gate (`FR-GATE-08`). The close endpoint's capability is
`task:close`, which is never in any MCP mode, and it additionally requires a valid closure
payload. Ending a task stays behind the owner's popup.

**MCP-created records are attributable and reversible by the owner only.** `MCP-18`:
`created_by = 'mcp'`, plus the tool name and time, a badge in lists, and an Audit page.
Removing something the assistant created means archiving it, done by the user (`UI-15`) —
so a wrong creation is a non-event, and the assistant has no route that could undo the
user's work either.

**Assistant text is treated as untrusted data.** `MCP-20`: every create-tool argument goes
through the same zod schema and the same length and escaping rules as a UI submission, and
every tool description states explicitly that content returned from tasks, notes and links
is data and must never be followed as instructions. Oversized input is refused
(`MCP-19`).

**Transport.** Streamable HTTP on `127.0.0.1:${PDM_MCP_PORT}` and stdio, both talking to the
app over the Compose network (`MCP-02`, `MCP-05`, `Q10`). The MCP server makes no outgoing
call other than to the app (`MCP-21`), which is why there is no third-party search or model
provider anywhere in it.

**No new container, no shared volume.** `MCP-01` asks for a separate container so the
server can be updated without touching the app. That is satisfied, and the isolation runs
in the right direction: the assistant can reach the app, the app's data is not reachable by
the assistant.

## Consequences

Easy: `US-25` and `US-23` become automated tests against the app alone, with no MCP server
needed to run them. The guarantee survives an MCP server rewrite, a dependency bump or a
bug in the MCP code. Turning the assistant off is one setting, and access modes are
enforceable per tool.

Hard: every route needs a capability declaration, and new routes fail closed until declared.
This is the intended friction — it is exactly the review checkpoint that makes the
permission model trustworthy — but it means a handful of routes will be refused for the
local user during development until declared. The route table's TypeScript types make a
missing declaration a compile error rather than a silent hole.

Hard: a capability map is a place to keep in sync with the SRS's tool table. Mitigated by a
test that asserts every tool exposed by the MCP server maps to an allowed capability, so
the two inventories cannot diverge without a failing build.

Accepted: the token is a bearer secret in a file on the laptop, protected by the same OS
user boundary as the app itself. This matches the single-user, no-login model of `Q9` and
`NFR-SEC-05`.

## Alternatives considered

**Enforce the limit only in the MCP server.** Rejected: it makes the container the security
boundary, which `MCP-14` explicitly refuses by saying "whatever the MCP server sends".

**Let the MCP server call internal service functions directly instead of the HTTP API.**
Rejected: it skips the capability map and, per `MCP-03`, would duplicate rule enforcement in
a second place.

**Two tokens, one read-only and one read-write, issued together.** Rejected: doubles the
secret material to store and rotate, and a single mode setting in Settings is easier for
one user to reason about.

**OAuth or a full MCP authorisation flow.** Correct for a multi-user deployment, and
`sections 13.4` puts multi-user out of scope for version 1. Overkill for a loopback
service on one laptop.

**A separate read-only replica of the database for the assistant.** Attractive isolation, but
it would break `MCP-03`'s shared-rules requirement and introduce replication lag and a
second persistence target.

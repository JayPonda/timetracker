# ADR 0013: One origin, two versioned namespaces — JSON at `/api/v1`, the app at `/ui/v1`

- **Status:** Accepted
- **Date:** 2026-09-29
- **Affects:** `DEP-01`, `DEP-06`, `DEP-11`, `NFR-USE-01`; release 0.2.0;
  `packages/shared/src/http.ts`, `apps/api/src/server.ts`,
  `apps/api/src/routes/table.ts`, `apps/api/src/middleware/error.ts`,
  `apps/web/vite.config.ts`
- **Relates to:** ADR 0006. The capability-map examples in that record write
  `/api/tasks`, and those paths are now `/api/v1/tasks`. **ADR 0006 is not
  rewritten** — an ADR is never edited after the fact — so the examples stay as
  written and the path shape is governed here. The decision 0006 makes, that the
  MCP limit is enforced in the app with checks default-deny, is unchanged by
  this record.

## Context

One Fastify process serves the JSON API and the built frontend
(ADR 0001, ADR 0010). Both answered to unprefixed paths at once: the API was
`/tasks`, the SPA was `/` and its assets were `/assets/`. That is two unrelated
things sharing one flat namespace, and it fails in a specific way rather than an
abstract one.

`GET /tasks` was the JSON list of tasks. `GET /tasks/1` was the task detail
screen. The not-found handler decided between an error envelope and the app shell
by asking a single question — *is this path under `/api`?* — so **every other
unprefixed path was answered with HTML.** A mistyped `/task` returned the entire
application shell with a `200`. A client could not distinguish a wrong URL from a
right one, and a proxy in front could not cache the two apart.

The second problem was structural. There was nothing stopping the next route from
being added at `/time`, and the convention holding that every route was JSON
would have been enforced by whoever read the table most recently. This project
already decided that the way to make a rule provable is to put it in one place:
`DATA-10` is enforced by triggers, `BR-01` by an index, `MCP-14` by the
capability map. The URL scheme was the last unprovable rule.

The third problem was versioning. Nothing carried a version, so the day a
breaking change was needed there was nowhere to change it.

## Decision

Two versioned namespaces, and three unprefixed paths. Nothing else.

| Namespace | Prefix | Serves |
| --- | --- | --- |
| API | `/api/v1/…` | Every JSON route, declared and versioned |
| UI | `/ui/v1/…` | Every page, and the assets they load |
| Unprefixed | `/health`, `/ready`, `/` | Probes, and the redirect to the app |

- **`API_V1 = '/api/v1'` and `UI_V1 = '/ui/v1'`, as two literal constants.**
  Not one `SCHEME_VERSION` composed into both. They are independent: the UI can
  move to `/ui/v2` while the API stays at `/api/v1`, and a client that pins the
  API version is unaffected. A shared version number would couple two things that
  genuinely version separately, and would make the second version a coordinated
  change across both.
- **The three unprefixed paths are an explicit allowlist**, not a rule about
  namespaces. Whatever the version, `/health` and `/ready` stay stable — a
  watchdog does not know which API version is deployed, and requiring it to
  would mean every release breaks every monitor. `/` redirects.
- **`/` returns 308 to `/ui/v1/tasks`.** 308, not 302 or 301: 308 preserves the
  method and tells caches the answer is permanent, so it is asked once.
- **Enforcement is at the declaration site.** `RouteTable.declare` refuses a URL
  that is neither under `API_V1` nor one of the three allowlisted paths, and it
  refuses at boot rather than at request time. A route outside the scheme cannot
  be registered, so it cannot be reached, so it cannot be tested into existence.
  This is the same reasoning as refusing `DELETE`: the guarantee has to be in one
  function.
- **The SPA fallback asks a positive question**: is this path at or under
  `UI_V1`? Not *is this path not `/api`*.
- **No legacy aliases.** `/tasks` and `/api/tasks` return 404. An alias is a
  second name for a thing that must eventually go away, and it stays.
- **`/ready` is new, and `/health` is untouched.** The Docker health check keeps
  calling `/health` and its response contract does not change.

### The two predicates are separate, and that is the load-bearing detail

The scheme needs two different questions, and the first version of this work
answered both with one function, which had to be wrong for one of its callers:

- `isDeclaredRouteAllowed(url)` — may this URL be *declared as a route*? Yes for
  `API_V1` and the three allowlisted paths. **No for UI paths**, because pages are
  served by the static mount, and a declared page would acquire a capability
  guard — an HTML response has no principal to guard.
- `isUiPath(path)` — may this *request* be answered with the app shell? Yes at or
  under `UI_V1`.

Collapsing them means the fallback works and route declaration silently accepts
`/ui/v1/tasks`. A test asked, and the answer was that they are different rules, so
they are two functions now.

## Consequences

**Easier.** A breaking API change has an obvious home: add `API_V2`, declare new
routes under it, leave `API_V1` serving. Probes keep working across every such
change without edits. A wrong URL returns JSON saying so, instead of an app shell
that looks like a bug in the app. The rule is checkable by reading one function.

**Harder.** Every URL in every test, every fetch, and every doc changes, and
`localhost:5173` now needs `/ui/v1`. A bookmarked `/ui/tasks/1` is a 404 — no
alias, so a bookmark needs retyping once. The frontend build's `base` must match
`UI_V1`, and a mismatch produces a page that loads and then fails every request,
because the HTML loads but its assets and API calls go to the wrong paths.

**Accepted.** The owner sees `/ui/v1/tasks` in the address bar. That is the cost of
the UI being versioned, and it is paid in the address bar rather than in a
migration nobody remembers.

## Alternatives considered

**Keep `/api` and `/ui` unversioned; version only if a break ever happens.**
Rejected. The break is predictable, and the version has to be in the first URL
that ships — retrofitting it means every caller moves at once, which is the worst
moment to move a single-user laptop app. Deciding while the surface is eleven
routes costs one afternoon and a `sed`.

**Version the UI only, leaving the API at `/api/tasks`.**
Rejected. It is half the change, and it leaves the ambiguous namespace in place
for the JSON half. The ambiguity is the actual defect, not the missing `v1`.

**One `SCHEME_VERSION` for both prefixes.**
Rejected above: it couples the two namespaces' release cycles for no benefit.

**Serve the UI from a second origin or a second container.**
Rejected in ADR 0001 for the loopback-boundary reason, and rejected here again
on its own merits: it adds CORS, a second health check and a second thing to
rebuild, to solve a problem that two prefixes solve with a line of routing.

**Keep the aliases for a release, then remove them.**
Rejected. Every owner who bookmarks during that window needs migrating anyway, and
the alias is what makes the migration necessary in the first place.

**Enforce the scheme in a test rather than in `declare`.**
Rejected. A test proves the current routes are correct; it does not make the next
one incorrect-by-default. The failure this prevents is a route added by someone in
a hurry at 22:00, which is precisely the moment a test nobody thinks to extend
loses.

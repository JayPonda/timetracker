# ADR 0011 — React 19 and Tailwind 4

- **Status:** accepted
- **Date:** 2026-09-29
- **Decides:** the frontend versions used by `apps/web`
- **Applies to:** `UI-09` (theme follows the OS), `NFR-USE-02` (plain interface)

## Context

`docs/ROADMAP.md` §2 line 117 has always claimed the stack is **Vite + React 19 +
React Router + TanStack Query + Tailwind v4**. The code shipped 0.1.0 on React
18.3 and Tailwind 3.4. The document described a stack that was never built.

That gap is worse than a stale sentence. A later session reading the roadmap
would reasonably conclude that a React 19 and Tailwind 4 upgrade is planned work,
and either do it without a spec or quietly add it to a release. Both are wrong: a
breaking major bump on a product mid-ladder is real work with its own risk, and
neither was costed or scoped.

Two ways to remove the gap. Correct the document to describe what shipped, or
bring the code up to what the document promised. The owner chose the second on
2026-09-29, on the reasoning that a document describing an absent stack is a
standing invitation to unplanned work, whereas a real upgrade is a thing that
gets reviewed.

## Decision

`apps/web` runs **React 19** and **Tailwind 4**, and `docs/ROADMAP.md` §2 stays
as written.

The upgrade landed on its own branch, `chore/react19-tailwind4`, before 0.2.0 was
opened, rather than inside 0.2.0. The reasoning is scope: 0.2.0's point is the
15-entity schema, and AGENTS.md Part 8 freezes a release's scope at its start.
Entangling a breaking major bump on the framework with fifteen new tables means
neither change can be reviewed or reverted on its own.

## Consequences

**Tailwind 4 is configured in CSS.** `tailwind.config.js` is deleted. The
`content` array is gone because v4 scans the source tree automatically, and the
`@tailwind base/components/utilities` directives become a single
`@import 'tailwindcss'`. The PostCSS plugin moved to its own package,
`@tailwindcss/postcss`, which also bundles autoprefixer, so `autoprefixer` is no
longer listed separately.

**`darkMode: 'media'` needed no replacement, and that is load-bearing.** In v3
this app set `darkMode: 'media'` explicitly to satisfy `UI-09`: the theme follows
the OS with no stored choice and no flash of the wrong theme. `media` is the v4
default, so the migration adds nothing — correct only because this app never used
a `.dark` class strategy. Had it, the port would have needed
`@custom-variant dark (&:where(.dark, .dark *));` and the class would have had to
be set somewhere. Verified in the built CSS: the `dark:` rules sit inside
`@media (prefers-color-scheme:dark)`, and no `.dark` class selector exists.

**React 19 removed the global `JSX` namespace.** Six return annotations across
`App.tsx`, `Routes.tsx`, `Sidebar.tsx` and `HealthSummary.tsx` were the entire
compile failure. Each now imports `type { JSX } from 'react'`. This is the
expected shape of a React 19 port and was the only source change needed —
`createRoot` was already in use, and no removed API (`ReactDOM.render`,
`defaultProps`, `propTypes`, the legacy `React.FC`) appeared anywhere in the
codebase.

**No other runtime dependency was added.** React and Tailwind are upgrades to
dependencies the project already had, so `AGENTS.md` rule 10's "a new runtime
dependency needs an ADR" is not triggered; this ADR exists because a version
bump on the framework is the kind of change that deserves the same scrutiny.

## Alternatives rejected

- **Correct `ROADMAP.md` to React 18 / Tailwind 3.** One line, and it would have
  described the shipped, tested stack. Rejected because the owner would rather
  run the newer major versions than document them as absent, and both versions
  are still actively supported.
- **Defer to 1.0.0.** Leaves the roadmap claiming a stack that does not exist for
  the whole ladder, which is the problem this ADR exists to end.
- **Upgrade inside 0.2.0.** Rejected on scope, above.

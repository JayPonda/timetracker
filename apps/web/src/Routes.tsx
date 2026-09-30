import type { JSX } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { App } from './App';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { TaskDetailPage } from './features/tasks/TaskDetailPage';
import { TasksPage } from './features/tasks/TasksPage';
import { TagsPage } from './features/tags/TagsPage';

/**
 * Routing, relative to the UI base (ADR 0013).
 *
 * **Every path here is written without `/ui/v1`.** The router runs with
 * `basename={UI_V1}` (see `main.tsx`), which is the single place the prefix is
 * declared for the browser, and it both matches and generates links with the
 * prefix attached. Writing `/ui/v1/tasks` in a `<Route>` while the basename is
 * also `/ui/v1` is the mistake this arrangement exists to prevent: it matches
 * `/ui/v1/ui/v1/tasks`, and it fails at runtime as a blank screen rather than as
 * a build error.
 *
 * The API is not here at all — it lives under `/api/v1` and is reached by
 * `fetch` from the feature `api.ts` modules, never by the router.
 */
export function Routes_(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/tasks/:id" element={<TaskDetailPage />} />
      <Route path="/tags" element={<TagsPage />} />
      <Route path="/not-found" element={<NotFound />} />
      {/*
        Anything else is genuinely unknown, so it goes to the not-found page.

        An earlier version redirected unknown paths to `/` instead, on the
        reasoning that every destination belongs to a release that has not been
        built yet. That is no longer true — four real screens exist, and
        acceptance criterion 12 asks for a real 404 — and a `Navigate` to a route
        that is itself rendered by this `Routes` is one loop away from a blank
        screen. `/not-found` is matched by the line above, so this cannot
        redirect to itself.
      */}
      <Route path="*" element={<Navigate to="/not-found" replace />} />
    </Routes>
  );
}

function NotFound(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          That address does not match anything in this app.
        </p>
        {/*
          `Link`, not `<a href="/">`. A plain anchor bypasses the router, so it
          would have to spell out the `/ui` prefix itself and would reload the
          whole bundle to get there.
        */}
        <Link
          to="/"
          className="mt-4 inline-block px-3 py-2 rounded border border-neutral-300 dark:border-neutral-700"
        >
          Back to the start
        </Link>
      </div>
    </div>
  );
}

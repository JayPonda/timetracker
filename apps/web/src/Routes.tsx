import type { JSX } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { App } from './App';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { TasksPage } from './features/tasks/TasksPage';

/**
 * Routing.
 *
 * The catch-all is `/`, not a 404 page, because every destination belongs to a
 * release that has not been built yet. A real 404 page is still required by
 * acceptance criterion 12, so an unknown path that is *not* a known destination
 * lands on the not-found page below.
 */
const KNOWN_PATHS = new Set(['/', '/projects', '/tasks', '/not-found']);

export function Routes_(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/not-found" element={<NotFound />} />
      <Route path="*" element={<Navigate to={KNOWN_PATHS.has(location.pathname) ? '/' : '/not-found'} replace />} />
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
        <a href="/" className="mt-4 inline-block px-3 py-2 rounded border border-neutral-300 dark:border-neutral-700">
          Back to the start
        </a>
      </div>
    </div>
  );
}

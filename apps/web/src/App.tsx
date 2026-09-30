import type { JSX } from 'react';
import { NAV_ITEMS } from './nav';
import { Sidebar } from './components/Sidebar';
import { HealthSummary } from './components/HealthSummary';
import { useHealth } from './lib/health';

/**
 * The 0.1.0 shell.
 *
 * Layout only: navigation, a top bar, and a message saying what this release
 * is. `useHealth` does the one request; `HealthSummary` decides what the status
 * block says, and is tested without a browser.
 *
 * Reading `GET /health` is also the honest proof that the container is talking
 * to its own API. A hardcoded string could not tell the owner whether it did,
 * and acceptance criterion 11 asks for the configured zone, which only the
 * server knows.
 */
export function App(): JSX.Element {
  const { data, error } = useHealth();

  return (
    <div className="min-h-screen flex bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <header className="h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-800 flex items-center px-4 gap-3">
          <h1 className="font-semibold">Personal Day Manager</h1>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            foundation, runtime and projects
          </span>
        </header>

        <main className="flex-1 p-6">
          <h2 className="text-lg font-medium mb-2">The foundation is running</h2>
          <p className="max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
            Projects, tasks and tags are usable: create them, edit them, archive them,
            restore them. The application runs in Docker, keeps its data in SQLite,
            migrates its own schema, and serves this page from the same process as the
            API. The timer arrives in the release listed on the left.
          </p>

          <HealthSummary data={data} error={error} />

          <h3 className="mt-8 text-sm font-medium mb-2">What is coming</h3>
          <ul className="text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
            {NAV_ITEMS.filter((item) => !item.enabled).map((item) => (
              <li key={item.path}>
                {item.label} — {item.release}
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  );
}

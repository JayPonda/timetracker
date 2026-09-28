import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '../nav';

/**
 * The left navigation.
 *
 * Two accessibility rules from the SRS are honoured here, and both are easy to
 * break by accident in later releases:
 *
 * - `UI-12`: a disabled item is disabled by the `disabled` attribute and the
 *   `aria-disabled` state, not by low contrast alone. Status is never
 *   communicated by colour or opacity on its own.
 * - `UI-07`: the tooltip is the `title` attribute, so it is reachable by
 *   keyboard as well as by pointer, and it names the release rather than
 *   saying "coming soon".
 */
export function Sidebar(): JSX.Element {
  return (
    <nav aria-label="Main" className="w-56 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
      <ul className="p-3 space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            {item.enabled ? (
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded text-sm ${
                    isActive
                      ? 'bg-neutral-200 dark:bg-neutral-700 font-medium'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <span
                aria-disabled="true"
                title={`${item.label} arrives in ${item.release}`}
                className="block px-3 py-2 rounded text-sm cursor-not-allowed text-neutral-400 dark:text-neutral-600"
              >
                {item.label}
                <span className="sr-only"> (not yet available, arrives in {item.release})</span>
                <span aria-hidden="true" className="ml-2 text-xs">
                  {item.release}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

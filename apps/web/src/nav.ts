/**
 * The navigation, with the release that adds each destination.
 *
 * The release column is not decoration. The 0.1.0 shell is honest about what
 * exists: an item for an unbuilt feature is present but disabled, with a
 * tooltip naming the release that adds it. An empty shell with a note in the
 * README would be quieter, and would leave the owner guessing whether a missing
 * screen is a bug (acceptance criterion 13).
 */

export interface NavItem {
  /**
   * Route path, **relative to the UI base**.
   *
   * The router's `basename` adds `/ui/v1` (ADR 0013), so a path here is written
   * `/tasks` and reaches the browser as `/ui/v1/tasks`. Writing the prefix in
   * here as well would make it `/ui/v1/ui/v1/tasks`, which matches nothing.
   */
  path: string;
  label: string;
  /** Plain language, per NFR-USE-02. */
  release: string;
  enabled: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Today', release: '0.4.0', enabled: false },
  { path: '/tasks', label: 'Tasks', release: '0.2.0', enabled: true },
  { path: '/projects', label: 'Projects', release: '0.2.0', enabled: true },
  { path: '/tags', label: 'Tags', release: '0.2.0', enabled: true },
  { path: '/calendar', label: 'Calendar', release: '0.6.0', enabled: false },
  { path: '/day-log', label: 'Day log', release: '0.4.0', enabled: false },
  { path: '/reminders', label: 'Reminders', release: '0.7.0', enabled: false },
  { path: '/reports', label: 'Reports', release: '0.9.0', enabled: false },
  { path: '/library', label: 'Library', release: '0.8.0', enabled: false },
  { path: '/settings', label: 'Settings', release: '0.2.0', enabled: false },
];

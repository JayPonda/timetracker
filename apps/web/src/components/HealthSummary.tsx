import type { JSX } from 'react';
import type { HealthResponse } from '@pdm/shared';
import { formatClock, isValidTimeZone } from '../lib/datetime';

/**
 * The status block on the shell (acceptance criterion 11).
 *
 * Split out from `App` and given plain props on purpose. The part that has to
 * be *right* — turning a server timestamp and a zone name into readable text —
 * is then a pure function of its inputs, so it can be rendered and asserted in
 * a test without a DOM, a fetch stub, or a query cache. `App` keeps the
 * fetching and passes whatever it has, including nothing.
 */

export interface HealthSummaryProps {
  data: HealthResponse | undefined;
  error: Error | null;
}

export function HealthSummary({ data, error }: HealthSummaryProps): JSX.Element {
  const timeZone = data?.time_zone;
  const zoneUsable = timeZone !== undefined && isValidTimeZone(timeZone);

  return (
    <>
      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-3 text-sm max-w-md">
        <dt className="text-neutral-500 dark:text-neutral-400">Time zone</dt>
        <dd data-testid="time-zone">{timeZone ?? '—'}</dd>

        <dt className="text-neutral-500 dark:text-neutral-400">Server time</dt>
        <dd data-testid="server-time">
          {data && zoneUsable ? formatClock(data.now_ms, timeZone) : '—'}
        </dd>

        <dt className="text-neutral-500 dark:text-neutral-400">Version</dt>
        <dd data-testid="version">{data?.version ?? '—'}</dd>

        <dt className="text-neutral-500 dark:text-neutral-400">Database</dt>
        <dd data-testid="db-status">
          <StatusPill ok={data?.db === 'ok'} failed={error !== null || data?.db === 'error'} />
        </dd>
      </dl>

      {data?.db === 'error' && data.db_error ? (
        <p role="alert" className="mt-4 max-w-2xl text-sm text-red-700 dark:text-red-400">
          The database is not reachable: {data.db_error}
        </p>
      ) : null}

      {!data && !error ? (
        <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">Checking the server…</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 max-w-2xl text-sm text-red-700 dark:text-red-400">
          Could not reach the API: {error.message}
        </p>
      ) : null}
    </>
  );
}

/**
 * Status is never carried by colour alone (UI-12), so the word is in the text
 * and the glyph and colour only reinforce it.
 */
function StatusPill({ ok, failed }: { ok: boolean; failed: boolean }): JSX.Element {
  const tone = ok
    ? 'text-green-700 dark:text-green-400'
    : failed
      ? 'text-red-700 dark:text-red-400'
      : 'text-neutral-500 dark:text-neutral-400';
  const word = ok ? 'ok' : failed ? 'error' : 'unknown';
  const glyph = ok ? '●' : failed ? '▲' : '○';
  return (
    <span className={tone}>
      <span aria-hidden="true">{glyph}</span>{' '}
      <span data-testid="db-word">{word}</span>
    </span>
  );
}

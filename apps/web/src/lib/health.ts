import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@pdm/shared';

/**
 * `GET /health` (DEP-06, acceptance criterion 11).
 *
 * Same-origin by construction: the API and this page are served by one process
 * (ADR 0001), so there is no base URL to configure, no CORS preflight, and
 * nothing that can break when the port changes. A relative path also means the
 * request cannot leave the machine, which `NFR-PRIV-01` requires and which
 * `apps/web` would otherwise have to be trusted about.
 */

async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/health', { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    // The body of a 503 still carries `db_error`, which is the one thing the
    // owner needs. Parsing it is worth the extra branch.
    const detail = await res.json().catch(() => null);
    const reason =
      detail && typeof detail === 'object' && 'db_error' in detail
        ? String((detail as { db_error?: unknown }).db_error)
        : undefined;
    throw new Error(reason ?? `health check failed with HTTP ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

/**
 * The server's health, kept fresh enough for the shell's clock.
 *
 * `refetchInterval` exists so the displayed time advances. It is a five-second
 * poll of a local endpoint that runs two indexed queries, and the alternative
 * — a browser-side `setInterval` with `Date.now()` — would mean a second clock,
 * which rule 4 does not allow.
 */
export function useHealth(): { data: HealthResponse | undefined; error: Error | null } {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 5_000,
  });
  return { data: query.data, error: query.error as Error | null };
}

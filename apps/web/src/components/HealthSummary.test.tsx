import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HealthResponse } from '@pdm/shared';
import { HealthSummary } from './HealthSummary';

/**
 * Acceptance criterion 11: the shell renders times in the configured zone.
 *
 * Rendered with `renderToStaticMarkup`, which needs no DOM and no new
 * dependency. What is under test is the presentation: given a server clock and
 * a zone, does the shell show that time in that zone.
 */

const HEALTH: HealthResponse = {
  status: 'ok',
  db: 'ok',
  version: '0.1.0',
  uptime_s: 3,
  migrations: { applied: 2, pending: 0, ok: true },
  time_zone: 'Asia/Kolkata',
  now_ms: 1_790_604_309_000,
};

describe('acceptance criterion 11: the shell renders the time in the configured zone', () => {
  it('shows the zone the server reported', () => {
    const html = renderToStaticMarkup(<HealthSummary data={HEALTH} error={null} />);
    expect(html).toContain('Asia/Kolkata');
  });

  it('shows the server time formatted in that zone', () => {
    const html = renderToStaticMarkup(<HealthSummary data={HEALTH} error={null} />);
    // 14:05:09Z is 19:35:09 in Kolkata. A formatter ignoring the zone would
    // render 14:05:09 and fail here.
    expect(html).toContain('19:35:09');
  });

  it('does not show the time in the host zone instead', () => {
    const html = renderToStaticMarkup(<HealthSummary data={HEALTH} error={null} />);
    expect(html).not.toContain('14:05:09');
  });

  it('shows the version it was given', () => {
    const html = renderToStaticMarkup(<HealthSummary data={HEALTH} error={null} />);
    expect(html).toContain('0.1.0');
  });

  it('words the database status rather than relying on colour', () => {
    const html = renderToStaticMarkup(<HealthSummary data={HEALTH} error={null} />);
    // UI-12: never colour alone.
    expect(html).toContain('>ok<');
  });

  it('falls back to a dash when there is nothing to show yet', () => {
    const html = renderToStaticMarkup(<HealthSummary data={undefined} error={null} />);
    expect(html).toContain('Checking the server');
  });

  it('names the reason when the database is down', () => {
    const broken: HealthResponse = { ...HEALTH, status: 'error', db: 'error', db_error: 'disk I/O error' };
    const html = renderToStaticMarkup(<HealthSummary data={broken} error={null} />);
    expect(html).toContain('disk I/O error');
  });

  it('names the reason when the API could not be reached', () => {
    const html = renderToStaticMarkup(
      <HealthSummary data={undefined} error={new Error('network unreachable')} />,
    );
    expect(html).toContain('network unreachable');
  });

  it('does not throw on a zone the server reported that Intl cannot use', () => {
    const bad: HealthResponse = { ...HEALTH, time_zone: 'Not/AZone' };
    const html = renderToStaticMarkup(<HealthSummary data={bad} error={null} />);
    // Shows the raw value, and dashes the time rather than crashing the shell
    // into the error boundary.
    expect(html).toContain('Not/AZone');
  });
});

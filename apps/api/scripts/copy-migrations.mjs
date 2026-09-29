/**
 * Copies the migration `.sql` files into `dist`.
 *
 * The migration runner reads migrations from disk next to its own module, so a
 * compiled build would otherwise find an empty directory and silently apply
 * nothing. `tsc` only emits `.ts` output, hence this step.
 *
 * Kept as a script rather than a tsc plugin so the build has no extra
 * dependency, and so what it does is readable in one screen.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'src', 'db', 'migrations');
const to = join(here, '..', 'dist', 'db', 'migrations');

mkdirSync(dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });

console.log(`[build] migrations copied to ${to}`);

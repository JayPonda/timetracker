import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database } from 'better-sqlite3';
import knexFactory, { type Knex } from 'knex';

/**
 * The Knex instance, and the ONE place the query builder is created.
 *
 * Repositories are the only consumers (AGENTS.md Part 5: services — repository —
 * Knex, with no Knex in a route). This module exists so that every pooled
 * connection inherits the same pragmas as `openDb`: `better-sqlite3` is
 * synchronous and Knex is not, so a second connection that silently opens in
 * rollback-journal mode and full-fsync would break the project's reliability
 * guarantees without any error being raised. The `afterCreate` hook is what
 * prevents that.
 *
 * `connection.ts` and this file must stay in agreement; `knex.test.ts` asserts
 * the full `REQUIRED_PRAGMAS` table against the live Knex connection.
 */

export interface CreateKnexOptions {
  /** Absolute path to the database file. */
  file: string;
}

export function createKnex({ file }: CreateKnexOptions): Knex {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }

  return knexFactory({
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
    pool: {
      afterCreate(connection: Database, done: (err: Error | null, connection?: Database) => void) {
        try {
          connection.pragma('journal_mode = WAL');
          connection.pragma('foreign_keys = ON');
          connection.pragma('busy_timeout = 5000');
          connection.pragma('synchronous = NORMAL');
          done(null, connection);
        } catch (error) {
          done(error as Error, connection);
        }
      },
    },
  });
}
/**
 * Framework schema bootstrap.
 *
 * Applies the base schema (./schema.sql) to a SynapCores instance.
 * Idempotent — every CREATE is IF NOT EXISTS, so it's safe to run
 * on every cold start. Apps call this once at boot, then add their
 * own schema migrations on top.
 *
 * Why we don't use a real migration tool: SynapCores' DDL is
 * straightforward and the apps are small enough that "run this on
 * every boot" works. When complexity grows we add a versioned-
 * migration runner here; the contract (`bootstrap(client)`) doesn't
 * change.
 */

import 'server-only';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { SynapCoresClient } from './client';

/** Splits a SQL file into individual statements (separator: `;` at EOL). */
function splitStatements(sql: string): string[] {
  // Strip line comments and split on `;` that ends a line.
  const noComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return noComments
    .split(/;\s*\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply the framework's base schema (tenants, users, memberships, audit, ...).
 * Idempotent.
 */
export async function bootstrapFramework(client: SynapCoresClient): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(here, 'schema.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  for (const stmt of splitStatements(sql)) {
    try {
      await client.sql(stmt);
    } catch (err) {
      // Some engines treat IF NOT EXISTS as a no-op success even on
      // re-runs; others throw a "table exists" error. Swallow the
      // latter — anything genuine will surface as a different message.
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('already exists') || msg.includes('duplicate')) continue;
      throw err;
    }
  }
}

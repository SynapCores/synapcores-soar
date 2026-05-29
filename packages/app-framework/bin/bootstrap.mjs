#!/usr/bin/env node
/**
 * CLI:  npx @synapcores/app-framework bootstrap
 *
 * Applies the framework's base schema to the configured SynapCores
 * instance. Reads SYNAPCORES_URL + SYNAPCORES_ADMIN_API_KEY from the
 * environment.
 *
 * Idempotent — safe to run on every cold start. Apps wire this into
 * their dockerfiles / process managers so a fresh deploy is a single
 * `docker compose up`.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, '..', 'src', 'db', 'schema.sql');

async function main() {
  const baseUrl = process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:28080';
  const apiKey = process.env.SYNAPCORES_ADMIN_API_KEY;
  if (!apiKey) {
    console.error(
      '[framework-bootstrap] SYNAPCORES_ADMIN_API_KEY is not set.',
    );
    process.exit(2);
  }

  const sql = await readFile(SCHEMA, 'utf-8');
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(
    `[framework-bootstrap] applying ${statements.length} statements to ${baseUrl}`,
  );

  let applied = 0;
  let skipped = 0;
  for (const stmt of statements) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/query/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ sql: stmt }),
      });
      if (res.ok) {
        applied++;
        continue;
      }
      const body = await res.text();
      if (
        body.toLowerCase().includes('already exists') ||
        body.toLowerCase().includes('duplicate')
      ) {
        skipped++;
        continue;
      }
      console.error(`[framework-bootstrap] FAILED on:\n${stmt}\n`);
      console.error(`  status=${res.status} body=${body.slice(0, 300)}`);
      process.exit(1);
    } catch (err) {
      console.error(
        `[framework-bootstrap] network error on statement:\n${stmt}\n`,
        err,
      );
      process.exit(1);
    }
  }

  console.log(
    `[framework-bootstrap] ✓ done — ${applied} applied, ${skipped} already in place.`,
  );
}

main().catch((err) => {
  console.error('[framework-bootstrap] unexpected error:', err);
  process.exit(1);
});

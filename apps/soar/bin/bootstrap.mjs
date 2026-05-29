#!/usr/bin/env node
/**
 * pnpm --filter @synapcores/soar bootstrap
 *
 * Applies the SOAR-domain schema. Should run AFTER the framework
 * bootstrap (`pnpm framework:bootstrap`) since SOAR-domain rows
 * reference the framework's tenant_id.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, '..', 'src', 'lib', 'schema.sql');

async function main() {
  const baseUrl = process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:28080';
  const apiKey = process.env.SYNAPCORES_ADMIN_API_KEY;
  if (!apiKey) {
    console.error('[soar-bootstrap] SYNAPCORES_ADMIN_API_KEY is not set.');
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

  console.log(`[soar-bootstrap] applying ${statements.length} statements`);

  let applied = 0;
  let skipped = 0;
  for (const stmt of statements) {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/query/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ sql: stmt }),
    });
    if (res.ok) { applied++; continue; }
    const body = await res.text();
    if (body.toLowerCase().includes('already exists') || body.toLowerCase().includes('duplicate')) {
      skipped++; continue;
    }
    console.error(`[soar-bootstrap] FAILED on:\n${stmt}\n`);
    console.error(`  status=${res.status} body=${body.slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`[soar-bootstrap] ✓ done — ${applied} applied, ${skipped} already in place.`);
}

main().catch((err) => {
  console.error('[soar-bootstrap] unexpected error:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * pnpm --filter @synapcores/aerospace-rca playback
 *
 * Orchestrator for recording the cinematic demo:
 *   1. Confirms the engine is reachable
 *   2. Re-runs seed-demo with --hold-today (so the BE-4 027 anomaly
 *      gets ingested live during Act 1)
 *   3. Prints the URL to open: http://localhost:3005/demo
 *
 * The actual 5-act timeline runs in the browser — see
 * src/app/(app)/demo/page.tsx. Kick it off from there.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = (process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:8081').replace(/\/+$/, '');

async function main() {
  console.log(`[playback] engine = ${BASE}`);
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`[playback] engine not reachable at ${BASE}/health`);
    process.exit(1);
  }
  console.log('[playback] engine OK; re-seeding with --hold-today...');
  const seed = spawn(
    'node',
    [join(HERE, 'seed-demo.mjs'), '--bulk', '--hold-today'],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
  await new Promise((res, rej) => {
    seed.on('exit', (code) =>
      code === 0 ? res() : rej(new Error(`seed exit ${code}`)),
    );
  });
  console.log('\n[playback] READY');
  console.log('  Open:  http://localhost:3005/demo');
  console.log('  Click: "Kick Off" — the 5-act timeline runs in the browser.');
}

main().catch((e) => {
  console.error('[playback] crashed:', e);
  process.exit(1);
});

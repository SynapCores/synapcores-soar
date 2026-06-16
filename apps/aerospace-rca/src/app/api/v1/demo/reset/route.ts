import { NextResponse } from 'next/server';

import { db, TODAY_ANOMALY_ID } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Demo reset: remove today's anomaly and any agent_runs/evidence tied
 * to it so the cinematic playback re-ingests it cleanly.
 *
 * The evidence_chain table is IMMUTABLE — DELETE is rejected by the
 * engine. We DROP and recreate it (the demo treats the chain as
 * single-run scoped). Real deployments would NOT reset evidence
 * between investigations; this is a demo affordance.
 */
export async function POST() {
  const c = db();
  await c.sql(`DELETE FROM agent_runs WHERE anomaly_id = $1`, [TODAY_ANOMALY_ID]);
  await c.sql(`DELETE FROM anomalies WHERE id = $1`, [TODAY_ANOMALY_ID]);

  // Wipe ALL evidence so the visualisation shows the playback freshly.
  // IMMUTABLE table rejects DELETE → drop + recreate.
  try {
    await c.sql(`DROP TABLE evidence_chain`);
  } catch {
    // table may not exist yet
  }
  await c.sql(
    `CREATE IMMUTABLE TABLE IF NOT EXISTS evidence_chain (
       id TEXT PRIMARY KEY,
       ts TIMESTAMP NOT NULL,
       actor TEXT NOT NULL,
       action TEXT NOT NULL,
       target_id TEXT NOT NULL,
       details TEXT NOT NULL
     )`,
  );

  return NextResponse.json({ ok: true, reset_at: new Date().toISOString() });
}

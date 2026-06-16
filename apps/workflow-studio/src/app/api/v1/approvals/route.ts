import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

export async function GET() {
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);
  const result = await client.sql(
    `SELECT q.id, q.run_id, q.node_id, q.state, q.requested_at, q.decided_at, q.decided_by, q.reason,
            r.workflow_id
     FROM workflow_approval_queue q
     JOIN workflow_runs r ON r.id = q.run_id
     WHERE q.state = 'awaiting'
     ORDER BY q.requested_at DESC`,
  );
  return NextResponse.json(result.rows);
}

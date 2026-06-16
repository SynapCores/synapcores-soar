import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);

  const [runResult, stepsResult] = await Promise.all([
    client.sql(
      'SELECT id, workflow_id, version, trigger_kind, trigger_data, status, started_at, ended_at, error FROM workflow_runs WHERE id = $1',
      [id],
    ),
    client.sql(
      'SELECT id, run_id, node_id, node_type, status, input_json, output_json, started_at, ended_at, error FROM workflow_step_runs WHERE run_id = $1 ORDER BY started_at ASC',
      [id],
    ),
  ]);

  if (!runResult.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ run: runResult.rows[0], steps: stepsResult.rows });
}

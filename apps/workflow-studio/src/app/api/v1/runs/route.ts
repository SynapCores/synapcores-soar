import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

export async function GET(req: Request) {
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });

  const url = new URL(req.url);
  const workflowId = url.searchParams.get('workflowId');
  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);

  let sql =
    'SELECT id, workflow_id, version, trigger_kind, status, started_at, ended_at, error FROM workflow_runs';
  const params: (string | number)[] = [];
  const conditions: string[] = [];

  if (workflowId) {
    conditions.push(`workflow_id = $${params.length + 1}`);
    params.push(workflowId);
  }
  if (status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(status);
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ` ORDER BY started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const client = getTargetEngineClient(engine);
  const result = await client.sql(sql, params);
  return NextResponse.json(result.rows);
}

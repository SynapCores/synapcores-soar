import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);
  const result = await client.sql<{
    id: string;
    name: string;
    description: string;
    version: number;
    status: string;
    updated_at: string;
  }>(
    'SELECT id, name, description, version, status, updated_at FROM workflow_definitions ORDER BY updated_at DESC',
  );
  return NextResponse.json(result.rows);
}

export async function POST(req: Request) {
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const body = (await req.json()) as {
    name: string;
    description?: string;
    definition: string;
  };
  const id = randomUUID();
  const client = getTargetEngineClient(engine);
  await client.sql(
    `INSERT INTO workflow_definitions (id, name, description, version, definition, status, created_at, updated_at)
     VALUES ($1, $2, $3, 1, $4, 'draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, body.name, body.description ?? '', body.definition],
  );
  return NextResponse.json({ id, version: 1 });
}

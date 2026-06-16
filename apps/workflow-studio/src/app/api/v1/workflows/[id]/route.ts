import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';
import { randomUUID } from 'node:crypto';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);
  const result = await client.sql<{
    id: string;
    name: string;
    description: string;
    version: number;
    definition: string;
    compiled_sql: string | null;
    status: string;
    owner: string | null;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT id, name, description, version, definition, compiled_sql, status, owner, created_at, updated_at FROM workflow_definitions WHERE id = $1',
    [id],
  );
  if (!result.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(result.rows[0]);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    definition?: string;
  };
  const client = getTargetEngineClient(engine);
  // Fetch current version
  const current = await client.sql<{ version: number; definition: string }>(
    'SELECT version, definition FROM workflow_definitions WHERE id = $1',
    [id],
  );
  if (!current.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const newVersion = current.rows[0].version + 1;
  // Archive current version
  await client.sql(
    `INSERT INTO workflow_versions (id, workflow_id, version, definition, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [randomUUID(), id, current.rows[0].version, current.rows[0].definition],
  );
  // Update the definition
  await client.sql(
    `UPDATE workflow_definitions SET name = COALESCE($1, name), description = COALESCE($2, description), definition = COALESCE($3, definition), version = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
    [body.name ?? null, body.description ?? null, body.definition ?? null, newVersion, id],
  );
  return NextResponse.json({ id, version: newVersion });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);
  await client.sql(
    `UPDATE workflow_definitions SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id],
  );
  return NextResponse.json({ archived: true });
}

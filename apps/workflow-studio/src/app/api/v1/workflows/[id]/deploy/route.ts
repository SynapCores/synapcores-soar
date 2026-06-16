import 'server-only';
import { NextResponse } from 'next/server';
import { compile, validateWorkflow } from '@/compiler';
import { getEngine, getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';
import { randomUUID } from 'node:crypto';
import type { WorkflowDefinition } from '@synapcores/workflow-types';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as {
    definition: WorkflowDefinition;
    engineId?: string;
  };

  const engine = body.engineId
    ? await getEngine(body.engineId)
    : await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });

  const validation = validateWorkflow(body.definition);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Validation failed', issues: validation.issues },
      { status: 422 },
    );
  }

  const compiled = compile(body.definition);
  const client = getTargetEngineClient(engine);

  // Check for previous deploy to drop old objects
  let prev: { objects_json: string | null } | undefined;
  try {
    const prevResult = await client.sql<{ objects_json: string | null }>(
      `SELECT objects_json FROM workflow_deploys WHERE workflow_id = $1 ORDER BY deployed_at DESC LIMIT 1`,
      [id],
    );
    prev = prevResult.rows[0];
  } catch {
    // workflow_deploys might not exist yet
  }

  if (prev?.objects_json) {
    try {
      const objects = JSON.parse(prev.objects_json) as {
        triggers: string[];
        procedures: string[];
      };
      for (const trig of objects.triggers ?? []) {
        try {
          await client.sql(`DROP TRIGGER IF EXISTS ${trig}`);
        } catch {
          // ignore
        }
      }
      for (const proc of objects.procedures ?? []) {
        try {
          await client.sql(`DROP PROCEDURE IF EXISTS ${proc}`);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // Execute compiled SQL split on semicolons
  const statements = compiled.sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const stmt of statements) {
    if (stmt.trim()) {
      await client.sql(stmt + ';');
    }
  }

  // Record deploy
  const deployId = randomUUID();
  const objectsJson = JSON.stringify({
    triggers: compiled.triggerNames,
    procedures: [compiled.procedureName],
  });
  try {
    await client.sql(
      `INSERT INTO workflow_deploys (id, workflow_id, version, engine_url, deployed_at, objects_json) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)`,
      [deployId, id, compiled.version, engine.url, objectsJson],
    );
  } catch {
    // ignore if table doesn't exist
  }

  // Update status
  await client.sql(
    `UPDATE workflow_definitions SET status = 'deployed', compiled_sql = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [compiled.sql, id],
  );

  return NextResponse.json({
    deployId,
    procedureName: compiled.procedureName,
    triggerNames: compiled.triggerNames,
    hash: compiled.hash,
  });
}

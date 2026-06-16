import 'server-only';
import { NextResponse } from 'next/server';
import { compile, validateWorkflow, emitBootstrapDDL } from '@/compiler';
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

  // Bootstrap schema tables (idempotent — CREATE IF NOT EXISTS)
  const bootstrapSql = emitBootstrapDDL();
  // Execute each bootstrap statement individually (split on ; at top level)
  // Bootstrap DDL only has simple CREATE TABLE statements — safe to split on ;
  const bootstrapStatements = bootstrapSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));
  for (const stmt of bootstrapStatements) {
    try {
      await client.sql(stmt + ';');
    } catch {
      // Most failures here = table already exists — safe to ignore
    }
  }

  // Check for previous deploy to drop old objects
  let prev: { objects_json: string | null } | undefined;
  try {
    const prevResult = await client.sql<{ objects_json: string | null }>(
      `SELECT objects_json FROM workflow_deploys WHERE workflow_id = $1 ORDER BY deployed_at DESC LIMIT 1`,
      [id],
    );
    prev = prevResult.rows[0];
  } catch {
    // workflow_deploys might not exist yet (bootstrap may have failed silently)
  }

  if (prev?.objects_json) {
    try {
      const objects = JSON.parse(prev.objects_json) as {
        triggers: string[];
        procedures: string[];
      };
      for (const trig of objects.triggers ?? []) {
        try { await client.sql(`DROP TRIGGER IF EXISTS ${trig};`); } catch { /* ignore */ }
      }
      for (const proc of objects.procedures ?? []) {
        try { await client.sql(`DROP PROCEDURE IF EXISTS ${proc};`); } catch { /* ignore */ }
      }
    } catch {
      // ignore parse errors
    }
  }

  // Deploy procedure as a single statement (CRITICAL: do NOT split on ; inside the procedure body)
  try {
    await client.sql(compiled.procedureSql + ';');
  } catch (err) {
    return NextResponse.json(
      { error: 'Procedure compilation failed', detail: String(err) },
      { status: 422 },
    );
  }

  // Deploy each trigger as a separate statement
  const triggerErrors: string[] = [];
  for (const trigSql of compiled.triggerSqlList) {
    try {
      await client.sql(trigSql + ';');
    } catch (err) {
      triggerErrors.push(String(err));
    }
  }

  // Record deploy in IMMUTABLE TABLE
  const deployId = randomUUID();
  const objectsJson = JSON.stringify({
    triggers: compiled.triggerNames,
    procedures: [compiled.procedureName],
  });
  try {
    await client.sql(
      `INSERT INTO workflow_deploys (id, workflow_id, version, engine_url, deployed_at, objects_json)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)`,
      [deployId, id, compiled.version, engine.url, objectsJson],
    );
  } catch {
    // IMMUTABLE TABLE insert can fail on re-run — ignore, the deploy still succeeded
  }

  // Save compiled SQL + update definition status
  try {
    await client.sql(
      `UPDATE workflow_definitions SET status = 'deployed', compiled_sql = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [compiled.sql, id],
    );
  } catch {
    // table may not exist — ignore
  }

  return NextResponse.json({
    deployId,
    procedureName: compiled.procedureName,
    triggerNames: compiled.triggerNames,
    triggerErrors: triggerErrors.length > 0 ? triggerErrors : undefined,
    hash: compiled.hash,
    ok: triggerErrors.length === 0,
  });
}

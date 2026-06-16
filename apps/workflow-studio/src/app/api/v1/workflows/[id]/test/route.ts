import 'server-only';
import { NextResponse } from 'next/server';
import { compile, validateWorkflow } from '@/compiler';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';
import { randomUUID } from 'node:crypto';
import type { WorkflowDefinition } from '@synapcores/workflow-types';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params; // unused param — test is stateless
  const body = (await req.json()) as {
    definition: WorkflowDefinition;
    sampleData?: Record<string, unknown>;
  };

  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });

  const validation = validateWorkflow(body.definition);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Validation failed', issues: validation.issues },
      { status: 422 },
    );
  }

  // Compile to a test-scoped procedure name (unique UUID prefix)
  const testId = randomUUID().replace(/-/g, '').slice(0, 8);
  const testDef: WorkflowDefinition = {
    ...body.definition,
    id: `test_${testId}`,
    meta: { ...body.definition.meta, name: `test_${testId}` },
  };
  const compiled = compile(testDef);
  const client = getTargetEngineClient(engine);

  const results: { stmt: string; ok: boolean; error?: string }[] = [];

  // Deploy procedure as ONE statement — do NOT split on ; inside procedure body
  try {
    await client.sql(compiled.procedureSql + ';');
    results.push({
      stmt: `CREATE OR REPLACE PROCEDURE ${compiled.procedureName}(...)`,
      ok: true,
    });
  } catch (err) {
    results.push({
      stmt: `CREATE OR REPLACE PROCEDURE ${compiled.procedureName}(...)`,
      ok: false,
      error: String(err),
    });
  }

  // Deploy triggers (skip on procedure failure)
  if (results.every(r => r.ok)) {
    for (const trigSql of compiled.triggerSqlList) {
      try {
        await client.sql(trigSql + ';');
        results.push({
          stmt: trigSql.slice(0, 80) + (trigSql.length > 80 ? '...' : ''),
          ok: true,
        });
      } catch (err) {
        results.push({
          stmt: trigSql.slice(0, 80),
          ok: false,
          error: String(err),
        });
        break;
      }
    }
  }

  // If sampleData provided and procedure deployed, attempt a test CALL
  if (results.every(r => r.ok) && body.sampleData) {
    const sampleJson = JSON.stringify(body.sampleData).replace(/'/g, "''");
    try {
      await client.sql(`CALL ${compiled.procedureName}('${sampleJson}', '{}');`);
      results.push({
        stmt: `CALL ${compiled.procedureName}(...) [test run with sample data]`,
        ok: true,
      });
    } catch (err) {
      results.push({
        stmt: `CALL ${compiled.procedureName}(...)`,
        ok: false,
        error: String(err),
      });
    }
  }

  // Tear down test objects
  try { await client.sql(`DROP PROCEDURE IF EXISTS ${compiled.procedureName};`); } catch { /* ignore */ }
  for (const trig of compiled.triggerNames) {
    try { await client.sql(`DROP TRIGGER IF EXISTS ${trig};`); } catch { /* ignore */ }
  }

  const allOk = results.every(r => r.ok);
  return NextResponse.json({
    ok: allOk,
    results,
    procedureName: compiled.procedureName,
    hash: compiled.hash,
  });
}

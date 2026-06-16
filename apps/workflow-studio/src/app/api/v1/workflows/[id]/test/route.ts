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

  // Compile to a test-scoped procedure name
  const testId = randomUUID().replace(/-/g, '').slice(0, 8);
  const testDef: WorkflowDefinition = {
    ...body.definition,
    meta: { ...body.definition.meta, name: `test_${testId}` },
  };
  const compiled = compile(testDef);
  const client = getTargetEngineClient(engine);

  const results: { stmt: string; ok: boolean; error?: string }[] = [];
  const statements = compiled.sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await client.sql(stmt + ';');
      results.push({
        stmt: stmt.slice(0, 80) + (stmt.length > 80 ? '...' : ''),
        ok: true,
      });
    } catch (err) {
      results.push({
        stmt: stmt.slice(0, 80),
        ok: false,
        error: String(err),
      });
      break; // stop on first error
    }
  }

  // Tear down test objects
  try {
    await client.sql(`DROP PROCEDURE IF EXISTS ${compiled.procedureName}`);
  } catch {
    // ignore
  }
  for (const trig of compiled.triggerNames) {
    try {
      await client.sql(`DROP TRIGGER IF EXISTS ${trig}`);
    } catch {
      // ignore
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({
    ok: allOk,
    results,
    procedureName: compiled.procedureName,
  });
}

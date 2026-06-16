import 'server-only';
import { NextResponse } from 'next/server';
import { compile, validateWorkflow } from '@/compiler';
import type { WorkflowDefinition } from '@synapcores/workflow-types';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params; // unused but must await
  const body = (await req.json()) as { definition: WorkflowDefinition };
  const validation = validateWorkflow(body.definition);
  if (!validation.valid) {
    return NextResponse.json(
      { error: 'Validation failed', issues: validation.issues },
      { status: 422 },
    );
  }
  const result = compile(body.definition);
  return NextResponse.json(result);
}

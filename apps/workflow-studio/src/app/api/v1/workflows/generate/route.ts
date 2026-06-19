import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { generateWorkflow } from '@/lib/build-with-ai/generate';
import { z } from 'zod';
import type { WorkflowDefinition } from '@synapcores/workflow-types';

const BodySchema = z.object({
  prompt: z.string().min(4).max(4000),
  previousWorkflow: z.unknown().optional(),
  refinement: z.string().max(2000).optional(),
});

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  // Auth — only signed-in users can invoke the generator (it consumes
  // engine LLM tokens against the studio's admin key).
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'bad request',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const result = await generateWorkflow({
    prompt: parsed.data.prompt,
    previousWorkflow: parsed.data.previousWorkflow as
      | WorkflowDefinition
      | undefined,
    refinement: parsed.data.refinement,
  });

  if (!result.ok) {
    // Surface 422 for "the LLM gave us something we can't use" — distinct
    // from 500 (engine down) and 400 (caller sent garbage).
    return NextResponse.json(
      {
        error: result.error,
        ...(process.env.NODE_ENV !== 'production' && result.raw
          ? { raw: result.raw.slice(0, 4000) }
          : {}),
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    workflow: result.workflow,
    summary: result.summary,
    warnings: result.warnings,
    ...(process.env.NODE_ENV !== 'production' && result.raw
      ? { raw: result.raw.slice(0, 8000) }
      : {}),
  });
}

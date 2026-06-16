import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as {
    decision: 'approved' | 'rejected';
    reason?: string;
  };

  if (!['approved', 'rejected'].includes(body.decision)) {
    return NextResponse.json(
      { error: 'decision must be approved or rejected' },
      { status: 400 },
    );
  }

  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);

  await client.sql(
    `UPDATE workflow_approval_queue SET state = $1, decided_at = CURRENT_TIMESTAMP, reason = $2 WHERE id = $3`,
    [body.decision, body.reason ?? null, id],
  );

  return NextResponse.json({ id, decision: body.decision });
}

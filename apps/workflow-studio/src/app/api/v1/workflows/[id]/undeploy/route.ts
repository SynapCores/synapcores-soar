import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);

  // Get last deploy objects
  let objects: { triggers: string[]; procedures: string[] } | null = null;
  try {
    const result = await client.sql<{ objects_json: string | null }>(
      `SELECT objects_json FROM workflow_deploys WHERE workflow_id = $1 ORDER BY deployed_at DESC LIMIT 1`,
      [id],
    );
    if (result.rows[0]?.objects_json) {
      objects = JSON.parse(result.rows[0].objects_json) as {
        triggers: string[];
        procedures: string[];
      };
    }
  } catch {
    // ignore
  }

  if (objects) {
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
  }

  await client.sql(
    `UPDATE workflow_definitions SET status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [id],
  );

  return NextResponse.json({ undeployed: true });
}

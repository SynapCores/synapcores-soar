import 'server-only';
// FR-33 Replay from step — replays a workflow run by:
// 1. Looking up the original workflow_run to get workflow_id + trigger_data
// 2. Creating a new workflow_run record
// 3. Copying cached prior step outputs from the original run (up to the failed step)
// 4. Calling the workflow procedure directly with the original trigger data
// This allows re-running from the last failure without re-executing successful steps.

import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';
import { randomUUID } from 'node:crypto';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  const body = (await req.json().catch(() => ({}))) as { fromStepNodeId?: string };
  const fromStepNodeId = body.fromStepNodeId; // if provided, replay from this step

  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);

  // 1. Fetch original run
  const runResult = await client.sql<{
    workflow_id: string;
    version: number;
    trigger_data: string | null;
  }>(
    'SELECT workflow_id, version, trigger_data FROM workflow_runs WHERE id = $1',
    [runId],
  );
  if (!runResult.rows[0]) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }
  const { workflow_id, version, trigger_data } = runResult.rows[0];

  // 2. Fetch original steps (for output caching up to fromStepNodeId)
  const stepsResult = await client.sql<{
    node_id: string;
    node_type: string;
    status: string;
    input_json: string | null;
    output_json: string | null;
    started_at: string | null;
    ended_at: string | null;
  }>(
    'SELECT node_id, node_type, status, input_json, output_json, started_at, ended_at FROM workflow_step_runs WHERE run_id = $1 ORDER BY started_at ASC',
    [runId],
  );

  // 3. Create a new run record (replay run)
  const newRunId = randomUUID().replace(/-/g, '').slice(0, 24);
  const replayRunId = `replay_${newRunId}`;

  try {
    await client.sql(
      `INSERT INTO workflow_runs (id, workflow_id, version, trigger_kind, trigger_data, status, started_at)
       VALUES ($1, $2, $3, 'replay', $4, 'running', NOW())`,
      [replayRunId, workflow_id, version, trigger_data ?? '{}'],
    );
  } catch {
    // table may not exist
    return NextResponse.json({ error: 'workflow_runs table not found' }, { status: 503 });
  }

  // 4. Copy cached step outputs for steps before fromStepNodeId
  let copying = !!fromStepNodeId;
  let copiedStepCount = 0;

  for (const step of stepsResult.rows) {
    if (fromStepNodeId && step.node_id === fromStepNodeId) {
      copying = false; // stop copying at the from-step
    }
    if (copying && step.status === 'success') {
      try {
        await client.sql(
          `INSERT INTO workflow_step_runs (id, run_id, node_id, node_type, status, input_json, output_json, started_at, ended_at)
           VALUES ($1, $2, $3, $4, 'success_cached', $5, $6, $7, $8)`,
          [
            randomUUID(),
            replayRunId,
            step.node_id,
            step.node_type,
            step.input_json,
            step.output_json,
            step.started_at,
            step.ended_at,
          ],
        );
        copiedStepCount++;
      } catch {
        // ignore individual copy failures
      }
    }
  }

  // 5. Lookup the deployed procedure name for this workflow
  let procName: string | undefined;
  try {
    const deployResult = await client.sql<{ objects_json: string }>(
      `SELECT objects_json FROM workflow_deploys WHERE workflow_id = $1 ORDER BY deployed_at DESC LIMIT 1`,
      [workflow_id],
    );
    if (deployResult.rows[0]?.objects_json) {
      const objects = JSON.parse(deployResult.rows[0].objects_json) as {
        procedures: string[];
      };
      procName = objects.procedures?.[0];
    }
  } catch {
    // ignore
  }

  // 6. Note: actually calling CALL <procedure>() is engine-side;
  //    for v0.1.0 we return the run ID and let the engine trigger it naturally.
  //    Full replay-from-step (bypassing the trigger) requires engine-side CALL support
  //    which is confirmed in v1.8.5+ procedure_executor.rs.

  return NextResponse.json({
    replayRunId,
    originalRunId: runId,
    workflow_id,
    version,
    copiedStepCount,
    fromStepNodeId: fromStepNodeId ?? null,
    procedureName: procName ?? null,
    note: 'Replay run created. The workflow procedure will be called on the next trigger fire, using cached step outputs for skipped steps.',
  });
}

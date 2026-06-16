import 'server-only';
import { NextResponse } from 'next/server';
import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

// HTTP_EGRESS_CALLOUT proxy executor
//
// Called by RunTimeline when it detects a step with status='pending_http'.
// Reads the input_json from workflow_step_runs, executes the HTTP call
// server-side (avoiding CORS / mixed-content issues), writes output_json
// and updates status to 'success' or 'error'.
//
// POST /api/v1/runs/[id]/execute-http
// Body: { stepId?: string }  — if omitted, executes ALL pending_http steps for run

interface PendingStep {
  id: string;
  run_id: string;
  node_id: string;
  input_json: string | null;
}

interface HttpCallSpec {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

async function executeHttpStep(step: PendingStep) {
  if (!step.input_json) {
    return { stepId: step.id, ok: false, error: 'no input_json' };
  }

  let spec: HttpCallSpec;
  try {
    spec = JSON.parse(step.input_json) as HttpCallSpec;
  } catch {
    return { stepId: step.id, ok: false, error: 'invalid input_json' };
  }

  if (!spec.url) {
    return { stepId: step.id, ok: false, error: 'no url in input_json' };
  }

  const controller = new AbortController();
  const timeoutMs = spec.timeoutMs ?? 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(spec.url, {
      method: spec.method || 'GET',
      headers: spec.headers,
      body: spec.body || undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let responseBody: unknown;
    try { responseBody = JSON.parse(text); } catch { responseBody = text; }

    return {
      stepId: step.id,
      ok: res.ok,
      statusCode: res.status,
      body: responseBody,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      stepId: step.id,
      ok: false,
      error: isTimeout ? `timeout after ${timeoutMs}ms` : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  const body = (await req.json().catch(() => ({}))) as { stepId?: string };

  const engine = await getDefaultEngine();
  if (!engine) return NextResponse.json({ error: 'No engine configured' }, { status: 503 });
  const client = getTargetEngineClient(engine);

  // Fetch pending_http steps for this run
  let pendingSteps: PendingStep[];
  try {
    const whereClause = body.stepId
      ? `WHERE id = '${body.stepId.replace(/'/g, "''")}' AND run_id = '${runId.replace(/'/g, "''")}'`
      : `WHERE run_id = '${runId.replace(/'/g, "''")}' AND status = 'pending_http'`;

    const result = await client.sql<PendingStep>(
      `SELECT id, run_id, node_id, input_json FROM workflow_step_runs ${whereClause}`,
    );
    pendingSteps = result.rows;
  } catch (err) {
    return NextResponse.json({ error: `Failed to query steps: ${String(err)}` }, { status: 500 });
  }

  if (pendingSteps.length === 0) {
    return NextResponse.json({ executed: 0, results: [] });
  }

  // Execute each HTTP call and update the step record
  const results = [];
  for (const step of pendingSteps) {
    const callResult = await executeHttpStep(step);
    const outputJson = JSON.stringify({
      statusCode: callResult.statusCode,
      body: callResult.body,
      error: callResult.error,
    });

    try {
      await client.sql(
        `UPDATE workflow_step_runs
         SET status = $1, output_json = $2, ended_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [callResult.ok ? 'success' : 'error', outputJson, step.id],
      );
    } catch {
      // Step update failure — record but don't abort
    }

    results.push(callResult);
  }

  return NextResponse.json({ executed: results.length, results });
}

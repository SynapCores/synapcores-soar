import 'server-only';
// SSE endpoint for live run event streaming — FR-31
// GET /api/v1/runs/stream?runId=<id>
// Polls workflow_step_runs every 500ms and pushes new events as SSE.
// Terminates when run status is no longer 'running'.

import { getDefaultEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

const POLL_INTERVAL_MS = 500;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes max

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');

  if (!runId) {
    return new Response('runId is required', { status: 400 });
  }

  const engine = await getDefaultEngine();
  if (!engine) {
    return new Response('No engine configured', { status: 503 });
  }

  const client = getTargetEngineClient(engine);
  const startTime = Date.now();

  // Build the SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      function push(data: unknown) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      function pushComment(msg: string) {
        controller.enqueue(enc.encode(`: ${msg}\n\n`));
      }

      const seen = new Set<string>(); // step IDs already emitted

      try {
        while (true) {
          // Check connection / timeout
          if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
            push({ type: 'timeout' });
            break;
          }

          // Fetch run status
          let runStatus: string | undefined;
          try {
            const runResult = await client.sql<{ status: string }>(
              'SELECT status FROM workflow_runs WHERE id = $1',
              [runId],
            );
            runStatus = runResult.rows[0]?.status;
          } catch {
            pushComment('engine-poll-error');
          }

          // Fetch new steps
          try {
            const stepsResult = await client.sql<{
              id: string;
              node_id: string;
              node_type: string;
              status: string;
              output_json: string | null;
              error: string | null;
              started_at: string | null;
              ended_at: string | null;
            }>(
              'SELECT id, node_id, node_type, status, output_json, error, started_at, ended_at FROM workflow_step_runs WHERE run_id = $1 ORDER BY started_at ASC',
              [runId],
            );

            for (const step of stepsResult.rows) {
              if (!seen.has(step.id)) {
                seen.add(step.id);
                push({
                  type: 'step_update',
                  runId,
                  stepId: step.id,
                  nodeId: step.node_id,
                  nodeType: step.node_type,
                  status: step.status,
                  outputJson: step.output_json,
                  error: step.error,
                  startedAt: step.started_at,
                  endedAt: step.ended_at,
                });
              } else if (step.status !== 'running') {
                // Update status for already-seen step
                push({
                  type: 'step_status',
                  runId,
                  stepId: step.id,
                  status: step.status,
                  outputJson: step.output_json,
                  error: step.error,
                  endedAt: step.ended_at,
                });
              }
            }
          } catch {
            pushComment('step-poll-error');
          }

          // Terminal states: stop polling
          if (runStatus && !['running', 'awaiting_approval'].includes(runStatus)) {
            push({ type: 'run_complete', runId, status: runStatus });
            break;
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch (err) {
        push({ type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}

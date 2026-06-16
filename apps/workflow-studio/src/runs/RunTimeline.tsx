'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, RotateCcw, Download, Wifi, WifiOff } from 'lucide-react';
import { Button, cn } from '@synapcores/app-framework';
import type { WorkflowRun, WorkflowStepRun } from '@synapcores/workflow-types';

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-blue-500',
  success: 'bg-green-500',
  error: 'bg-red-500',
  awaiting_approval: 'bg-yellow-500',
  cancelled: 'bg-slate-500',
  success_cached: 'bg-green-700',
  pending_http: 'bg-cyan-500',
};

const STATUS_TEXT: Record<string, string> = {
  running: 'text-blue-400',
  success: 'text-green-400',
  error: 'text-red-400',
  awaiting_approval: 'text-yellow-400',
  cancelled: 'text-slate-400',
  success_cached: 'text-green-600',
  pending_http: 'text-cyan-400',
};

function computeTimeline(steps: WorkflowStepRun[]) {
  const starts = steps.map((s) => s.startedAt ? new Date(s.startedAt).getTime() : null).filter(Boolean) as number[];
  const ends = steps.map((s) => s.endedAt ? new Date(s.endedAt).getTime() : null).filter(Boolean) as number[];
  if (!starts.length) return { earliest: 0, totalMs: 1 };
  const earliest = Math.min(...starts);
  const latest = ends.length ? Math.max(...ends) : earliest + 1;
  return { earliest, totalMs: Math.max(latest - earliest, 1) };
}

function getBarStyle(step: WorkflowStepRun, earliest: number, totalMs: number) {
  const start = step.startedAt ? new Date(step.startedAt).getTime() : earliest;
  const end = step.endedAt ? new Date(step.endedAt).getTime() : Date.now();
  const left = ((start - earliest) / totalMs) * 100;
  const width = Math.max(((end - start) / totalMs) * 100, 2);
  return { left: `${left}%`, width: `${width}%` };
}

interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
}

function parseToolCalls(outputJson: string | null): ToolCall[] {
  if (!outputJson) return [];
  try {
    const parsed = JSON.parse(outputJson) as { tool_calls?: ToolCall[] };
    return parsed.tool_calls ?? [];
  } catch {
    return [];
  }
}

function formatJson(raw: string | null): string {
  if (!raw) return '';
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
}

// ── StepDetail ────────────────────────────────────────────────────────────────

function StepDetail({ step, onReplayFrom }: { step: WorkflowStepRun; onReplayFrom: (nodeId: string) => void }) {
  const toolCalls = step.nodeType === 'AgentRun' ? parseToolCalls(step.outputJson) : [];
  const isHttpCallout = step.nodeType === 'HttpRequest';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Node</div>
          <div className="text-slate-300 font-mono text-sm">
            {step.nodeId} <span className="text-slate-500">({step.nodeType})</span>
          </div>
        </div>
        {step.status === 'error' && (
          <button
            onClick={() => onReplayFrom(step.nodeId)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-900/30 text-blue-400 border border-blue-800 rounded hover:bg-blue-900/50 transition-colors"
            title="Re-run from this step"
          >
            <RotateCcw className="h-3 w-3" />
            Replay from here
          </button>
        )}
      </div>

      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Status</div>
        <span className={cn('text-sm font-medium', STATUS_TEXT[step.status] ?? 'text-slate-400')}>
          {step.status}
          {(step.status as string) === 'success_cached' && <span className="ml-1 text-[10px] text-slate-600">(from cache)</span>}
          {(step.status as string) === 'pending_http' && <span className="ml-1 text-[10px] text-cyan-600">(awaiting proxy)</span>}
        </span>
      </div>

      {step.error && (
        <div>
          <div className="text-xs text-red-400 uppercase tracking-wide mb-1">Error</div>
          <pre className="text-xs text-red-300 bg-red-900/20 p-2 rounded overflow-auto max-h-32">
            {step.error}
          </pre>
        </div>
      )}

      {/* HTTP Callout detail */}
      {isHttpCallout && step.inputJson && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">HTTP Request Config</div>
          <pre className="text-xs text-slate-300 bg-slate-900 p-2 rounded overflow-auto max-h-48 border border-slate-800">
            {formatJson(step.inputJson)}
          </pre>
        </div>
      )}

      {!isHttpCallout && step.inputJson && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Input</div>
          <pre className="text-xs text-slate-300 bg-slate-900 p-2 rounded overflow-auto max-h-48 border border-slate-800">
            {formatJson(step.inputJson)}
          </pre>
        </div>
      )}

      {step.outputJson && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Output</div>
          <pre className="text-xs text-slate-300 bg-slate-900 p-2 rounded overflow-auto max-h-48 border border-slate-800">
            {formatJson(step.outputJson)}
          </pre>
        </div>
      )}

      {/* Tool-call drill-down for AgentRun (FR-32) */}
      {toolCalls.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Tool Calls</div>
          <div className="space-y-2">
            {toolCalls.map((tc, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded p-2">
                <div className="text-xs font-mono text-purple-400 mb-1">{tc.name}</div>
                {tc.arguments && (
                  <div>
                    <div className="text-[10px] text-slate-600 mb-0.5">Arguments</div>
                    <pre className="text-xs text-slate-400 overflow-auto max-h-24">
                      {JSON.stringify(tc.arguments, null, 2)}
                    </pre>
                  </div>
                )}
                {tc.result !== undefined && (
                  <div className="mt-1.5">
                    <div className="text-[10px] text-slate-600 mb-0.5">Result</div>
                    <pre className="text-xs text-green-400 overflow-auto max-h-24">
                      {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RunTimeline ────────────────────────────────────────────────────────────────

export function RunTimeline({ runId }: { runId: string }) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [steps, setSteps] = useState<WorkflowStepRun[]>([]);
  const [selectedStep, setSelectedStep] = useState<WorkflowStepRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'live' | 'done' | 'idle'>('idle');
  const sseRef = useRef<EventSource | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/runs/${runId}`);
      if (!res.ok) throw new Error('Not found');
      const data = (await res.json()) as { run: WorkflowRun; steps: WorkflowStepRun[] };
      setRun(data.run);
      setSteps(data.steps);
    } catch (err) {
      console.error('[RunTimeline] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // SSE live subscription for running runs
  useEffect(() => {
    if (!run || !['running', 'awaiting_approval'].includes(run.status)) {
      setSseStatus('idle');
      return;
    }

    setSseStatus('connecting');
    const es = new EventSource(`/api/v1/runs/stream?runId=${encodeURIComponent(runId)}`);
    sseRef.current = es;

    es.onopen = () => setSseStatus('live');

    es.onmessage = (event) => {
      let msg: { type: string; [key: string]: unknown };
      try { msg = JSON.parse(event.data as string) as { type: string; [key: string]: unknown }; }
      catch { return; }

      if (msg.type === 'step_update' || msg.type === 'step_status') {
        setSteps(prev => {
          const existing = prev.find(s => s.id === msg.stepId);
          if (existing) {
            return prev.map(s =>
              s.id === msg.stepId
                ? { ...s, status: msg.status as WorkflowStepRun['status'], outputJson: msg.outputJson as string ?? s.outputJson, endedAt: msg.endedAt as string ?? s.endedAt }
                : s,
            );
          }
          // New step
          return [...prev, {
            id: msg.stepId as string,
            runId,
            nodeId: msg.nodeId as string,
            nodeType: msg.nodeType as WorkflowStepRun['nodeType'],
            status: msg.status as WorkflowStepRun['status'],
            inputJson: null,
            outputJson: msg.outputJson as string ?? null,
            startedAt: msg.startedAt as string ?? null,
            endedAt: msg.endedAt as string ?? null,
            error: null,
          }];
        });
      }

      if (msg.type === 'run_complete') {
        setRun(prev => prev ? { ...prev, status: msg.status as WorkflowRun['status'] } : null);
        setSseStatus('done');
        es.close();
      }
    };

    es.onerror = () => {
      setSseStatus('idle');
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [run?.status, runId]);

  async function handleRerun() {
    setRerunning(true);
    try {
      await fetch(`/api/v1/runs/${runId}/replay`, { method: 'POST' });
      await loadData();
    } catch (err) {
      console.error('[RunTimeline] rerun error:', err);
    } finally {
      setRerunning(false);
    }
  }

  async function handleReplayFrom(nodeId: string) {
    setRerunning(true);
    try {
      await fetch(`/api/v1/runs/${runId}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromStepNodeId: nodeId }),
      });
      await loadData();
    } catch (err) {
      console.error('[RunTimeline] replay-from error:', err);
    } finally {
      setRerunning(false);
    }
  }

  function handleExport() {
    const payload = { run, steps };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run-${runId.slice(0, 8)}-full.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!run) {
    return <div className="mt-6 text-center text-slate-500 py-12">Run not found.</div>;
  }

  const { earliest, totalMs } = computeTimeline(steps);

  return (
    <div className="mt-6 space-y-6">
      {/* Run summary */}
      <div className="flex items-center gap-4 p-4 bg-slate-900 rounded-lg border border-slate-800">
        <div className="flex-1">
          <div className="text-xs text-slate-500 mb-1">Run Status</div>
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-medium', STATUS_TEXT[run.status] ?? 'text-slate-400')}>
              {run.status}
            </span>
            {/* SSE live indicator */}
            {sseStatus === 'live' && (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <Wifi className="h-3 w-3" />
                live
              </span>
            )}
            {sseStatus === 'connecting' && (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                <WifiOff className="h-3 w-3 animate-pulse" />
                connecting
              </span>
            )}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-xs text-slate-500 mb-1">Trigger</div>
          <span className="text-sm text-slate-300">{run.triggerKind ?? '—'}</span>
        </div>
        <div className="flex-1">
          <div className="text-xs text-slate-500 mb-1">Started</div>
          <span className="text-sm text-slate-300">
            {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRerun} disabled={rerunning}>
            <RotateCcw className={cn('h-4 w-4 mr-1.5', rerunning && 'animate-spin')} />
            Re-run
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Gantt chart */}
      {steps.length > 0 && (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">Step Timeline</h3>
            <span className="text-xs text-slate-600">{steps.length} steps</span>
          </div>
          <div className="p-4 space-y-3">
            {steps.map((step) => {
              const barStyle = getBarStyle(step, earliest, totalMs);
              const isSelected = selectedStep?.id === step.id;
              return (
                <div
                  key={step.id}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isSelected}
                  aria-label={`Step ${step.nodeType}: ${step.status}`}
                  className={cn(
                    'cursor-pointer rounded p-2 transition-colors outline-none focus:ring-1 focus:ring-blue-600',
                    isSelected ? 'bg-slate-800' : 'hover:bg-slate-900',
                  )}
                  onClick={() => setSelectedStep(isSelected ? null : step)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedStep(isSelected ? null : step)}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <ChevronRight
                      className={cn(
                        'h-3.5 w-3.5 text-slate-500 transition-transform',
                        isSelected && 'rotate-90',
                      )}
                    />
                    <span className="text-xs font-mono text-slate-400">{step.nodeType}</span>
                    <span className="text-xs text-slate-600">·</span>
                    <span className="text-xs text-slate-500">{step.nodeId.slice(0, 8)}</span>
                    <span
                      className={cn(
                        'ml-auto text-xs font-medium',
                        STATUS_TEXT[step.status] ?? 'text-slate-400',
                      )}
                    >
                      {step.status}
                    </span>
                  </div>
                  {/* Gantt bar */}
                  <div className="relative h-4 bg-slate-800 rounded overflow-hidden" role="presentation">
                    <div
                      className={cn(
                        'absolute top-0 h-full rounded opacity-80',
                        STATUS_COLOR[step.status] ?? 'bg-slate-500',
                      )}
                      style={barStyle}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step detail panel */}
      {selectedStep && (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">Step Detail</h3>
            <button
              onClick={() => setSelectedStep(null)}
              className="text-slate-500 hover:text-slate-300 text-xs"
            >
              Close
            </button>
          </div>
          <div className="p-4">
            <StepDetail step={selectedStep} onReplayFrom={handleReplayFrom} />
          </div>
        </div>
      )}

      {steps.length === 0 && (
        <div className="text-center text-slate-500 py-12">No steps recorded for this run.</div>
      )}
    </div>
  );
}

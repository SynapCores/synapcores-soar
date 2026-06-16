'use client';
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, RotateCcw, Download } from 'lucide-react';
import { Button, cn } from '@synapcores/app-framework';
import type { WorkflowRun, WorkflowStepRun } from '@synapcores/workflow-types';

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-blue-500',
  success: 'bg-green-500',
  error: 'bg-red-500',
  awaiting_approval: 'bg-yellow-500',
  cancelled: 'bg-slate-500',
};

const STATUS_TEXT: Record<string, string> = {
  running: 'text-blue-400',
  success: 'text-green-400',
  error: 'text-red-400',
  awaiting_approval: 'text-yellow-400',
  cancelled: 'text-slate-400',
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

function StepDetail({ step }: { step: WorkflowStepRun }) {
  const toolCalls = step.nodeType === 'AgentRun' ? parseToolCalls(step.outputJson) : [];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Node</div>
        <div className="text-slate-300 font-mono text-sm">
          {step.nodeId} <span className="text-slate-500">({step.nodeType})</span>
        </div>
      </div>
      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Status</div>
        <span className={cn('text-sm font-medium', STATUS_TEXT[step.status] ?? 'text-slate-400')}>
          {step.status}
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
      {step.inputJson && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Input</div>
          <pre className="text-xs text-slate-300 bg-slate-900 p-2 rounded overflow-auto max-h-48 border border-slate-800">
            {JSON.stringify(JSON.parse(step.inputJson), null, 2)}
          </pre>
        </div>
      )}
      {step.outputJson && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Output</div>
          <pre className="text-xs text-slate-300 bg-slate-900 p-2 rounded overflow-auto max-h-48 border border-slate-800">
            {JSON.stringify(JSON.parse(step.outputJson), null, 2)}
          </pre>
        </div>
      )}
      {toolCalls.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Tool Calls</div>
          <div className="space-y-2">
            {toolCalls.map((tc, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded p-2">
                <div className="text-xs font-mono text-purple-400 mb-1">{tc.name}</div>
                {tc.arguments && (
                  <pre className="text-xs text-slate-400 overflow-auto max-h-24">
                    {JSON.stringify(tc.arguments, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RunTimeline({ runId }: { runId: string }) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [steps, setSteps] = useState<WorkflowStepRun[]>([]);
  const [selectedStep, setSelectedStep] = useState<WorkflowStepRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);

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

  async function handleRerun() {
    setRerunning(true);
    try {
      await fetch(`/api/v1/runs/${runId}/rerun`, { method: 'POST' });
      await loadData();
    } catch (err) {
      console.error('[RunTimeline] rerun error:', err);
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
    return (
      <div className="mt-6 text-center text-slate-500 py-12">Run not found.</div>
    );
  }

  const { earliest, totalMs } = computeTimeline(steps);

  return (
    <div className="mt-6 space-y-6">
      {/* Run summary */}
      <div className="flex items-center gap-4 p-4 bg-slate-900 rounded-lg border border-slate-800">
        <div className="flex-1">
          <div className="text-xs text-slate-500 mb-1">Run Status</div>
          <span className={cn('text-sm font-medium', STATUS_TEXT[run.status] ?? 'text-slate-400')}>
            {run.status}
          </span>
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
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-medium text-slate-300">Step Timeline</h3>
          </div>
          <div className="p-4 space-y-3">
            {steps.map((step) => {
              const barStyle = getBarStyle(step, earliest, totalMs);
              const isSelected = selectedStep?.id === step.id;
              return (
                <div
                  key={step.id}
                  className={cn(
                    'cursor-pointer rounded p-2 transition-colors',
                    isSelected ? 'bg-slate-800' : 'hover:bg-slate-900',
                  )}
                  onClick={() => setSelectedStep(isSelected ? null : step)}
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
                  {/* Bar */}
                  <div className="relative h-4 bg-slate-800 rounded overflow-hidden">
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
            <StepDetail step={selectedStep} />
          </div>
        </div>
      )}

      {steps.length === 0 && (
        <div className="text-center text-slate-500 py-12">No steps recorded for this run.</div>
      )}
    </div>
  );
}

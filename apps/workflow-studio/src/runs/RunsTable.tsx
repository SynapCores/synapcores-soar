'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Download } from 'lucide-react';
import { Button, cn } from '@synapcores/app-framework';
import type { WorkflowRun } from '@synapcores/workflow-types';

type FilterType = 'all' | 'running' | 'success' | 'error';

const STATUS_BADGE: Record<string, string> = {
  running: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  success: 'bg-green-500/20 text-green-400 border border-green-500/40',
  error: 'bg-red-500/20 text-red-400 border border-red-500/40',
  awaiting_approval: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  cancelled: 'bg-slate-500/20 text-slate-400 border border-slate-500/40',
};

function getDuration(run: WorkflowRun): string {
  if (run.endedAt && run.startedAt) {
    const ms = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
    return Math.round(ms / 1000) + 's';
  }
  if (run.status === 'running') return 'Running...';
  return '—';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function exportRun(run: WorkflowRun) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `run-${run.id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-800">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-slate-800 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function RunsTable() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const router = useRouter();

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/runs');
      if (!res.ok) throw new Error('Failed to load runs');
      const data = (await res.json()) as WorkflowRun[];
      setRuns(data);
    } catch (err) {
      console.error('[RunsTable] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Poll every 5s while any run is running
  useEffect(() => {
    const interval = setInterval(() => {
      if (runs.some((r) => r.status === 'running')) {
        void loadRuns();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [runs, loadRuns]);

  const filtered = filter === 'all' ? runs : runs.filter((r) => r.status === filter);

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'running', label: 'Running' },
    { key: 'success', label: 'Success' },
    { key: 'error', label: 'Error' },
  ];

  return (
    <div className="mt-6">
      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1.5 rounded text-sm font-medium transition-colors',
              filter === key
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
            )}
          >
            {label}
            {key !== 'all' && (
              <span className="ml-1.5 text-xs opacity-70">
                ({runs.filter((r) => r.status === key).length})
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadRuns()}
          className="text-slate-400"
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Run ID</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Workflow</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Started</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Duration</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Status</th>
              <th className="px-4 py-3 text-left text-slate-400 font-medium">Export</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No runs found
                </td>
              </tr>
            ) : (
              filtered.map((run) => (
                <tr
                  key={run.id}
                  className="hover:bg-slate-900/60 cursor-pointer transition-colors"
                  onClick={() => router.push('/runs/' + run.id)}
                >
                  <td className="px-4 py-3 font-mono text-slate-300">
                    {run.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">
                    {run.workflowId ? run.workflowId.slice(0, 8) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {formatDate(run.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{getDuration(run)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-xs font-medium',
                        STATUS_BADGE[run.status] ?? STATUS_BADGE['cancelled'],
                      )}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        exportRun(run);
                      }}
                      className="h-7 text-slate-500 hover:text-slate-300"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

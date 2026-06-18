'use client';

import { AlertTriangle, AlertCircle, CheckCircle2, X } from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import { useShallow } from 'zustand/react/shallow';

export function ValidationPanel() {
  const { validationIssues, selectNode } = useWorkflowStore(useShallow((s) => ({
    validationIssues: s.validationIssues,
    selectNode: s.selectNode,
  })));

  if (validationIssues.length === 0) return null;

  const errors = validationIssues.filter((i) => i.severity === 'error');
  const warnings = validationIssues.filter((i) => i.severity === 'warning');

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-slate-700/80 bg-slate-900/95 backdrop-blur-sm max-h-48 overflow-y-auto">
      {/* Summary header */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-800 sticky top-0 bg-slate-900/95">
        {errors.length > 0 ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {errors.length} error{errors.length > 1 ? 's' : ''}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-semibold text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            No errors
          </span>
        )}
        {warnings.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-yellow-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {warnings.length} warning{warnings.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Issue list */}
      <div className="divide-y divide-slate-800/60">
        {validationIssues.map((issue, idx) => (
          <button
            key={idx}
            onClick={() => issue.nodeId && selectNode(issue.nodeId)}
            className={cn(
              'flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors',
              issue.nodeId
                ? 'hover:bg-slate-800/60 cursor-pointer'
                : 'cursor-default',
            )}
          >
            {issue.severity === 'error' ? (
              <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 mt-0.5 shrink-0" />
            )}
            <span
              className={cn(
                'text-xs flex-1',
                issue.severity === 'error' ? 'text-red-300' : 'text-yellow-300',
              )}
            >
              {issue.message}
            </span>
            {issue.nodeId && (
              <span className="text-[10px] font-mono text-slate-500 shrink-0 mt-0.5">
                {issue.nodeId.slice(0, 8)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

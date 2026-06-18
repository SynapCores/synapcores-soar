'use client';

import { useCallback } from 'react';
import { Copy, Download, X, Code2 } from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import { useShallow } from 'zustand/react/shallow';

export function SqlPreviewPane() {
  const { compiledSql, compiledAt, sqlPreviewOpen, toggleSqlPreview, workflowMeta } =
    useWorkflowStore(useShallow((s) => ({
      compiledSql: s.compiledSql,
      compiledAt: s.compiledAt,
      sqlPreviewOpen: s.sqlPreviewOpen,
      toggleSqlPreview: s.toggleSqlPreview,
      workflowMeta: s.workflowMeta,
    })));

  const copyToClipboard = useCallback(() => {
    if (compiledSql) {
      navigator.clipboard.writeText(compiledSql).catch(() => {});
    }
  }, [compiledSql]);

  const downloadSql = useCallback(() => {
    if (!compiledSql) return;
    const safeName = workflowMeta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const blob = new Blob([compiledSql], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName || 'workflow'}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  }, [compiledSql, workflowMeta.name]);

  if (!sqlPreviewOpen) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-30 flex flex-col w-[480px] bg-slate-950 border-l border-slate-700/60 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-blue-400" />
          <span className="text-xs font-semibold text-slate-200">Generated SQL</span>
          {compiledAt && (
            <span className="text-[10px] text-slate-500">
              compiled {new Date(compiledAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {compiledSql && (
            <>
              <button
                onClick={copyToClipboard}
                title="Copy SQL"
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
              <button
                onClick={downloadSql}
                title="Download .sql"
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
              >
                <Download className="h-3 w-3" />
                Download
              </button>
            </>
          )}
          <button
            onClick={() => toggleSqlPreview(false)}
            className="ml-1 text-slate-500 hover:text-slate-300 transition-colors p-1"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {compiledSql ? (
          <pre className="h-full overflow-auto p-4 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre">
            {compiledSql}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
            <Code2 className="h-8 w-8 text-slate-700" />
            <p className="text-sm text-slate-500">No SQL compiled yet.</p>
            <p className="text-xs text-slate-600">
              Click <span className="font-semibold text-slate-400">Compile</span> in the toolbar to generate SQL for this workflow.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

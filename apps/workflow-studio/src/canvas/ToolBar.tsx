'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Plus,
  FolderOpen,
  Undo2,
  Redo2,
  CheckCircle2,
  Code2,
  Eye,
  Rocket,
  StopCircle,
  LayoutTemplate,
  AlertCircle,
  Loader2,
  FlaskConical,
  GitMerge,
  Play,
  Lock,
  Unlock,
} from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import { useShallow } from 'zustand/react/shallow';
import { validateWorkflow } from '@/compiler/validate';
import type { WorkflowDefinition } from '@synapcores/workflow-types';

// ── Divider helper ────────────────────────────────────────────────────────────

function Divider() {
  return <div className="w-px h-5 bg-slate-700 mx-0.5" />;
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function TBtn({
  onClick,
  icon,
  label,
  disabled = false,
  variant = 'default',
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'default' &&
          'text-slate-300 hover:text-slate-100 hover:bg-slate-700/60',
        variant === 'primary' &&
          'text-blue-300 hover:text-blue-100 hover:bg-blue-900/40',
        variant === 'danger' &&
          'text-red-400 hover:text-red-200 hover:bg-red-900/30',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-300',
  compiled: 'bg-blue-900/50 text-blue-300',
  deployed: 'bg-green-900/50 text-green-300',
  archived: 'bg-orange-900/50 text-orange-300',
};

// ── Main toolbar ──────────────────────────────────────────────────────────────

export function ToolBar() {
  const store = useWorkflowStore(useShallow((s) => s));
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Validate ──────────────────────────────────────────────────────────────
  const handleValidate = useCallback(() => {
    const def: WorkflowDefinition = {
      id: store.workflowId,
      version: store.version,
      meta: store.workflowMeta,
      nodes: store.nodes,
      edges: store.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.setIsValidating(true);
    try {
      const result = validateWorkflow(def);
      store.setValidationIssues(result.issues);
    } finally {
      store.setIsValidating(false);
    }
  }, [store]);

  // ── Compile ───────────────────────────────────────────────────────────────
  const handleCompile = useCallback(async () => {
    const def: WorkflowDefinition = {
      id: store.workflowId,
      version: store.version,
      meta: store.workflowMeta,
      nodes: store.nodes,
      edges: store.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const res = await fetch(`/api/v1/workflows/${store.workflowId}/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(def),
      });
      if (res.ok) {
        const data = await res.json() as { sql: string; compiledAt?: string };
        store.setCompiledSql(data.sql, data.compiledAt);
        store.toggleSqlPreview(true);
      }
    } catch {
      // compile API unavailable — silently ignore
    }
  }, [store]);

  // ── Import workflow JSON ──────────────────────────────────────────────────
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const def = JSON.parse(ev.target?.result as string) as WorkflowDefinition;
        store.loadWorkflow(def);
      } catch {
        // invalid JSON — ignore
      }
    };
    reader.readAsText(file);
    // Reset so same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [store]);

  // ── Save (⌘S) ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaveState('saving');
    const def: WorkflowDefinition = {
      id: store.workflowId,
      version: store.version,
      meta: store.workflowMeta,
      nodes: store.nodes,
      edges: store.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch(`/api/v1/workflows/${store.workflowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(def),
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('idle');
    }
  }, [store]);

  // ── Test mode ─────────────────────────────────────────────────────────────
  const handleTest = useCallback(async () => {
    const def: WorkflowDefinition = {
      id: store.workflowId,
      version: store.version,
      meta: store.workflowMeta,
      nodes: store.nodes,
      edges: store.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await fetch(`/api/v1/workflows/${store.workflowId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: def, sampleData: store.sampleData }),
    }).catch(() => {});
  }, [store]);

  // ── Export workflow JSON ──────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const def: WorkflowDefinition = {
      id: store.workflowId,
      version: store.version,
      meta: store.workflowMeta,
      nodes: store.nodes,
      edges: store.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${store.workflowMeta.name.replace(/\s+/g, '_')}-v${store.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [store]);

  // ── Deploy / undeploy ─────────────────────────────────────────────────────
  const handleDeploy = useCallback(async () => {
    const def: WorkflowDefinition = {
      id: store.workflowId,
      version: store.version,
      meta: store.workflowMeta,
      nodes: store.nodes,
      edges: store.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await fetch(`/api/v1/workflows/${store.workflowId}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(def),
    }).catch(() => {});
  }, [store]);

  const errorCount = store.validationIssues.filter((i) => i.severity === 'error').length;
  const warnCount = store.validationIssues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 bg-slate-900/95 backdrop-blur border-b border-slate-700/60 min-h-[44px]">
      {/* Workflow name + status */}
      <div className="flex items-center gap-2 mr-2 min-w-0">
        <input
          value={store.workflowMeta.name}
          onChange={(e) => store.setWorkflowMeta({ name: e.target.value })}
          className="text-sm font-semibold bg-transparent border-none text-slate-100 focus:outline-none focus:bg-slate-800 rounded px-1 py-0.5 min-w-0 max-w-[200px] truncate"
          placeholder="Untitled Workflow"
        />
        {store.isDirty && (
          <span className="text-[10px] text-slate-500" title="Unsaved changes">•</span>
        )}
        <span
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded font-medium',
            STATUS_STYLES[store.status] ?? STATUS_STYLES.draft,
          )}
        >
          {store.status}
        </span>
      </div>

      <Divider />

      {/* New / Import / Export / Templates */}
      <TBtn onClick={store.newWorkflow} icon={<Plus className="h-3.5 w-3.5" />} label="New" />
      <TBtn
        onClick={() => fileInputRef.current?.click()}
        icon={<FolderOpen className="h-3.5 w-3.5" />}
        label="Import"
        title="Import workflow JSON"
      />
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
      <TBtn
        onClick={handleExport}
        icon={<FolderOpen className="h-3.5 w-3.5 rotate-180" />}
        label="Export"
        title="Export workflow as JSON"
      />
      <TBtn
        onClick={() => store.toggleTemplateGallery(true)}
        icon={<LayoutTemplate className="h-3.5 w-3.5" />}
        label="Templates"
      />

      <Divider />

      {/* Undo / Redo */}
      <TBtn
        onClick={store.undo}
        icon={<Undo2 className="h-3.5 w-3.5" />}
        label="Undo"
        disabled={store.historyIndex <= 0}
        title="Undo (Ctrl+Z)"
      />
      <TBtn
        onClick={store.redo}
        icon={<Redo2 className="h-3.5 w-3.5" />}
        label="Redo"
        disabled={store.historyIndex >= store.history.length - 1}
        title="Redo (Ctrl+Y)"
      />

      <Divider />

      {/* Validate */}
      <button
        onClick={handleValidate}
        disabled={store.isValidating}
        title="Validate workflow"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
          errorCount > 0
            ? 'text-red-400 hover:bg-red-900/30'
            : warnCount > 0
            ? 'text-yellow-400 hover:bg-yellow-900/20'
            : 'text-green-400 hover:bg-green-900/20',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        {store.isValidating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : errorCount > 0 ? (
          <AlertCircle className="h-3.5 w-3.5" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">Validate</span>
        {(errorCount > 0 || warnCount > 0) && (
          <span className="text-[10px] font-mono">
            {errorCount > 0 ? `${errorCount}E` : ''}
            {warnCount > 0 ? ` ${warnCount}W` : ''}
          </span>
        )}
      </button>

      {/* Compile */}
      <TBtn
        onClick={handleCompile}
        icon={<Code2 className="h-3.5 w-3.5" />}
        label="Compile"
        variant="primary"
        title="Compile to SQL"
      />

      {/* SQL Preview */}
      <TBtn
        onClick={() => store.toggleSqlPreview()}
        icon={<Eye className="h-3.5 w-3.5" />}
        label="SQL"
        disabled={!store.compiledSql}
        title="Preview generated SQL"
      />

      <Divider />

      {/* Test / Sample Data / Output Mapping */}
      <TBtn
        onClick={handleTest}
        icon={<Play className="h-3.5 w-3.5" />}
        label="Test"
        title="Run in test mode with sample data"
      />
      <TBtn
        onClick={() => store.toggleSampleDataEditor(true)}
        icon={<FlaskConical className="h-3.5 w-3.5" />}
        label="Fixtures"
        title="Edit sample data fixtures (FR-37)"
      />
      <TBtn
        onClick={() => store.toggleOutputMapping(true)}
        icon={<GitMerge className="h-3.5 w-3.5" />}
        label="Mapping"
        title="Configure output mappings (FR-38)"
      />

      <Divider />

      {/* Deploy / Undeploy */}
      <TBtn
        onClick={handleDeploy}
        icon={<Rocket className="h-3.5 w-3.5" />}
        label="Deploy"
        variant="primary"
        title="Deploy workflow to engine"
      />
      {store.status === 'deployed' && (
        <TBtn
          onClick={async () => {
            await fetch(`/api/v1/workflows/${store.workflowId}/undeploy`, { method: 'POST' }).catch(() => {});
          }}
          icon={<StopCircle className="h-3.5 w-3.5" />}
          label="Undeploy"
          variant="danger"
        />
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Save button with visual feedback */}
      <button
        onClick={() => void handleSave()}
        title="Save workflow (Ctrl+S)"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
          saveState === 'saved'
            ? 'text-green-400 hover:bg-green-900/20'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/60',
        )}
      >
        {saveState === 'saving' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : saveState === 'saved' ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <GitMerge className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">
          {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : 'Save'}
        </span>
      </button>

      {/* Read-only toggle */}
      <button
        onClick={() => store.setReadOnly(!store.readOnly)}
        title={store.readOnly ? 'Exit read-only mode' : 'Enter read-only mode (audit view)'}
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded text-xs transition-colors',
          store.readOnly
            ? 'text-amber-400 bg-amber-900/20 hover:bg-amber-900/30'
            : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800/40',
        )}
        aria-pressed={store.readOnly}
        aria-label={store.readOnly ? 'Exit read-only mode' : 'Enter read-only mode'}
      >
        {store.readOnly ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
      </button>

      {/* Engine status chip */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 border border-slate-700/60">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            store.engineConnected ? 'bg-green-400' : 'bg-red-400',
          )}
        />
        <span className="text-[10px] text-slate-400">
          {store.engineConnected ? store.activeEngineId : 'disconnected'}
        </span>
      </div>
    </div>
  );
}

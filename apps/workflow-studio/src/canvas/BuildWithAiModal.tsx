'use client';

import { useCallback, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, Check, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import type { WorkflowDefinition } from '@synapcores/workflow-types';

// ── A small set of starter prompts to seed the input ──────────────────────────

const EXAMPLES: { label: string; prompt: string }[] = [
  {
    label: 'Fraud routing',
    prompt:
      'When a new row lands in `orders` with status = "flagged", call our fraud scoring API at https://fraud.example.com/v1/score and route high-risk (>0.8) results to manual approval.',
  },
  {
    label: 'Daily summary',
    prompt:
      'Once a day at 9am, recall the last 5 user complaints from the "support" memory namespace, summarize them with the LLM into 3 bullet points, and post the summary to a Slack webhook.',
  },
  {
    label: 'Customer onboarding',
    prompt:
      'When a new row is inserted into `customers`, store a welcome note in the "onboarding" memory namespace, then call our welcome-email API to send the kickoff email.',
  },
];

// ── API result shape ──────────────────────────────────────────────────────────

interface GenerateOk {
  workflow: WorkflowDefinition;
  summary: string;
  warnings: string[];
}

interface GenerateErr {
  error: string;
}

type View = 'input' | 'loading' | 'preview' | 'error';

// ── Modal ─────────────────────────────────────────────────────────────────────

export function BuildWithAiModal() {
  const { open, close, isDirty, loadWorkflow } = useWorkflowStore(
    useShallow((s) => ({
      open: s.buildWithAiOpen,
      close: () => s.toggleBuildWithAi(false),
      isDirty: s.isDirty,
      loadWorkflow: s.loadWorkflow,
    })),
  );

  const [view, setView] = useState<View>('input');
  const [prompt, setPrompt] = useState('');
  const [refinement, setRefinement] = useState('');
  const [result, setResult] = useState<GenerateOk | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset when the modal closes so a fresh open doesn't show stale state.
  const handleClose = useCallback(() => {
    close();
    // Defer state reset slightly so the closing animation isn't jarring.
    setTimeout(() => {
      setView('input');
      setPrompt('');
      setRefinement('');
      setResult(null);
      setErrorMsg(null);
    }, 150);
  }, [close]);

  const handleGenerate = useCallback(
    async (body: {
      prompt: string;
      previousWorkflow?: WorkflowDefinition;
      refinement?: string;
    }) => {
      setView('loading');
      setErrorMsg(null);
      try {
        const res = await fetch('/api/v1/workflows/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = (await res.json()) as GenerateOk;
          setResult(data);
          setView('preview');
          return;
        }
        const err = (await res.json().catch(() => ({}))) as Partial<GenerateErr>;
        setErrorMsg(err.error ?? `Request failed (${res.status})`);
        setView('error');
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'Network error.');
        setView('error');
      }
    },
    [],
  );

  const handleApply = useCallback(() => {
    if (!result) return;
    if (isDirty) {
      const confirmed = window.confirm(
        'Your canvas has unsaved changes that will be replaced by the generated workflow. Continue?',
      );
      if (!confirmed) return;
    }
    loadWorkflow(result.workflow);
    handleClose();
  }, [result, isDirty, loadWorkflow, handleClose]);

  const handleRefine = useCallback(() => {
    if (!result || !refinement.trim()) return;
    void handleGenerate({
      prompt,
      previousWorkflow: result.workflow,
      refinement: refinement.trim(),
    });
    setRefinement('');
  }, [result, refinement, prompt, handleGenerate]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <div className="flex items-center gap-2 text-slate-100">
            <Sparkles className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold">Build with AI</h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="p-5">
          {view === 'input' && (
            <InputView
              prompt={prompt}
              setPrompt={setPrompt}
              onGenerate={() => handleGenerate({ prompt })}
            />
          )}
          {view === 'loading' && <LoadingView />}
          {view === 'preview' && result && (
            <PreviewView
              result={result}
              refinement={refinement}
              setRefinement={setRefinement}
              onRefine={handleRefine}
              onApply={handleApply}
              onStartOver={() => setView('input')}
            />
          )}
          {view === 'error' && (
            <ErrorView
              error={errorMsg ?? 'Unknown error.'}
              onRetry={() => setView('input')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Input view ────────────────────────────────────────────────────────────────

function InputView({
  prompt,
  setPrompt,
  onGenerate,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  onGenerate: () => void;
}) {
  const canSubmit = prompt.trim().length >= 4;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium text-slate-300 mb-1.5">
          Describe the workflow you want to build
        </label>
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
              e.preventDefault();
              onGenerate();
            }
          }}
          rows={6}
          placeholder="When a new row lands in `orders` with status='flagged', call our fraud scoring API and route high-risk (>0.8) to manual approval."
          className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Cmd/Ctrl+Enter to generate. Be specific about tables, triggers,
          external endpoints, and conditions.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">
          Or pick an example:
        </label>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => setPrompt(ex.prompt)}
              className="rounded border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-xs text-slate-300 hover:border-blue-600 hover:bg-blue-900/30 hover:text-blue-200"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onGenerate}
          disabled={!canSubmit}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium',
            canSubmit
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'cursor-not-allowed bg-slate-700 text-slate-400',
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate
        </button>
      </div>
    </div>
  );
}

// ── Loading view ──────────────────────────────────────────────────────────────

function LoadingView() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-slate-300">
      <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      <div className="text-sm">Designing your workflow…</div>
      <div className="text-xs text-slate-500">
        Native models take ~10–20s; cloud providers are usually faster.
      </div>
    </div>
  );
}

// ── Preview view ──────────────────────────────────────────────────────────────

function PreviewView({
  result,
  refinement,
  setRefinement,
  onRefine,
  onApply,
  onStartOver,
}: {
  result: GenerateOk;
  refinement: string;
  setRefinement: (v: string) => void;
  onRefine: () => void;
  onApply: () => void;
  onStartOver: () => void;
}) {
  const { workflow, warnings } = result;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">
          {workflow.meta.name}
        </h3>
        {workflow.meta.description && (
          <p className="mt-0.5 text-xs text-slate-400">
            {workflow.meta.description}
          </p>
        )}
      </div>

      {/* Node + edge list (compact text preview — visual canvas comes after Apply) */}
      <div className="max-h-64 overflow-auto rounded border border-slate-700 bg-slate-950 p-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Nodes ({workflow.nodes.length})
        </div>
        <ul className="space-y-1 text-xs text-slate-200">
          {workflow.nodes.map((n) => (
            <li key={n.id} className="flex items-start gap-2">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-blue-300">
                {n.data.nodeType}
              </span>
              <span className="text-slate-300">{n.data.label}</span>
            </li>
          ))}
        </ul>
        <div className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Edges ({workflow.edges.length})
        </div>
        <ul className="space-y-0.5 text-[11px] font-mono text-slate-400">
          {workflow.edges.map((e) => {
            const fromNode = workflow.nodes.find((n) => n.id === e.source);
            const toNode = workflow.nodes.find((n) => n.id === e.target);
            return (
              <li key={e.id}>
                {fromNode?.data.label ?? '?'} → {toNode?.data.label ?? '?'}
                {e.label && (
                  <span className="ml-1 text-amber-400">[{e.label}]</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {warnings.length > 0 && (
        <div className="rounded border border-amber-700/40 bg-amber-900/20 p-2.5 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings ({warnings.length})
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-amber-200/80">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Refine input */}
      <div className="rounded border border-slate-700 bg-slate-800/40 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1">
          Refine
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && refinement.trim()) {
                e.preventDefault();
                onRefine();
              }
            }}
            placeholder="e.g. use Postgres dialect, or add a retry on the API call"
            className="flex-1 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={onRefine}
            disabled={!refinement.trim()}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium',
              refinement.trim()
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'cursor-not-allowed bg-slate-700 text-slate-400',
            )}
          >
            Refine
          </button>
        </div>
      </div>

      <div className="flex justify-between gap-2 pt-1">
        <button
          onClick={onStartOver}
          className="rounded px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Start over
        </button>
        <button
          onClick={onApply}
          className="inline-flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
        >
          <Check className="h-3.5 w-3.5" />
          Apply to canvas
        </button>
      </div>
    </div>
  );
}

// ── Error view ────────────────────────────────────────────────────────────────

function ErrorView({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-red-700/40 bg-red-900/20 p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-red-300">
          <AlertTriangle className="h-4 w-4" />
          Generation failed
        </div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-red-200/80">
          {error}
        </pre>
      </div>
      <p className="text-xs text-slate-400">
        Try rewriting the prompt with more specific table names, conditions,
        and endpoints. The native LLM is more reliable with concrete details.
      </p>
      <div className="flex justify-end">
        <button
          onClick={onRetry}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

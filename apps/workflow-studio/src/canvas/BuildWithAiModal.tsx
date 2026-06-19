'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Wand2,
  WifiOff,
  Code,
} from 'lucide-react';
import { cn } from '@synapcores/app-framework/ui';
import { useWorkflowStore } from '@/store/workflow-store';
import type { WorkflowDefinition } from '@synapcores/workflow-types';
import {
  classifyError,
  groupWarnings,
  suggestRefinements,
  type WarningGroup,
  type WarningSeverity,
} from '@/lib/build-with-ai/categorize';

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
  /** Raw LLM output — only present in dev. */
  raw?: string;
}

interface GenerateErr {
  error: string;
  /** Raw LLM output — only present in dev when relevant. */
  raw?: string;
}

type View = 'input' | 'loading' | 'preview' | 'error';

// ── Modal ─────────────────────────────────────────────────────────────────────

export function BuildWithAiModal() {
  const open = useWorkflowStore((s) => s.buildWithAiOpen);
  const toggleBuildWithAi = useWorkflowStore((s) => s.toggleBuildWithAi);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const close = useCallback(() => toggleBuildWithAi(false), [toggleBuildWithAi]);

  const [view, setView] = useState<View>('input');
  const [prompt, setPrompt] = useState('');
  const [refinement, setRefinement] = useState('');
  const [result, setResult] = useState<GenerateOk | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorRaw, setErrorRaw] = useState<string | null>(null);

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
      setErrorRaw(null);
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
      setErrorRaw(null);
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
        setErrorRaw(err.raw ?? null);
        setView('error');
      } catch (e) {
        // Distinct from the LLM/422 path — the request itself didn't get a
        // response, so the engine is unreachable / studio API is down.
        setErrorMsg(
          'Engine call failed: ' +
            (e instanceof Error ? e.message : 'Network error.'),
        );
        setErrorRaw(null);
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
              raw={errorRaw}
              prompt={prompt}
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

      <StructuralSanity workflow={workflow} warnings={warnings} />
      <WarningsPanel warnings={warnings} />
      <SuggestedRefinements warnings={warnings} onPick={setRefinement} />

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

// ── Structural sanity strip — shown at the top of the preview ───────────────

function StructuralSanity({
  workflow,
  warnings,
}: {
  workflow: WorkflowDefinition;
  warnings: string[];
}) {
  const triggers = workflow.nodes.filter(
    (n) => n.data.nodeType === 'RowEventTrigger',
  ).length;
  const returns = workflow.nodes.filter(
    (n) => n.data.nodeType === 'Return',
  ).length;
  const groups = useMemo(() => groupWarnings(warnings), [warnings]);
  const errorCount = groups.filter((g) => g.primary.severity === 'error').length;
  const warnCount = groups.filter((g) => g.primary.severity === 'warn').length;
  const infoCount = groups.filter((g) => g.primary.severity === 'info').length;
  const Chip = ({ ok, label }: { ok: boolean; label: string }) => (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
        ok
          ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/40'
          : 'bg-red-900/30 text-red-300 border border-red-700/40',
      )}
    >
      {ok ? (
        <Check className="h-2.5 w-2.5" />
      ) : (
        <AlertCircle className="h-2.5 w-2.5" />
      )}
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-700 bg-slate-800/30 px-3 py-2 text-[11px] text-slate-300">
      <span className="font-mono text-slate-400">{workflow.nodes.length}n / {workflow.edges.length}e</span>
      <span className="text-slate-600">·</span>
      <Chip ok={triggers === 1} label={`${triggers} trigger`} />
      <Chip ok={returns >= 1} label={`${returns} return${returns === 1 ? '' : 's'}`} />
      {errorCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded border border-red-700/40 bg-red-900/30 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
          <AlertCircle className="h-2.5 w-2.5" />
          {errorCount} error{errorCount === 1 ? '' : 's'}
        </span>
      )}
      {warnCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded border border-amber-700/40 bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          <AlertTriangle className="h-2.5 w-2.5" />
          {warnCount} warning{warnCount === 1 ? '' : 's'}
        </span>
      )}
      {infoCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/40 px-1.5 py-0.5 text-[10px] text-slate-400">
          <Info className="h-2.5 w-2.5" />
          {infoCount} info
        </span>
      )}
    </div>
  );
}

// ── Warnings panel — grouped + dedup'd by root cause ────────────────────────

const SEV_STYLES: Record<WarningSeverity, string> = {
  error: 'border-red-700/40 bg-red-900/15',
  warn: 'border-amber-700/40 bg-amber-900/15',
  info: 'border-slate-700 bg-slate-800/30',
};
const SEV_TEXT: Record<WarningSeverity, string> = {
  error: 'text-red-300',
  warn: 'text-amber-300',
  info: 'text-slate-400',
};

function SevIcon({ severity }: { severity: WarningSeverity }) {
  const cls = cn('h-3.5 w-3.5', SEV_TEXT[severity]);
  if (severity === 'error') return <AlertCircle className={cls} />;
  if (severity === 'warn') return <AlertTriangle className={cls} />;
  return <Info className={cls} />;
}

function WarningGroupRow({ group }: { group: WarningGroup }) {
  const [open, setOpen] = useState(false);
  const hasCascade = group.cascadeCount > 0;
  return (
    <li
      className={cn(
        'rounded border px-2.5 py-1.5 text-[11px]',
        SEV_STYLES[group.primary.severity],
      )}
    >
      <div className="flex items-start gap-1.5">
        <SevIcon severity={group.primary.severity} />
        <div className="flex-1 min-w-0">
          <div className={cn('break-words', SEV_TEXT[group.primary.severity])}>
            {group.primary.message}
          </div>
          {hasCascade && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
            >
              {open ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {group.cascadeCount} cascading edge{group.cascadeCount === 1 ? '' : 's'} dropped
            </button>
          )}
          {hasCascade && open && (
            <ul className="mt-1 ml-3 space-y-0.5 text-[10px] text-slate-500">
              {group.cascadeMessages.map((m, i) => (
                <li key={i} className="break-words">↳ {m}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function WarningsPanel({ warnings }: { warnings: string[] }) {
  const groups = useMemo(() => groupWarnings(warnings), [warnings]);
  if (groups.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {groups.map((g, i) => (
        <WarningGroupRow key={i} group={g} />
      ))}
    </ul>
  );
}

// ── Suggested refinements derived from the active warnings ──────────────────

function SuggestedRefinements({
  warnings,
  onPick,
}: {
  warnings: string[];
  onPick: (text: string) => void;
}) {
  const suggestions = useMemo(() => suggestRefinements(warnings), [warnings]);
  if (suggestions.length === 0) return null;
  return (
    <div className="rounded border border-blue-700/40 bg-blue-900/15 p-2.5 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium uppercase tracking-wide text-[10px] text-blue-300">
        <Wand2 className="h-3 w-3" />
        Suggested refinements
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onPick(s.instruction)}
            className="rounded border border-blue-700/50 bg-blue-900/30 px-2 py-1 text-[10px] text-blue-200 hover:border-blue-500 hover:bg-blue-800/40"
            title={s.instruction}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-slate-500">
        Click any suggestion to drop the full instruction into the Refine box below; edit if needed, then Refine.
      </p>
    </div>
  );
}

// ── Error view ────────────────────────────────────────────────────────────────

function ErrorView({
  error,
  raw,
  prompt,
  onRetry,
}: {
  error: string;
  raw: string | null;
  prompt: string;
  onRetry: () => void;
}) {
  const classified = useMemo(() => classifyError(error), [error]);
  const [showRaw, setShowRaw] = useState(false);
  const Icon =
    classified.kind === 'engine'
      ? WifiOff
      : classified.kind === 'parse'
        ? Code
        : classified.kind === 'schema'
          ? AlertCircle
          : classified.kind === 'llm-bail'
            ? Wand2
            : AlertTriangle;
  // Dev-only — the API only attaches raw when NODE_ENV !== 'production'.
  const isDev = !!raw;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-red-700/40 bg-red-900/20 p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-red-300">
          <Icon className="h-4 w-4" />
          {classified.title}
        </div>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-red-200/80">
          {error}
        </pre>
      </div>
      <p className="text-xs text-slate-400">{classified.hint}</p>
      {prompt && (
        <div className="rounded border border-slate-700 bg-slate-800/30 p-2.5 text-[11px]">
          <div className="mb-1 font-medium uppercase tracking-wide text-[10px] text-slate-500">
            Your prompt
          </div>
          <div className="text-slate-300 italic break-words">
            &ldquo;{prompt}&rdquo;
          </div>
        </div>
      )}
      {isDev && raw && (
        <div>
          <button
            onClick={() => setShowRaw((s) => !s)}
            className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
          >
            {showRaw ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Raw LLM output (dev only)
          </button>
          {showRaw && (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-700 bg-slate-950 p-2 text-[10px] text-slate-400">
              {raw}
            </pre>
          )}
        </div>
      )}
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

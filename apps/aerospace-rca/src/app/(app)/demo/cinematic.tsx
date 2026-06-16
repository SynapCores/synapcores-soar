'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@synapcores/app-framework';
import type { AgentFinding, EvidenceChainEntry, SimilarAnomaly } from '@/lib/types';
import { GraphPanel } from './graph-panel';

const TODAY_ID = 'ANM-2026-BE4-027';

type ActIndex = 0 | 1 | 2 | 3 | 4 | 5;

interface ActConfig {
  id: ActIndex;
  title: string;
  caption: string;
  durationMs: number;
}

const ACTS: ActConfig[] = [
  {
    id: 1,
    title: '06:14:23 UTC · BE-4 hot-fire stand 4',
    caption: 'Every anomaly becomes a vector the instant it lands.',
    durationMs: 12000,
  },
  {
    id: 2,
    title: 'Semantic recall across 28 months of test history',
    caption: '4 prior matches. One on BE-3 — heritage engine — that a SharePoint search would never have linked.',
    durationMs: 14000,
  },
  {
    id: 3,
    title: 'Graph reveals the supplier-batch fingerprint',
    caption: 'The supplier was already on a re-cert. We just did not propagate it to two other programs.',
    durationMs: 16000,
  },
  {
    id: 4,
    title: 'Agent finds the bureaucracy fault line',
    caption: 'An agent in the database found in seconds what bureaucracy failed to surface in 13 months.',
    durationMs: 16000,
  },
  {
    id: 5,
    title: 'Tamper-evident evidence spine',
    caption:
      'One database. Vectors caught the pattern. Graph revealed the supplier. Agent surfaced the bureaucracy. Immutable audit makes it FAA-defensible.',
    durationMs: 12000,
  },
];

interface TodayAnomalyState {
  id: string;
  status: 'pending' | 'ingesting' | 'ingested' | 'error';
  message?: string;
}

interface DemoState {
  act: ActIndex;
  startedAt: number | null;
  today: TodayAnomalyState;
  similar: SimilarAnomaly[];
  reliability: AgentFinding | null;
  safety: AgentFinding | null;
  evidence: (EvidenceChainEntry & { prev_hash: string; hash: string })[];
  graphReady: boolean;
}

const INITIAL: DemoState = {
  act: 0,
  startedAt: null,
  today: { id: TODAY_ID, status: 'pending' },
  similar: [],
  reliability: null,
  safety: null,
  evidence: [],
  graphReady: false,
};

export function DemoCinematic() {
  const [state, setState] = useState<DemoState>(INITIAL);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const resetTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  const reset = useCallback(async () => {
    resetTimers();
    setState(INITIAL);
    await fetch('/api/v1/demo/reset', { method: 'POST' });
  }, [resetTimers]);

  const fetchSimilar = useCallback(async () => {
    const res = await fetch(`/api/v1/anomalies/${TODAY_ID}/similar?k=6`);
    if (!res.ok) return [];
    const body = (await res.json()) as { similar?: SimilarAnomaly[] };
    return body.similar ?? [];
  }, []);

  const fetchEvidence = useCallback(async () => {
    const res = await fetch(`/api/v1/audit`);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      rows?: (EvidenceChainEntry & { prev_hash: string; hash: string })[];
    };
    return body.rows ?? [];
  }, []);

  const runAgent = useCallback(
    async (persona: 'reliability_engineer' | 'safety_officer') => {
      const res = await fetch(`/api/v1/anomalies/${TODAY_ID}/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ persona }),
      });
      if (!res.ok) return null;
      return (await res.json()) as AgentFinding;
    },
    [],
  );

  const kickOff = useCallback(async () => {
    await reset();
    setState((s) => ({ ...s, startedAt: performance.now(), act: 1 }));

    // ─── Act 1 (0-12s): live-ingest today's anomaly ─────────────────
    setState((s) => ({ ...s, today: { ...s.today, status: 'ingesting' } }));
    let ingestErr: string | null = null;
    try {
      const res = await fetch('/api/v1/demo/ingest-today', { method: 'POST' });
      if (!res.ok) ingestErr = (await res.text()).slice(0, 180);
    } catch (e) {
      ingestErr = e instanceof Error ? e.message : 'ingest failed';
    }
    setState((s) => ({
      ...s,
      today: ingestErr
        ? { ...s.today, status: 'error', message: ingestErr }
        : { ...s.today, status: 'ingested' },
    }));

    const D = (i: number) => ACTS[i]?.durationMs ?? 0;

    // ─── Act 2 (12-26s): vector recall ──────────────────────────────
    timers.current.push(
      setTimeout(async () => {
        setState((s) => ({ ...s, act: 2 }));
        const similar = await fetchSimilar();
        setState((s) => ({ ...s, similar }));
      }, D(0)),
    );

    // ─── Act 3 (26-42s): graph reveal ───────────────────────────────
    timers.current.push(
      setTimeout(() => {
        setState((s) => ({ ...s, act: 3, graphReady: true }));
      }, D(0) + D(1)),
    );

    // ─── Act 4 (42-58s): agent runs (deterministic finding; LLM prose tries to land) ──
    timers.current.push(
      setTimeout(async () => {
        setState((s) => ({ ...s, act: 4 }));
        const [r, sf] = await Promise.all([
          runAgent('reliability_engineer'),
          runAgent('safety_officer'),
        ]);
        setState((s) => ({ ...s, reliability: r, safety: sf }));
      }, D(0) + D(1) + D(2)),
    );

    // ─── Act 5 (58-70s): evidence chain ─────────────────────────────
    timers.current.push(
      setTimeout(async () => {
        setState((s) => ({ ...s, act: 5 }));
        const ev = await fetchEvidence();
        setState((s) => ({ ...s, evidence: ev }));
      }, D(0) + D(1) + D(2) + D(3)),
    );
  }, [fetchEvidence, fetchSimilar, reset, runAgent]);

  useEffect(() => () => resetTimers(), [resetTimers]);

  const totalSec = useMemo(
    () => ACTS.reduce((a, b) => a + b.durationMs, 0) / 1000,
    [],
  );
  const currentCaption = ACTS.find((a) => a.id === state.act)?.caption ?? '';
  const currentTitle = ACTS.find((a) => a.id === state.act)?.title ?? '';

  return (
    <div className="p-6 md:p-8 space-y-6 min-h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Anomaly Investigation Memory
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Five acts · ~{totalSec.toFixed(0)} seconds · every query runs live.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={kickOff} disabled={state.act !== 0 && state.act !== 5}>
            {state.act === 0 ? 'Kick Off' : state.act === 5 ? 'Run Again' : 'Running…'}
          </Button>
          <Button variant="outline" onClick={() => void reset()}>
            Reset
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Act1 state={state} />
        <Act2 state={state} />
        <Act3 state={state} />
        <Act4 state={state} className="lg:col-span-2" />
        <Act5 state={state} />
      </div>

      {state.act !== 0 && (
        <div className="rounded-md border border-primary/40 bg-card p-4 demo-fade-in">
          <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-primary">
            <span className="rounded-full bg-primary/20 px-2 py-0.5">Act {state.act} / 5</span>
            <span className="text-foreground/80">{currentTitle}</span>
          </div>
          <p className="text-base mt-2">{currentCaption}</p>
        </div>
      )}
    </div>
  );
}

function ActFrame({
  active,
  number,
  title,
  className,
  children,
}: {
  active: boolean;
  number: number;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        'rounded-md border bg-card p-4 flex flex-col gap-3 transition-all duration-500 ' +
        (active
          ? 'border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.4)] '
          : 'border-border opacity-60 ') +
        (className ?? '')
      }
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
        <span>Act {number}</span>
        <span className={active ? 'text-primary' : ''}>{title}</span>
      </div>
      <div className="flex-1 min-h-[180px]">{children}</div>
    </div>
  );
}

function Act1({ state }: { state: DemoState }) {
  const active = state.act >= 1;
  return (
    <ActFrame active={active} number={1} title="Anomaly detected">
      {state.act === 0 ? (
        <p className="text-sm text-muted-foreground">
          Press <span className="font-semibold text-foreground">Kick Off</span> to ingest the BE-4
          unit 027 anomaly live and start the timeline.
        </p>
      ) : (
        <div className="space-y-3 demo-slide-up">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-destructive demo-pulse-ring" />
            <span className="text-xs font-mono text-destructive">incoming · severity: major</span>
          </div>
          <p className="text-sm font-semibold">{TODAY_ID}</p>
          <p className="text-xs text-muted-foreground">
            BE-4 · turbopump · Hot-fire Stand 4 · K. Suresh
          </p>
          <p className="text-xs leading-relaxed text-foreground/80 line-clamp-6">
            Carbon deposits exceed spec on LOX-side turbopump bearing race during 14-second
            hot-fire test on 2026-06-12T06:14:00Z. Vibration signature shifted by 3.2 sigma at
            T+0.7s on the high-pressure oxidizer shaft. Bearing race showed micro-pitting
            consistent with debris from upstream contamination.
          </p>
          <p className="text-xs text-muted-foreground italic">
            SharePoint baseline: ~3 prior reports surface in 2–3 days.
          </p>
          <p className="text-xs text-primary">
            Status:{' '}
            {state.today.status === 'ingesting'
              ? 'embedding…'
              : state.today.status === 'ingested'
              ? 'embedded + indexed.'
              : state.today.status === 'error'
              ? state.today.message ?? 'error'
              : 'pending'}
          </p>
        </div>
      )}
    </ActFrame>
  );
}

function Act2({ state }: { state: DemoState }) {
  const active = state.act >= 2;
  const max = state.similar[0]?.similarity ?? 1;
  return (
    <ActFrame active={active} number={2} title="Vector recall">
      {state.similar.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Waiting for COSINE_SIMILARITY query…
        </p>
      ) : (
        <div className="space-y-2 demo-slide-up">
          {state.similar.map((s) => {
            const score = Math.max(0, Math.min(1, s.similarity));
            const pct = max > 0 ? (score / max) * 100 : 0;
            return (
              <div key={s.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{s.id}</span>
                  <span
                    className={
                      'rounded px-1 ' +
                      (s.program === 'BE-3'
                        ? 'bg-destructive/20 text-destructive'
                        : 'bg-primary/15 text-primary')
                    }
                  >
                    {s.program}
                  </span>
                </div>
                <div className="h-1.5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-1.5 bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[11px] text-foreground/70 truncate">{s.title}</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  cosine = {s.similarity.toFixed(3)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ActFrame>
  );
}

function Act3({ state }: { state: DemoState }) {
  const active = state.act >= 3;
  return (
    <ActFrame active={active} number={3} title="Supplier fingerprint" className="max-h-[380px] overflow-hidden">
      {state.graphReady ? (
        <GraphPanel anomalyId={TODAY_ID} />
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for graph fingerprint…</p>
      )}
    </ActFrame>
  );
}

function Act4({ state, className }: { state: DemoState; className?: string }) {
  const active = state.act >= 4;
  const safety = state.safety;
  return (
    <ActFrame active={active} number={4} title="Safety Officer agent" className={className}>
      {!safety ? (
        <p className="text-sm text-muted-foreground">
          Agent thinking… (deterministic query first, prose narration when LLM lands)
        </p>
      ) : (
        <div className="space-y-3 demo-slide-up">
          <p className="text-sm leading-relaxed">{safety.summary}</p>
          {safety.prose && (
            <p className="text-sm italic text-muted-foreground border-l-2 border-primary/40 pl-3">
              {safety.prose}
            </p>
          )}
          <ul className="space-y-1 text-xs font-mono">
            {safety.rfa_flags.slice(0, 4).map((r) => (
              <li
                key={r.id}
                className={
                  r.reason.includes('left the company')
                    ? 'text-destructive'
                    : 'text-foreground/80'
                }
              >
                • {r.id} — {r.reason}
              </li>
            ))}
          </ul>
          <p className="text-xs text-primary">{safety.recommended_action}</p>
          <p className="text-[10px] text-muted-foreground">
            Citations: {safety.citations.slice(0, 3).join(' · ')}
          </p>
          <div className="rounded bg-destructive/10 border border-destructive/30 px-2 py-1 text-[10px] text-destructive">
            OIG IG-26-004 — &quot;nearly half of PDR RFAs remain open &gt;1 year&quot;
          </div>
        </div>
      )}
    </ActFrame>
  );
}

function Act5({ state }: { state: DemoState }) {
  const active = state.act >= 5;
  const lastFew = state.evidence.slice(0, 6);
  return (
    <ActFrame active={active} number={5} title="Evidence chain">
      {lastFew.length === 0 ? (
        <p className="text-sm text-muted-foreground">Evidence chain loading…</p>
      ) : (
        <div className="space-y-1 demo-slide-up">
          {lastFew.map((e) => (
            <div key={e.id} className="rounded border border-border px-2 py-1 text-[11px] font-mono">
              <div className="flex items-center justify-between">
                <span className="text-primary">{e.action}</span>
                <span className="text-muted-foreground">
                  {new Date(e.ts).toISOString().slice(11, 19)}
                </span>
              </div>
              <div className="text-muted-foreground">{e.actor}</div>
              <div className="text-[9px] text-muted-foreground">
                hash {e.hash.slice(0, 12)}… prev {e.prev_hash.slice(0, 12)}…
              </div>
            </div>
          ))}
          <div className="pt-2 flex gap-2 items-center text-xs">
            <Button
              variant="default"
              onClick={async () => {
                const res = await fetch(`/api/v1/audit?target=${TODAY_ID}`);
                const body = await res.json();
                const blob = new Blob([JSON.stringify(body, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `FAA-evidence-${TODAY_ID}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export FAA Evidence Package
            </Button>
            <span className="text-[10px] text-muted-foreground">
              IMMUTABLE TABLE · UPDATE / DELETE rejected by the engine.
            </span>
          </div>
        </div>
      )}
    </ActFrame>
  );
}

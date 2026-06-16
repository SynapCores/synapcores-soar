import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AppPageHeader,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';

import { findSimilarAnomalies, getAnomaly } from '@/lib/anomalies';
import { latestAgentRun, latestNarration } from '@/lib/agent';
import { hashChain, listEvidence } from '@/lib/audit';
import { AnomalyDetailActions } from './detail-actions';

export const dynamic = 'force-dynamic';

export default async function AnomalyDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const anomaly = await getAnomaly(id);
  if (!anomaly) notFound();

  const [similar, evidenceRows, reliability, safety, reliabilityProse, safetyProse] = await Promise.all([
    findSimilarAnomalies(id, 5),
    listEvidence(id),
    latestAgentRun(id, 'reliability_engineer'),
    latestAgentRun(id, 'safety_officer'),
    latestNarration(id, 'reliability_engineer'),
    latestNarration(id, 'safety_officer'),
  ]);
  const evidence = hashChain(evidenceRows);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <AppPageHeader
        title={anomaly.title}
        description={`${anomaly.program} · ${anomaly.subsystem} · Unit ${anomaly.unit_id} · Reported by ${anomaly.reporter}`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Description</CardTitle>
          <CardDescription>{anomaly.source_doc ?? 'source document not attached'}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed">{anomaly.description}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run agents</CardTitle>
          <CardDescription>
            Both agents run real SQL across the corpus and persist their findings
            to <code className="text-primary">agent_runs</code> + the immutable
            evidence chain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnomalyDetailActions anomalyId={id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Similar past anomalies (vector recall)</CardTitle>
          <CardDescription>
            <code className="text-primary">COSINE_SIMILARITY(embedding, this.embedding)</code> — top {similar.length}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {similar.length === 0 ? (
            <p className="text-sm text-muted-foreground">No similar anomalies found.</p>
          ) : (
            <ul className="space-y-2">
              {similar.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground w-24">{s.id}</span>
                  <span className="rounded bg-primary/10 text-primary px-2 text-xs font-semibold">
                    {s.program}
                  </span>
                  <span className="flex-1 truncate">{s.title}</span>
                  <span className="font-mono text-xs text-primary w-16 text-right">
                    {s.similarity.toFixed(3)}
                  </span>
                  <Link href={`/anomalies/${s.id}`} className="text-xs text-primary hover:underline">
                    open →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {reliability && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reliability Engineer finding</CardTitle>
            <CardDescription>Deterministic SQL-backed finding + LLM narration when available</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <p>{reliability.summary}</p>
            {reliabilityProse && (
              <p className="italic text-muted-foreground border-l-2 border-primary/40 pl-3">
                {reliabilityProse}
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {reliability.programs_covered.map((p) => (
                <div
                  key={p.program}
                  className={
                    'rounded px-2 py-1 text-xs font-mono ' +
                    (p.status === 'covered'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-destructive/10 text-destructive')
                  }
                >
                  {p.program} · {p.status}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Recommended: {reliability.recommended_action}
            </p>
          </CardContent>
        </Card>
      )}

      {safety && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Safety Officer finding</CardTitle>
            <CardDescription>RFA cross-reference + departed-employee check</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <p>{safety.summary}</p>
            {safetyProse && (
              <p className="italic text-muted-foreground border-l-2 border-primary/40 pl-3">{safetyProse}</p>
            )}
            <ul className="space-y-1">
              {safety.rfa_flags.map((r) => (
                <li key={r.id} className="text-xs font-mono text-destructive">
                  • {r.id} — {r.reason}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Recommended: {safety.recommended_action}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidence chain</CardTitle>
          <CardDescription>
            IMMUTABLE TABLE — engine rejects UPDATE/DELETE. SHA-256 chain on top for visual chain-of-custody.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs font-mono">
            {evidence.map((e) => (
              <div key={e.id} className="rounded border border-border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-primary">{e.action}</span>
                  <span className="text-muted-foreground">{new Date(e.ts).toISOString()}</span>
                </div>
                <div className="text-muted-foreground">by {e.actor}</div>
                <div className="mt-1 text-foreground/70 truncate">{e.details}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">hash: {e.hash.slice(0, 16)}… prev: {e.prev_hash.slice(0, 16)}…</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Button } from '@synapcores/app-framework';
import { useRouter } from 'next/navigation';

export function AnomalyDetailActions({ anomalyId }: { anomalyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(persona: 'reliability_engineer' | 'safety_officer') {
    setBusy(persona);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/anomalies/${encodeURIComponent(anomalyId)}/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ persona }),
      });
      if (!res.ok) {
        const t = await res.text();
        setErr(t.slice(0, 200));
      } else {
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'agent run failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Button
        onClick={() => run('reliability_engineer')}
        disabled={busy !== null}
        variant="default"
      >
        {busy === 'reliability_engineer' ? 'Running…' : 'Run Reliability Engineer agent'}
      </Button>
      <Button
        onClick={() => run('safety_officer')}
        disabled={busy !== null}
        variant="outline"
      >
        {busy === 'safety_officer' ? 'Running…' : 'Run Safety Officer agent'}
      </Button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}

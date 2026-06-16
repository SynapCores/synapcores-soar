'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const ForceGraph2D = dynamic(
  () => import('react-force-graph-2d').then((m) => m.default),
  { ssr: false },
) as unknown as React.ComponentType<Record<string, unknown>>;

interface GraphCloudNode {
  id: string;
  label: string;
  kind: 'anomaly' | 'part' | 'supplier' | 'program' | 'corrective' | 'rfa';
  props?: Record<string, unknown>;
}

interface GraphCloudEdge {
  source: string;
  target: string;
  type: string;
}

interface GraphCloud {
  nodes: GraphCloudNode[];
  edges: GraphCloudEdge[];
  summary: string;
}

const COLORS: Record<GraphCloudNode['kind'], string> = {
  anomaly: '#ef4444',
  part: '#60a5fa',
  supplier: '#fbbf24',
  program: '#a78bfa',
  corrective: '#22c55e',
  rfa: '#f97316',
};

export function GraphPanel({ anomalyId }: { anomalyId: string }) {
  const [cloud, setCloud] = useState<GraphCloud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 220 });

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/anomalies/${anomalyId}/graph`);
        if (!res.ok) {
          if (!cancel) setErr((await res.text()).slice(0, 180));
          return;
        }
        const body = (await res.json()) as GraphCloud;
        if (!cancel) setCloud(body);
      } catch (e) {
        if (!cancel) setErr(e instanceof Error ? e.message : 'graph fetch failed');
      }
    })();
    return () => {
      cancel = true;
    };
  }, [anomalyId]);

  useEffect(() => {
    if (!slotRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!slotRef.current) return;
      const r = slotRef.current.getBoundingClientRect();
      setSize({
        w: Math.max(200, Math.floor(r.width)),
        h: Math.max(180, Math.min(280, Math.floor(r.height))),
      });
    });
    ro.observe(slotRef.current);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    if (!cloud) return { nodes: [], links: [] };
    return {
      nodes: cloud.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        color: COLORS[n.kind],
        val: n.kind === 'supplier' ? 5 : n.kind === 'anomaly' ? 4 : 3,
      })),
      links: cloud.edges.map((e) => ({ source: e.source, target: e.target, type: e.type })),
    };
  }, [cloud]);

  if (err) {
    return <p className="text-xs text-destructive font-mono">{err}</p>;
  }

  return (
    <div className="flex flex-col gap-2 h-full max-h-[360px] overflow-hidden">
      <div ref={slotRef} className="flex-1 min-h-[180px] max-h-[260px] overflow-hidden">
        {cloud && cloud.nodes.length > 0 ? (
          <ForceGraph2D
            graphData={data}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            nodeRelSize={5}
            nodeLabel={(n: { label?: string; id?: string }) => n.label ?? n.id ?? ''}
            nodeAutoColorBy="kind"
            linkColor={() => 'rgba(255,255,255,0.25)'}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            cooldownTicks={80}
            d3VelocityDecay={0.35}
          />
        ) : (
          <p className="text-xs text-muted-foreground">No graph nodes returned.</p>
        )}
      </div>
      <p className="text-[11px] text-foreground/80 border-l-2 border-primary/40 pl-2">
        {cloud?.summary ?? 'computing fingerprint…'}
      </p>
      <div className="flex flex-wrap gap-2 text-[10px]">
        {(['anomaly', 'part', 'supplier', 'program', 'corrective'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[k] }} />
            <span className="text-muted-foreground">{k}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

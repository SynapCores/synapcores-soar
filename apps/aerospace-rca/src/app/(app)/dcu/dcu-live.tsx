'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@synapcores/app-framework';

import type {
  AlertMessage,
  BridgeMessage,
  LiveMessage,
  RateMessage,
  SensorKind,
  SensorRegistryRow,
} from '@/lib/dcu-types';

import { Sparkline } from './sparkline';

/**
 * The 12 sparkline channels — one per panel slot. We pin the 4 anomaly
 * targets so the viewer can see the spike land. The other 8 are
 * representative samples across kinds + units.
 */
const SPARKLINE_PINS: string[] = [
  // Row 1 — the four planted-anomaly sensors (left-to-right, in act order).
  'BE4-027-TP-VIB-X-014',
  'NG-2-PB-PRES-002',
  'BE3-031-TP-TEMP-007',
  'BE4-027-CC-VIB-Y-022',
];

const MAX_FEED_ROWS = 12;
const SPARKLINE_HISTORY = 200; // 200 samples @ 10Hz bridge live rate = 20s window

const BRIDGE_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:4005`
    : 'ws://localhost:4005';

interface ConnectionState {
  bridge: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  worker: 'idle' | 'ready' | 'error';
  message?: string;
}

interface Channel {
  sensor: SensorRegistryRow;
  values: number[];
  lastTs: number;
}

interface RateState extends RateMessage {
  receivedAt: number;
}

interface FeedAlert extends AlertMessage {
  receivedAt: number;
  /** Wall-clock seconds since simulator start, for the storyboard caption. */
  t_sec: number | null;
}

export function DcuLive() {
  const [conn, setConn] = useState<ConnectionState>({
    bridge: 'idle',
    worker: 'idle',
  });
  const [sensors, setSensors] = useState<SensorRegistryRow[] | null>(null);
  const [rate, setRate] = useState<RateState | null>(null);
  const [alerts, setAlerts] = useState<FeedAlert[]>([]);
  const [channels, setChannels] = useState<Record<string, Channel>>({});
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [simStats, setSimStats] = useState<{
    samples_emitted: number;
    batches_emitted: number;
    elapsed_ms: number;
    t_sec: number;
  }>({ samples_emitted: 0, batches_emitted: 0, elapsed_ms: 0, t_sec: 0 });

  const workerRef = useRef<Worker | null>(null);
  const feedWsRef = useRef<WebSocket | null>(null);

  // ─── load sensor registry on mount ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/dcu/sensors');
        if (!res.ok) throw new Error(`registry fetch: HTTP ${res.status}`);
        const body = (await res.json()) as { sensors: SensorRegistryRow[] };
        if (cancelled) return;
        if (body.sensors.length === 0) {
          setConn((c) => ({
            ...c,
            message:
              'telemetry_sensors is empty. Run `pnpm --filter @synapcores/aerospace-rca seed-demo`.',
          }));
        }
        setSensors(body.sensors);
      } catch (e) {
        setConn((c) => ({
          ...c,
          message: (e as Error).message,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── seed sparkline channels once the registry lands ────────────
  useEffect(() => {
    if (!sensors) return;
    const idx: Record<string, Channel> = {};
    for (const pin of SPARKLINE_PINS) {
      const s = sensors.find((x) => x.id === pin);
      if (s) idx[pin] = { sensor: s, values: [], lastTs: 0 };
    }
    // Fill the remaining 8 slots with a deterministic sample across
    // kinds + programs (round-robin).
    const wanted = 12 - Object.keys(idx).length;
    const byKind: Record<SensorKind, SensorRegistryRow[]> = {
      vibration: [],
      pressure: [],
      temperature: [],
      voltage: [],
      flow: [],
    };
    for (const s of sensors) {
      if (idx[s.id]) continue;
      byKind[s.kind].push(s);
    }
    const kinds: SensorKind[] = ['vibration', 'pressure', 'temperature', 'voltage', 'flow'];
    let i = 0;
    while (Object.keys(idx).length < 12 && i < wanted * kinds.length) {
      const k = kinds[i % kinds.length]!;
      const pool = byKind[k];
      if (pool && pool.length) {
        // Pick a deterministic step into the pool so each demo run picks
        // the same channels.
        const pickIdx = Math.floor((pool.length / wanted) * (i % wanted));
        const choice = pool[Math.min(pickIdx, pool.length - 1)];
        if (choice && !idx[choice.id]) {
          idx[choice.id] = { sensor: choice, values: [], lastTs: 0 };
        }
      }
      i++;
    }
    setChannels(idx);
  }, [sensors]);

  // ─── connect feed WS once channels are picked (subscribe to 12) ──
  const ensureFeedWs = useCallback(() => {
    if (Object.keys(channels).length === 0) return;
    if (feedWsRef.current && feedWsRef.current.readyState === WebSocket.OPEN) return;

    setConn((c) => ({ ...c, bridge: 'connecting' }));
    const ws = new WebSocket(`${BRIDGE_URL}/feed`);
    feedWsRef.current = ws;

    ws.onopen = () => {
      setConn((c) => ({ ...c, bridge: 'open' }));
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          sensor_ids: Object.keys(channels),
        }),
      );
    };
    ws.onclose = () => {
      setConn((c) => ({ ...c, bridge: 'closed' }));
    };
    ws.onerror = () => {
      setConn((c) => ({
        ...c,
        bridge: 'error',
        message:
          'Could not connect to ws://localhost:4005/feed — start the bridge with `pnpm --filter @synapcores/telemetry-bridge dev`.',
      }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as BridgeMessage;
        handleBridgeMsg(msg);
      } catch {
        // ignore
      }
    };
  }, [channels]);

  const handleBridgeMsg = useCallback((msg: BridgeMessage) => {
    if (msg.type === 'rate') {
      setRate({ ...(msg as RateMessage), receivedAt: performance.now() });
    } else if (msg.type === 'live') {
      pushSample(msg);
    } else if (msg.type === 'alert') {
      pushAlert(msg);
    }
  }, []);

  const pushSample = useCallback((live: LiveMessage) => {
    setChannels((prev) => {
      const ch = prev[live.sensor_id];
      if (!ch) return prev;
      const values = ch.values.length >= SPARKLINE_HISTORY
        ? [...ch.values.slice(1), live.value]
        : [...ch.values, live.value];
      return {
        ...prev,
        [live.sensor_id]: { ...ch, values, lastTs: live.ts },
      };
    });
  }, []);

  const pushAlert = useCallback(
    (alert: AlertMessage) => {
      setAlerts((prev) => {
        const t_sec = runStartedAt
          ? (performance.timeOrigin + performance.now() - runStartedAt) / 1000
          : null;
        const entry: FeedAlert = {
          ...alert,
          receivedAt: performance.now(),
          t_sec,
        };
        return [entry, ...prev].slice(0, MAX_FEED_ROWS);
      });
    },
    [runStartedAt],
  );

  // ─── boot the worker (Web Worker) when we hit "Start Test" ──────
  const startTest = useCallback(() => {
    if (!sensors || sensors.length === 0) return;
    if (workerRef.current) {
      try {
        workerRef.current.terminate();
      } catch {
        /* noop */
      }
    }
    ensureFeedWs();
    setAlerts([]);
    setSimStats({ samples_emitted: 0, batches_emitted: 0, elapsed_ms: 0, t_sec: 0 });
    setRunStartedAt(Date.now());

    const worker = new Worker(
      new URL('./simulator.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as {
        type: string;
        samples_emitted?: number;
        batches_emitted?: number;
        elapsed_ms?: number;
        t_sec?: number;
        sensor_id?: string;
        message?: string;
      };
      if (m.type === 'ready') {
        setConn((c) => ({ ...c, worker: 'ready' }));
      } else if (m.type === 'tick') {
        setSimStats({
          samples_emitted: m.samples_emitted ?? 0,
          batches_emitted: m.batches_emitted ?? 0,
          elapsed_ms: m.elapsed_ms ?? 0,
          t_sec: m.t_sec ?? 0,
        });
      } else if (m.type === 'error') {
        setConn((c) => ({ ...c, worker: 'error', message: m.message }));
      }
    };
    worker.postMessage({
      type: 'start',
      sensors,
      bridgeUrl: `${BRIDGE_URL}/ingest`,
    });
  }, [ensureFeedWs, sensors]);

  const stopTest = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'stop' });
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setConn((c) => ({ ...c, worker: 'idle' }));
  }, []);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      if (workerRef.current) workerRef.current.terminate();
      if (feedWsRef.current) feedWsRef.current.close();
    },
    [],
  );

  const sensorCount = sensors?.length ?? 0;
  const running = conn.worker === 'ready';

  const samplesPerSecDisplay = useMemo(() => {
    // Prefer the simulator's own ticker for the "what's flowing into the
    // bridge" headline number. The bridge's RateMessage is the truth, but
    // it lags by 100ms which feels chunky on a counter; we use the worker's
    // emit rate.
    if (!simStats.elapsed_ms) return 0;
    return Math.round((simStats.samples_emitted / simStats.elapsed_ms) * 1000);
  }, [simStats]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            DCU — Live Telemetry · BE-4 hot-fire stand 4
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            3000 sensors · 100 Hz · 300K samples/sec into an in-memory bridge.
            <br />
            <span className="italic text-[12px]">
              DCU bridge holds raw 100 Hz samples in-memory. AIDB persists only
              the 1Hz/0.2Hz aggregates + detected anomaly events — the
              meaningful 0.3% of the stream.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={startTest} disabled={!sensors || running}>
            {running ? 'Running…' : 'Start Test'}
          </Button>
          <Button variant="outline" onClick={stopTest} disabled={!running}>
            Stop
          </Button>
        </div>
      </div>

      {conn.message && (
        <div className="rounded border border-destructive/50 bg-destructive/10 text-destructive text-sm px-3 py-2">
          {conn.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          title="Samples / sec ingested"
          value={fmtBigNumber(samplesPerSecDisplay)}
          sub={`${sensorCount} sensors @ 100 Hz`}
        />
        <Stat
          title="Bridge batches / sec → engine"
          value={String(rate?.batches_per_sec ?? 0)}
          sub={`${rate?.last_write_latency_ms ?? 0} ms last write`}
        />
        <Stat
          title="Persisted aggregates"
          value={fmtBigNumber(rate?.persisted_aggregates ?? 0)}
          sub="rows in telemetry_aggregates"
        />
        <Stat
          title="Alerts this run"
          value={String(rate?.alerts_total ?? alerts.length)}
          sub={`${conn.bridge} · ${conn.worker}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Live sparklines · 12 sampled channels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.values(channels).map((ch) => (
                <SparkPanel key={ch.sensor.id} channel={ch} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alert feed</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertFeed alerts={alerts} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Engine load</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <KV k="Bridge buffered samples" v={fmtBigNumber(rate?.bridge_buffered_samples ?? 0)} />
            <KV k="Last engine write" v={`${rate?.last_write_latency_ms ?? 0} ms`} />
            <KV k="Run elapsed" v={`${(simStats.elapsed_ms / 1000).toFixed(1)} s`} />
            <KV k="Worker batches sent" v={String(simStats.batches_emitted)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground italic">
            DCU bridge is honest about the architecture: 300K samples/sec is
            what the in-memory ring buffer + Welford rolling-stats + z-score
            detector see. AIDB receives only what the detector decided was
            meaningful — per-sensor aggregates and the alert events
            themselves. No raw 100 Hz writes hit the engine.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── child UI bits ─────────────────────────────────────────────────

function Stat({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="text-2xl font-mono font-bold mt-1 text-primary">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="font-mono text-sm">{v}</div>
    </div>
  );
}

function SparkPanel({ channel }: { channel: Channel }) {
  const { sensor, values } = channel;
  const last = values[values.length - 1];
  return (
    <div className="rounded border border-border p-2 bg-card flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-muted-foreground truncate" title={sensor.id}>
          {sensor.id}
        </span>
        <span className="text-primary">{sensor.kind}</span>
      </div>
      <Sparkline values={values} width={160} height={40} kind={sensor.kind} />
      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>{sensor.unit}</span>
        <span>{last == null ? '—' : last.toFixed(2)}</span>
      </div>
    </div>
  );
}

function AlertFeed({ alerts }: { alerts: FeedAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No alerts yet. Sensors are warming up; the detector needs ~2 s of
        rolling-stats warmup before z-score thresholds can fire.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {alerts.map((a) => {
        const colorFor = severityColor(a.score);
        return (
          <li
            key={a.id}
            className={`rounded border ${colorFor.border} bg-card p-2 text-xs`}
          >
            <div className="flex items-center justify-between">
              <span className={`font-mono font-semibold ${colorFor.label}`}>
                {a.unit_id} · {a.subsystem}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(a.ts).toISOString().slice(11, 19)} UTC
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate" title={a.sensor_name}>
              {a.sensor_name}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[11px]">
              <span className="rounded bg-primary/15 text-primary px-1.5 py-0.5">
                {a.detector}
              </span>
              <span className="font-mono">
                score={a.score} · v={a.value.toFixed(2)}
              </span>
            </div>
            {a.cluster_with.length > 0 && (
              <div className="mt-1 text-[11px] text-destructive">
                cluster: {a.cluster_with.length + 1} sensors on {a.unit_id} this
                run
              </div>
            )}
            {a.anomaly_id ? (
              <div className="mt-2">
                <Link
                  href={`/anomalies/${a.anomaly_id}`}
                  onClick={stopTest}
                  className="inline-block rounded bg-primary text-primary-foreground px-2 py-0.5 text-[11px] font-semibold hover:opacity-90"
                >
                  Open Investigation →
                </Link>
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-muted-foreground italic">
                anomaly promotion pending…
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function severityColor(score: number): { border: string; label: string } {
  const a = Math.abs(score);
  if (a >= 8) return { border: 'border-destructive', label: 'text-destructive' };
  if (a >= 5) return { border: 'border-destructive/60', label: 'text-destructive' };
  if (a >= 3) return { border: 'border-primary/60', label: 'text-primary' };
  return { border: 'border-border', label: 'text-foreground' };
}

function fmtBigNumber(n: number): string {
  if (!isFinite(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

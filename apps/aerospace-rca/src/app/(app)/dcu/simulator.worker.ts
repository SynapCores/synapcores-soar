/// <reference lib="webworker" />

/**
 * Browser-side simulator for the U6 demo.
 *
 * Generates 3000 sensors × 100Hz = 300K samples/sec of synthetic
 * baseline noise, plants 4 anomaly events at predetermined times, and
 * ships batches to the bridge via WebSocket. The bridge (the real
 * detection layer) doesn't know which 4 sensors will fire — its job is
 * to detect them. We just plant the signal.
 *
 * Why a worker: 300K floats/sec generated on the main thread would
 * starve React. The worker keeps the page responsive (sparkline
 * animation, click handlers, etc.).
 *
 * Wire protocol (matches apps/telemetry-bridge/src/types.ts):
 *   - Worker → bridge:  { type: 'samples', ts, samples: [{sensor_id, value}, ...] }
 *   - Main → worker:    { type: 'start', sensors, bridgeUrl } | { type: 'stop' }
 *   - Worker → main:    { type: 'ready' } | { type: 'tick', samples_emitted, batches_emitted, elapsed_ms } | { type: 'planted', sensor_id, t_sec }
 */

import type { SensorKind, SensorRegistryRow } from '@/lib/dcu-types';

type StartMessage = {
  type: 'start';
  sensors: SensorRegistryRow[];
  bridgeUrl: string;
};
type StopMessage = { type: 'stop' };
type MainMessage = StartMessage | StopMessage;

interface PlantedAnomaly {
  sensor_id: string;
  /** First tick (seconds from start) at which the anomaly is active. */
  t_start_sec: number;
  /** Last tick (seconds from start) at which the anomaly is active. */
  t_end_sec: number;
  /** Deviation applied to nominal during the active window. */
  apply: (
    baseline: number,
    nominalSpread: number,
    rng: () => number,
    tFromStart: number,
  ) => number;
}

const TICK_HZ = 100;
const TICK_MS = 1000 / TICK_HZ;
const BATCHES_PER_SEC = 10; // every 10 ticks = 1 batch
const TICKS_PER_BATCH = TICK_HZ / BATCHES_PER_SEC; // 10

/** Per-kind baseline configuration matching bin/generate-sensors.mjs. */
const NOMINAL: Record<
  SensorKind,
  { base: number; noise: number }
> = {
  vibration: { base: 0, noise: 0.2 },
  pressure: { base: 12_000, noise: 80 },
  temperature: { base: 1200, noise: 6 },
  voltage: { base: 28, noise: 0.05 },
  flow: { base: 60, noise: 1.2 },
};

// ─── deterministic PRNG (mulberry32) ────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gaussian via Box-Muller; we cache the spare.
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ─── planted anomaly catalog ────────────────────────────────────────
// Times match docs/STORYBOARD.md (U6 act sequence).
function buildPlantedAnomalies(): PlantedAnomaly[] {
  return [
    // Act 2 (t≈12s): vibration spike on BE4-027 turbopump.
    // 4.8σ excursion sustained for ~250ms — well above the bridge's
    // z=4.5 + debounce=2 threshold.
    {
      sensor_id: 'BE4-027-TP-VIB-X-014',
      t_start_sec: 12.0,
      t_end_sec: 12.25,
      apply: (_b, noise, rng, _t) => 0 + (4.8 + 0.5 * gauss(rng)) * noise * 8,
      // Magnitude: 4.8σ × noise(0.2) × 8 = 7.7g — a real bearing spike.
    },
    // Act 3 (t≈31s): slow pressure drift on NG pre-burner over 8s.
    // Step detector should catch this BEFORE z-score does, because the
    // drift moves the rolling mean.
    {
      sensor_id: 'NG-2-PB-PRES-002',
      t_start_sec: 31.0,
      t_end_sec: 39.0,
      apply: (b, _noise, rng, tFromStart) => {
        // Ramp: 250 kPa/s slope, well above the 150 kPa/s threshold.
        const dt = tFromStart - 31.0;
        return b + 250 * dt + 30 * gauss(rng);
      },
    },
    // Act 4 (t≈53s): single-sample temperature excursion.
    // ONE sample at +6σ. debounce=4 for temperature kind — the bridge
    // SHOULD NOT fire here. The story beat is "the detector is real,
    // not theater" — we narrate that it suppressed this.
    {
      sensor_id: 'BE3-031-TP-TEMP-007',
      t_start_sec: 53.0,
      t_end_sec: 53.0, // exactly one tick
      apply: (b, noise, rng, _t) => b + 60 + 2 * gauss(rng) * noise,
      // 60 K above nominal for a single 10ms sample = clearly anomalous,
      // but the detector debounces it.
    },
    // Act 5 (t≈71s): second BE4-027 sensor fires. The cluster bookkeeping
    // in the bridge picks this up as "another sensor on the same unit
    // alerted in this run" — the supplier-batch story compounds.
    {
      sensor_id: 'BE4-027-CC-VIB-Y-022',
      t_start_sec: 71.0,
      t_end_sec: 71.3,
      apply: (_b, noise, rng, _t) => 0 + (5.2 + 0.4 * gauss(rng)) * noise * 8,
    },
  ];
}

// ─── runtime state ──────────────────────────────────────────────────

interface RunState {
  sensors: SensorRegistryRow[];
  ws: WebSocket | null;
  rng: () => number;
  tickN: number; // 0-indexed tick number from start
  startedAt: number;
  samplesEmitted: number;
  batchesEmitted: number;
  planted: PlantedAnomaly[];
  plantedAnnounced: Set<string>;
  intervalHandle: ReturnType<typeof setInterval> | null;
  pendingBatch: { sensor_id: string; value: number }[];
  stop: boolean;
}

let run: RunState | null = null;

self.onmessage = (ev: MessageEvent<MainMessage>) => {
  const msg = ev.data;
  if (msg.type === 'start') {
    void start(msg);
  } else if (msg.type === 'stop') {
    stop();
  }
};

async function start(msg: StartMessage): Promise<void> {
  stop();
  const rng = mulberry32(0xacecafe ^ msg.sensors.length);
  const planted = buildPlantedAnomalies();
  const ws = new WebSocket(msg.bridgeUrl);
  ws.onopen = () => {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      type: 'ready',
    });
  };
  ws.onerror = (e) => {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      type: 'error',
      message: 'bridge websocket error',
      detail: String(e),
    });
  };
  ws.onclose = () => {
    if (run && !run.stop) {
      (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
        type: 'error',
        message: 'bridge websocket closed mid-run',
      });
    }
  };

  // Wait for OPEN before starting the tick loop.
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('bridge connect timeout')),
      5000,
    );
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(t);
      reject(new Error('bridge connect failed'));
    });
  }).catch((e) => {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      type: 'error',
      message: (e as Error).message,
    });
    return null;
  });
  if (ws.readyState !== ws.OPEN) return;

  run = {
    sensors: msg.sensors,
    ws,
    rng,
    tickN: 0,
    startedAt: performance.now(),
    samplesEmitted: 0,
    batchesEmitted: 0,
    planted,
    plantedAnnounced: new Set(),
    intervalHandle: null,
    pendingBatch: [],
    stop: false,
  };
  // Group anomaly index by sensor_id for fast per-tick lookup.
  const plantedBySensor = new Map<string, PlantedAnomaly>();
  for (const p of planted) plantedBySensor.set(p.sensor_id, p);

  // Drift to wall-clock — but cap tickN advance per real-time so we
  // don't accumulate debt and detonate the page if a tab gets backgrounded.
  let nextTickAt = performance.now();
  run.intervalHandle = setInterval(() => {
    if (!run || run.stop) return;
    const now = performance.now();
    // Burn up to a small handful of ticks per interval — if we fall
    // behind by >50ms, we just skip ahead. The bridge cares about
    // batches; missing 1/100 ticks is invisible to detection windows.
    let burned = 0;
    while (now >= nextTickAt && burned < 4) {
      doTick(plantedBySensor);
      nextTickAt += TICK_MS;
      burned++;
    }
    if (now - nextTickAt > 200) {
      // Big skid — resync.
      nextTickAt = now;
    }
  }, 5);
}

function doTick(plantedBySensor: Map<string, PlantedAnomaly>): void {
  if (!run) return;
  const s = run;
  s.tickN++;
  const tFromStart = s.tickN / TICK_HZ;

  // Generate one sample per sensor.
  for (const sensor of s.sensors) {
    const nominal = NOMINAL[sensor.kind];
    let value = nominal.base + gauss(s.rng) * nominal.noise;
    const planted = plantedBySensor.get(sensor.id);
    if (
      planted &&
      tFromStart >= planted.t_start_sec &&
      tFromStart <= planted.t_end_sec
    ) {
      value = planted.apply(nominal.base, nominal.noise, s.rng, tFromStart);
      if (!s.plantedAnnounced.has(planted.sensor_id)) {
        s.plantedAnnounced.add(planted.sensor_id);
        (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
          type: 'planted',
          sensor_id: planted.sensor_id,
          t_sec: planted.t_start_sec,
        });
      }
    }
    s.pendingBatch.push({ sensor_id: sensor.id, value });
  }
  s.samplesEmitted += s.sensors.length;

  // Every TICKS_PER_BATCH ticks, ship to the bridge.
  if (s.tickN % TICKS_PER_BATCH === 0) {
    if (s.ws && s.ws.readyState === s.ws.OPEN) {
      // Honest: this single message can be ~3000×2 = 6000 entries.
      // The 'ws' library on the bridge side absorbs ~10 of these per
      // second without breaking a sweat.
      s.ws.send(
        JSON.stringify({
          type: 'samples',
          ts: Date.now(),
          samples: s.pendingBatch,
        }),
      );
      s.batchesEmitted++;
    }
    s.pendingBatch = [];
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      type: 'tick',
      samples_emitted: s.samplesEmitted,
      batches_emitted: s.batchesEmitted,
      elapsed_ms: performance.now() - s.startedAt,
      t_sec: tFromStart,
    });
  }
}

function stop(): void {
  if (!run) return;
  run.stop = true;
  if (run.intervalHandle) clearInterval(run.intervalHandle);
  if (run.ws && run.ws.readyState === run.ws.OPEN) {
    try {
      run.ws.close();
    } catch {
      /* noop */
    }
  }
  run = null;
}

// Quiet TS: this is a worker module.
export {};

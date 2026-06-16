/**
 * Detection layer.
 *
 * Three detectors:
 *   - z-score: classic, with a per-kind threshold. Requires N samples
 *     of warmup before it can fire.
 *   - debounced-z: same threshold but requires K consecutive samples
 *     above the bar before firing. This is what avoids the single-sample
 *     temperature false positive in the demo's Act 4.
 *   - step-detector: slope (last-N − first-N average) / window seconds.
 *     Catches slow drifts that z-score would whitewash because the
 *     drift itself moves the mean.
 *
 * Per-sensor state is held in `SensorState`. The bridge owns one Map
 * keyed by sensor id; this module is pure logic operating on those
 * states.
 *
 * Welford's online algorithm computes mean/M2 incrementally so we can
 * keep rolling stats over the last `window` samples without re-summing
 * the whole ring. The ring buffer is what makes the "rolling" part
 * cheap (drop oldest, add newest, fix-up running M2).
 */

import type { AlertEvent, SensorKind, SensorRegistryRow } from './types.js';

/** Threshold + cooldown config per sensor kind. */
export interface KindConfig {
  zThreshold: number;
  debounce: number; // require K consecutive over-threshold samples
  slopeThreshold: number | null; // step detector — units per second; null = off
  cooldownMs: number; // minimum gap between two alerts on the same sensor
  minSamplesBeforeFire: number; // warmup before z-score is meaningful
}

const KIND_CONFIG: Record<SensorKind, KindConfig> = {
  // Vibration: high noise on turbopumps, big z-threshold; want fast firing.
  vibration: {
    zThreshold: 4.5,
    debounce: 2, // 2 consecutive @ 100Hz = 20ms confirm
    slopeThreshold: null,
    cooldownMs: 3000,
    minSamplesBeforeFire: 200, // 2 seconds of warmup
  },
  // Pressure: classic ramp-fault; z + step detector both armed.
  pressure: {
    zThreshold: 5.0,
    debounce: 3,
    slopeThreshold: 150, // kPa/s (per spec)
    cooldownMs: 3000,
    minSamplesBeforeFire: 200,
  },
  // Temperature: aggressive debounce — this is the false-positive lane in Act 4.
  temperature: {
    zThreshold: 5.0,
    debounce: 4, // 4 consecutive @ 100Hz = 40ms — single-sample spikes get eaten
    slopeThreshold: null,
    cooldownMs: 3000,
    minSamplesBeforeFire: 200,
  },
  // Voltage: step-style faults; z is fine because the signal is quiet.
  voltage: {
    zThreshold: 6.0,
    debounce: 2,
    slopeThreshold: null,
    cooldownMs: 3000,
    minSamplesBeforeFire: 200,
  },
  // Flow: stable signals; tight z; small debounce.
  flow: {
    zThreshold: 4.0,
    debounce: 2,
    slopeThreshold: null,
    cooldownMs: 3000,
    minSamplesBeforeFire: 200,
  },
};

const RING_SIZE = 500; // 5s of history @ 100Hz

export interface SensorState {
  sensor: SensorRegistryRow;
  ring: Float32Array;
  ringIdx: number;
  ringCount: number;
  // Welford state
  n: number;
  mean: number;
  m2: number;
  // Detection state
  consecutiveOver: number;
  lastFiredAt: number;
  // Per-second aggregation
  agg: {
    sum: number;
    sumSq: number;
    n: number;
    min: number;
    max: number;
  };
}

export function newSensorState(sensor: SensorRegistryRow): SensorState {
  return {
    sensor,
    ring: new Float32Array(RING_SIZE),
    ringIdx: 0,
    ringCount: 0,
    n: 0,
    mean: 0,
    m2: 0,
    consecutiveOver: 0,
    lastFiredAt: 0,
    agg: {
      sum: 0,
      sumSq: 0,
      n: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    },
  };
}

/**
 * Push a sample through Welford + ring buffer + per-second aggregator.
 * Returns an alert event if one fired on this sample.
 */
export function pushSample(
  state: SensorState,
  value: number,
  ts: number,
  idForAlert: () => string,
): AlertEvent | null {
  const cfg = KIND_CONFIG[state.sensor.kind];

  // ─── ring buffer (drop oldest if full) ─────────────────────────────
  if (state.ringCount === RING_SIZE) {
    const oldest = state.ring[state.ringIdx]!;
    state.ring[state.ringIdx] = value;
    state.ringIdx = (state.ringIdx + 1) % RING_SIZE;
    // Welford rolling: subtract oldest, add newest. n stays at RING_SIZE.
    // We use a simple decay-style approximation: incremental add, then
    // incremental subtract — exact for the rolling window.
    welfordReplace(state, oldest, value);
  } else {
    state.ring[state.ringIdx] = value;
    state.ringIdx = (state.ringIdx + 1) % RING_SIZE;
    state.ringCount++;
    welfordAdd(state, value);
  }

  // ─── per-second aggregation ────────────────────────────────────────
  state.agg.sum += value;
  state.agg.sumSq += value * value;
  state.agg.n++;
  if (value < state.agg.min) state.agg.min = value;
  if (value > state.agg.max) state.agg.max = value;

  // ─── detection ─────────────────────────────────────────────────────
  if (state.ringCount < cfg.minSamplesBeforeFire) return null;
  if (ts - state.lastFiredAt < cfg.cooldownMs) {
    // In cooldown — still need to clear consecutiveOver so we don't
    // accumulate during the silence.
    state.consecutiveOver = 0;
    return null;
  }

  const stddev = Math.sqrt(state.m2 / Math.max(state.n - 1, 1));
  if (stddev < 1e-6) return null; // signal hasn't woken up yet
  const z = (value - state.mean) / stddev;

  if (Math.abs(z) >= cfg.zThreshold) {
    state.consecutiveOver++;
  } else {
    state.consecutiveOver = 0;
  }

  if (state.consecutiveOver >= cfg.debounce) {
    state.lastFiredAt = ts;
    state.consecutiveOver = 0;
    return {
      id: idForAlert(),
      sensor_id: state.sensor.id,
      sensor_name: state.sensor.name,
      sensor_kind: state.sensor.kind,
      unit_id: state.sensor.unit_id,
      subsystem: state.sensor.subsystem,
      ts,
      value,
      detector: cfg.debounce > 1 ? 'debounced-z' : 'z-score',
      score: Number(z.toFixed(3)),
      baseline_mean: Number(state.mean.toFixed(4)),
      baseline_stddev: Number(stddev.toFixed(4)),
    };
  }

  // ─── step detector (pressure only by default) ──────────────────────
  if (cfg.slopeThreshold != null && state.ringCount >= 200) {
    const slope = estimateSlope(state); // value/sec assuming 100Hz
    if (Math.abs(slope) >= cfg.slopeThreshold) {
      state.lastFiredAt = ts;
      state.consecutiveOver = 0;
      return {
        id: idForAlert(),
        sensor_id: state.sensor.id,
        sensor_name: state.sensor.name,
        sensor_kind: state.sensor.kind,
        unit_id: state.sensor.unit_id,
        subsystem: state.sensor.subsystem,
        ts,
        value,
        detector: 'step-detector',
        score: Number(slope.toFixed(3)),
        baseline_mean: Number(state.mean.toFixed(4)),
        baseline_stddev: Number(stddev.toFixed(4)),
      };
    }
  }

  return null;
}

/**
 * Drain the per-second aggregator. Caller invokes this on the 1Hz
 * (or AGGREGATE_PERIOD) tick and writes the returned rows to AIDB.
 * Resets the aggregator afterwards.
 */
export interface AggregateRow {
  sensor_id: string;
  ts_ms: number;
  mean: number;
  stddev: number;
  min_val: number;
  max_val: number;
  samples: number;
}

export function drainAggregate(
  state: SensorState,
  windowEndMs: number,
): AggregateRow | null {
  if (state.agg.n === 0) return null;
  const n = state.agg.n;
  const mean = state.agg.sum / n;
  const variance = Math.max(state.agg.sumSq / n - mean * mean, 0);
  const stddev = Math.sqrt(variance);
  const row: AggregateRow = {
    sensor_id: state.sensor.id,
    ts_ms: windowEndMs,
    mean: Number(mean.toFixed(5)),
    stddev: Number(stddev.toFixed(5)),
    min_val: Number(state.agg.min.toFixed(5)),
    max_val: Number(state.agg.max.toFixed(5)),
    samples: n,
  };
  state.agg.sum = 0;
  state.agg.sumSq = 0;
  state.agg.n = 0;
  state.agg.min = Number.POSITIVE_INFINITY;
  state.agg.max = Number.NEGATIVE_INFINITY;
  return row;
}

// ─── Welford helpers ─────────────────────────────────────────────────

function welfordAdd(s: SensorState, x: number): void {
  s.n++;
  const delta = x - s.mean;
  s.mean += delta / s.n;
  s.m2 += delta * (x - s.mean);
}

/**
 * Replace an old sample with a new one in a fixed-size window. This is
 * the "rolling Welford" trick: undo the contribution of the old value,
 * then add the new value. Stable enough for our purposes; if drift
 * becomes a problem the bridge can periodically recompute from the
 * ring (we don't bother — RING_SIZE=500 keeps numerical error <<
 * detection thresholds).
 */
function welfordReplace(s: SensorState, oldX: number, newX: number): void {
  // Remove old
  const meanBeforeRemove = s.mean;
  const meanAfterRemove =
    s.n > 1 ? (s.n * s.mean - oldX) / (s.n - 1) : 0;
  s.m2 -= (oldX - meanBeforeRemove) * (oldX - meanAfterRemove);
  s.n--;
  s.mean = meanAfterRemove;
  // Add new
  welfordAdd(s, newX);
}

/**
 * Linear-fit slope across the ring buffer, returned in units per second
 * assuming a 100Hz sample rate. We use a closed-form least-squares
 * estimator over the last N=200 samples; cheap and stable.
 */
function estimateSlope(s: SensorState): number {
  const N = 200;
  const count = Math.min(N, s.ringCount);
  // Walk back `count` samples from ringIdx-1
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < count; i++) {
    const ringPos = (s.ringIdx - 1 - i + RING_SIZE) % RING_SIZE;
    const y = s.ring[ringPos]!;
    // x = -i (older = more negative). We'll fit y = a + b*x, return b * 100 (samples/sec)
    const x = -i;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = count * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return 0;
  const slopePerSample = (count * sumXY - sumX * sumY) / denom;
  return slopePerSample * 100; // 100Hz → /sec
}

export { KIND_CONFIG, RING_SIZE };

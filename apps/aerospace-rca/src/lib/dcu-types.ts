/**
 * Shared DCU types — mirror of apps/telemetry-bridge/src/types.ts.
 *
 * Kept in lock-step with the bridge by hand; the bridge owns the
 * authoritative shape and the UI just consumes the WS messages it
 * emits. If the bridge ever grows enough fields to warrant a shared
 * package, hoist this into @synapcores/app-framework/dcu.
 */

export type SensorKind =
  | 'vibration'
  | 'pressure'
  | 'temperature'
  | 'voltage'
  | 'flow';

export interface SensorRegistryRow {
  id: string;
  channel: number;
  name: string;
  kind: SensorKind;
  unit: string;
  subsystem: string;
  unit_id: string;
  nominal_min: number;
  nominal_max: number;
}

export interface RateMessage {
  type: 'rate';
  samples_per_sec: number;
  batches_per_sec: number;
  persisted_aggregates: number;
  alerts_total: number;
  bridge_buffered_samples: number;
  last_write_latency_ms: number;
}

export interface LiveMessage {
  type: 'live';
  sensor_id: string;
  ts: number;
  value: number;
}

export interface AlertMessage {
  type: 'alert';
  id: string;
  sensor_id: string;
  sensor_name: string;
  sensor_kind: SensorKind;
  unit_id: string;
  subsystem: string;
  ts: number;
  value: number;
  detector: 'z-score' | 'step-detector' | 'debounced-z';
  score: number;
  baseline_mean: number;
  baseline_stddev: number;
  anomaly_id: string | null;
  cluster_with: string[];
}

export type BridgeMessage = RateMessage | LiveMessage | AlertMessage;

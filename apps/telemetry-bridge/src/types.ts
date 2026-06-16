/**
 * Shared types between the bridge service, the browser simulator, and
 * the /dcu page. Kept dependency-free so the worker can re-import them
 * via a relative path on the aerospace-rca side.
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

/** One raw sample from the simulator. */
export interface Sample {
  sensor_id: string;
  value: number;
}

/** Batched sample message — simulator → bridge over /ingest. */
export interface IngestBatchMessage {
  type: 'samples';
  /** Wall-clock ms at the time of the batch. */
  ts: number;
  samples: Sample[];
}

/** Bridge → UI rate update (10 Hz). */
export interface RateMessage {
  type: 'rate';
  samples_per_sec: number;
  batches_per_sec: number;
  persisted_aggregates: number;
  alerts_total: number;
  bridge_buffered_samples: number;
  last_write_latency_ms: number;
}

/** Bridge → UI live sample (only for subscribed sensors). */
export interface LiveMessage {
  type: 'live';
  sensor_id: string;
  ts: number;
  value: number;
}

/** UI → Bridge subscription. */
export interface SubscribeMessage {
  type: 'subscribe';
  sensor_ids: string[];
}

/** Bridge → UI when a detection fires. */
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
  /** Set when the alert was promoted into the U1 anomalies table. */
  anomaly_id: string | null;
  /** True when this fires on a sensor whose unit_id has already alerted in this run. */
  cluster_with: string[];
}

export type BridgeToUiMessage = RateMessage | LiveMessage | AlertMessage;
export type SimToBridgeMessage = IngestBatchMessage;
export type UiToBridgeMessage = SubscribeMessage;

/** Internal alert event — pre-WS shape used by detector and persister. */
export interface AlertEvent {
  id: string;
  sensor_id: string;
  sensor_name: string;
  sensor_kind: SensorKind;
  unit_id: string;
  subsystem: string;
  ts: number; // ms
  value: number;
  detector: 'z-score' | 'step-detector' | 'debounced-z';
  score: number;
  baseline_mean: number;
  baseline_stddev: number;
}

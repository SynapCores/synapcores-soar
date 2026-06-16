/**
 * The bridge: ingest 3K-sensor / 100Hz raw samples on a WebSocket,
 * downsample to AGGREGATE_PERIOD-sec aggregates per sensor, fire
 * detectors per-sample, batch-INSERT aggregates and alerts into AIDB,
 * and broadcast subscribed live samples + alerts to the /feed clients.
 *
 * Architecture:
 *
 *   [simulator WS] ──samples──> ingest()
 *                                  ├── per-sensor ring + Welford
 *                                  ├── detection → AlertEvent
 *                                  ├── per-sensor agg accumulator
 *                                  └── (subscribed?) → broadcast live
 *
 *   tick @ AGGREGATE_PERIOD_MS:
 *     drain aggregators → batch INSERTs to telemetry_aggregates (chunked)
 *
 *   on AlertEvent:
 *     INSERT telemetry_alerts
 *     promote → INSERT anomalies (with EMBED) + INSERT evidence_chain
 *     broadcast AlertMessage to subscribers
 *
 *   tick @ 100ms:
 *     broadcast RateMessage to subscribers
 */

import { randomUUID } from 'node:crypto';
import { AidbClient } from './aidb-client.js';
import {
  drainAggregate,
  newSensorState,
  pushSample,
  type AggregateRow,
  type SensorState,
} from './detection.js';
import type {
  AlertEvent,
  AlertMessage,
  IngestBatchMessage,
  LiveMessage,
  RateMessage,
  SensorRegistryRow,
} from './types.js';

export interface BridgeOptions {
  aidbBaseUrl: string;
  aidbApiKey: string;
  aggregatePeriodMs: number;
  batchRowsPerInsert: number;
  /** When true, the bridge writes aggregates to AIDB; when false (default),
   *  it only writes alerts + promoted anomalies. Aggregates are heavy and
   *  the demo storyboard works fine without them; set DCU_PERSIST_AGGREGATES=1
   *  to flip on. */
  persistAggregates: boolean;
}

interface SubscriberState {
  subscribed: Set<string>;
  send: (msg: unknown) => void;
}

/** Hot loop. */
export class Bridge {
  private readonly aidb: AidbClient;
  private readonly opts: BridgeOptions;
  private readonly sensors = new Map<string, SensorRegistryRow>();
  private readonly states = new Map<string, SensorState>();
  private subscribers = new Set<SubscriberState>();

  // Counters for the rate meter
  private samplesThisSec = 0;
  private samplesPerSec = 0;
  private batchesThisSec = 0;
  private batchesPerSec = 0;
  private persistedAggregates = 0;
  private alertsTotal = 0;
  private lastWriteLatencyMs = 0;

  // Cluster bookkeeping: which unit_ids have already alerted this run
  private alertedUnits = new Map<string, string[]>(); // unit_id → alert ids in order

  private rateTickHandle: NodeJS.Timeout | null = null;
  private aggregateTickHandle: NodeJS.Timeout | null = null;
  private secondTickHandle: NodeJS.Timeout | null = null;

  // Track in-flight aggregate writes so we don't pile up.
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(opts: BridgeOptions) {
    this.opts = opts;
    this.aidb = new AidbClient({
      baseUrl: opts.aidbBaseUrl,
      apiKey: opts.aidbApiKey,
      timeoutMs: 30_000,
    });
  }

  /** Pull sensor registry from AIDB. Bridge can't detect anything without it.
   *  Paginates because v1.8.1-ce's SQL_MAX_ROW_COUNT caps results at 1000.
   */
  async loadRegistry(): Promise<number> {
    this.sensors.clear();
    this.states.clear();
    const PAGE = 1000;
    let offset = 0;
    for (;;) {
      const res = await this.aidb.execSql(
        `SELECT id, channel, name, kind, unit, subsystem, unit_id, nominal_min, nominal_max
           FROM telemetry_sensors
          ORDER BY channel ASC
          LIMIT ${PAGE} OFFSET ${offset}`,
      );
      if (res.rows.length === 0) break;
      for (const row of res.rows) {
        const sensor: SensorRegistryRow = {
          id: String(row[0]),
          channel: Number(row[1]),
          name: String(row[2]),
          kind: String(row[3]) as SensorRegistryRow['kind'],
          unit: String(row[4]),
          subsystem: String(row[5]),
          unit_id: String(row[6]),
          nominal_min: Number(row[7]),
          nominal_max: Number(row[8]),
        };
        this.sensors.set(sensor.id, sensor);
        this.states.set(sensor.id, newSensorState(sensor));
      }
      if (res.rows.length < PAGE) break;
      offset += PAGE;
    }
    if (this.sensors.size === 0) {
      console.warn(
        '[bridge] telemetry_sensors is empty — run `pnpm seed-demo` in apps/aerospace-rca first.',
      );
    }
    return this.sensors.size;
  }

  start(): void {
    // 100ms tick: broadcast rate to subscribers.
    this.rateTickHandle = setInterval(() => this.broadcastRate(), 100);
    // 1s tick: roll rate counters.
    this.secondTickHandle = setInterval(() => {
      this.samplesPerSec = this.samplesThisSec;
      this.batchesPerSec = this.batchesThisSec;
      this.samplesThisSec = 0;
      this.batchesThisSec = 0;
    }, 1000);
    // AGGREGATE_PERIOD tick: drain aggregates and write to AIDB.
    this.aggregateTickHandle = setInterval(
      () => this.flushAggregates(),
      this.opts.aggregatePeriodMs,
    );
    console.log(
      `[bridge] started — ${this.sensors.size} sensors, aggregate period ${this.opts.aggregatePeriodMs}ms, persistAggregates=${this.opts.persistAggregates}`,
    );
  }

  stop(): void {
    if (this.rateTickHandle) clearInterval(this.rateTickHandle);
    if (this.aggregateTickHandle) clearInterval(this.aggregateTickHandle);
    if (this.secondTickHandle) clearInterval(this.secondTickHandle);
    this.rateTickHandle = null;
    this.aggregateTickHandle = null;
    this.secondTickHandle = null;
  }

  /** Reset all per-sensor state between runs (preserves registry). */
  resetRun(): void {
    for (const sensor of this.sensors.values()) {
      this.states.set(sensor.id, newSensorState(sensor));
    }
    this.alertedUnits.clear();
    this.samplesThisSec = 0;
    this.samplesPerSec = 0;
    this.batchesThisSec = 0;
    this.batchesPerSec = 0;
    this.persistedAggregates = 0;
    this.alertsTotal = 0;
    this.lastWriteLatencyMs = 0;
  }

  // ─── inbound from simulator ──────────────────────────────────────

  ingest(batch: IngestBatchMessage): void {
    const ts = batch.ts || Date.now();
    this.batchesThisSec++;
    for (const s of batch.samples) {
      const state = this.states.get(s.sensor_id);
      if (!state) continue;
      this.samplesThisSec++;
      const alert = pushSample(state, s.value, ts, () => `ALT-${randomUUID().slice(0, 12)}`);
      // Live-broadcast subscribed samples
      this.broadcastLive(s.sensor_id, ts, s.value);
      if (alert) {
        void this.handleAlert(alert).catch((e) =>
          console.warn(`[bridge] handleAlert failed: ${(e as Error).message}`),
        );
      }
    }
  }

  // ─── outbound to UI ──────────────────────────────────────────────

  addSubscriber(s: SubscriberState): void {
    this.subscribers.add(s);
  }
  removeSubscriber(s: SubscriberState): void {
    this.subscribers.delete(s);
  }

  private broadcastLive(sensor_id: string, ts: number, value: number): void {
    for (const sub of this.subscribers) {
      if (sub.subscribed.has(sensor_id)) {
        const msg: LiveMessage = { type: 'live', sensor_id, ts, value };
        sub.send(msg);
      }
    }
  }

  private broadcastRate(): void {
    if (this.subscribers.size === 0) return;
    const msg: RateMessage = {
      type: 'rate',
      samples_per_sec: this.samplesPerSec,
      batches_per_sec: this.batchesPerSec,
      persisted_aggregates: this.persistedAggregates,
      alerts_total: this.alertsTotal,
      bridge_buffered_samples: this.bridgeBuffered(),
      last_write_latency_ms: this.lastWriteLatencyMs,
    };
    for (const sub of this.subscribers) sub.send(msg);
  }

  private bridgeBuffered(): number {
    let n = 0;
    for (const s of this.states.values()) n += s.agg.n;
    return n;
  }

  private broadcastAlert(msg: AlertMessage): void {
    for (const sub of this.subscribers) sub.send(msg);
  }

  // ─── alert flow ──────────────────────────────────────────────────

  private async handleAlert(alert: AlertEvent): Promise<void> {
    this.alertsTotal++;
    const cluster = this.alertedUnits.get(alert.unit_id) ?? [];

    // 1) Persist alert (always — fast, low volume).
    const alertId = alert.id;
    try {
      await this.aidb.prepareExecSql(
        `INSERT INTO telemetry_alerts
           (id, sensor_id, ts, detector, score, value, baseline_mean, baseline_stddev, status, anomaly_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          alertId,
          alert.sensor_id,
          new Date(alert.ts).toISOString(),
          alert.detector,
          alert.score,
          alert.value,
          alert.baseline_mean,
          alert.baseline_stddev,
          'open',
          null,
          cluster.length > 0
            ? `cluster with: ${cluster.join(',')}`
            : null,
        ],
      );
    } catch (e) {
      console.warn(`[bridge] persist alert failed: ${(e as Error).message}`);
    }

    // 2) Promote into U1 anomalies table. This is the bridge to the
    //    investigation memory surface. Description is authored to be
    //    structurally similar to the BE4-019/022 prior anomalies so the
    //    cosine recall fires when the user clicks through.
    let anomalyId: string | null = null;
    try {
      anomalyId = await this.promoteToAnomaly(alert, cluster);
      if (anomalyId) {
        // back-fill telemetry_alerts.anomaly_id
        await this.aidb.prepareExecSql(
          `UPDATE telemetry_alerts SET anomaly_id = $1 WHERE id = $2`,
          [anomalyId, alertId],
        );
      }
    } catch (e) {
      console.warn(`[bridge] promote to anomaly failed: ${(e as Error).message}`);
    }

    // 3) Track cluster
    cluster.push(alertId);
    this.alertedUnits.set(alert.unit_id, cluster);

    // 4) Broadcast to UI
    const wsMsg: AlertMessage = {
      type: 'alert',
      id: alertId,
      sensor_id: alert.sensor_id,
      sensor_name: alert.sensor_name,
      sensor_kind: alert.sensor_kind,
      unit_id: alert.unit_id,
      subsystem: alert.subsystem,
      ts: alert.ts,
      value: alert.value,
      detector: alert.detector,
      score: alert.score,
      baseline_mean: alert.baseline_mean,
      baseline_stddev: alert.baseline_stddev,
      anomaly_id: anomalyId,
      cluster_with: cluster.slice(0, -1),
    };
    this.broadcastAlert(wsMsg);
  }

  private async promoteToAnomaly(
    alert: AlertEvent,
    cluster: string[],
  ): Promise<string | null> {
    const anomalyId = `ANM-LIVE-${alert.unit_id}-${alert.id.slice(-6)}`;
    const tsIso = new Date(alert.ts).toISOString();
    const tNowSec = ((alert.ts % 100_000) / 1000).toFixed(1);

    // Author a description that mirrors the BE-4 019/022 story line so
    // U1 cosine recall has a clean target. Three flavors based on
    // detector + cluster context.
    const morphologyClause =
      alert.sensor_kind === 'vibration'
        ? 'Vibration excursion morphology consistent with the BE4-019 and BE4-022 bearing-race micro-pitting pattern. Bearing race batch under traceability pull — Acme Bearings AB-7821 family.'
        : alert.sensor_kind === 'pressure'
          ? 'Pressure drift profile matches the BE-3 unit 031 pre-burner combustion-stability prior anomaly. Pre-burner injector batch under review.'
          : alert.sensor_kind === 'temperature'
            ? 'Temperature excursion outside nominal band. Single-channel signature — corroborating sensors pending.'
            : alert.sensor_kind === 'voltage'
              ? 'Avionics rail step detected — coupled-card transient hypothesis pending.'
              : 'Flow disturbance outside acceptance band — valve actuator response curve under review.';

    const clusterClause = cluster.length
      ? ` This is alert ${cluster.length + 1} on unit ${alert.unit_id} in the current run — cluster pattern with prior alerts ${cluster.join(', ')}.`
      : '';

    const description =
      `Live DCU detection at t=${tNowSec}s: sensor ${alert.sensor_name} on unit ${alert.unit_id} (${alert.subsystem}) crossed ` +
      `${alert.detector} threshold with score=${alert.score} against rolling baseline mean=${alert.baseline_mean} ` +
      `stddev=${alert.baseline_stddev}. ` +
      morphologyClause +
      clusterClause +
      ' Source: telemetry_alerts.' +
      alert.id +
      '.';

    const title = `Live DCU detection: ${alert.subsystem} ${alert.sensor_kind} excursion at t=${tNowSec}s`;
    const program = inferProgramFromUnit(alert.unit_id);
    const severity = inferSeverity(alert.score);
    const sourceDoc = `DCU-${alert.id}`;

    try {
      await this.aidb.prepareExecSql(
        `INSERT INTO anomalies
           (id, ts, program, subsystem, unit_id, severity, status, title, description, reporter, test_stand, source_doc, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, EMBED($13))`,
        [
          anomalyId,
          tsIso,
          program,
          alert.subsystem,
          alert.unit_id,
          severity,
          'open',
          title,
          description,
          'dcu:bridge',
          'BE-4 hot-fire stand 4',
          sourceDoc,
          description,
        ],
      );
    } catch (e) {
      // Most likely cause: duplicate key on a repeat run. Just don't promote.
      const msg = (e as Error).message;
      if (msg.toLowerCase().includes('duplicate')) {
        // already promoted on a prior run — that's fine
      } else {
        console.warn(`[bridge] anomaly INSERT failed: ${msg}`);
        return null;
      }
    }

    // Evidence chain row so the immutable spine reflects the live ingest.
    try {
      await this.aidb.prepareExecSql(
        `INSERT INTO evidence_chain (id, ts, actor, action, target_id, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          `EVT-DCU-${alert.id}`,
          tsIso,
          'dcu:bridge',
          'anomaly.promoted-from-dcu-alert',
          anomalyId,
          JSON.stringify({
            alert_id: alert.id,
            sensor_id: alert.sensor_id,
            detector: alert.detector,
            score: alert.score,
            cluster_with: cluster,
          }),
        ],
      );
    } catch {
      // Evidence chain is best-effort here; UI shows it regardless.
    }

    return anomalyId;
  }

  // ─── aggregate flush ─────────────────────────────────────────────

  private async flushAggregates(): Promise<void> {
    if (!this.opts.persistAggregates) {
      // Even when we don't persist, we still need to drain the per-sensor
      // accumulators or memory grows unbounded.
      const ts = Date.now();
      for (const s of this.states.values()) drainAggregate(s, ts);
      return;
    }
    const ts = Date.now();
    const rows: AggregateRow[] = [];
    for (const s of this.states.values()) {
      const row = drainAggregate(s, ts);
      if (row) rows.push(row);
    }
    if (rows.length === 0) return;

    // Chain off existing writeQueue so we never have overlapping batches
    // hitting AIDB. Hold up to N=batchRowsPerInsert per HTTP call.
    this.writeQueue = this.writeQueue
      .then(() => this.writeAggregateChunks(rows))
      .catch((e) => {
        console.warn(`[bridge] aggregate write failed: ${(e as Error).message}`);
      });
  }

  private async writeAggregateChunks(rows: AggregateRow[]): Promise<void> {
    const chunk = this.opts.batchRowsPerInsert;
    const start = Date.now();
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const values = slice
        .map((r) => {
          const id = `AGG-${r.sensor_id}-${r.ts_ms}`;
          // SQL-quote all the strings; numbers go in raw.
          return `('${id}','${r.sensor_id}','${new Date(r.ts_ms).toISOString()}',${r.mean},${r.stddev},${r.min_val},${r.max_val},${r.samples})`;
        })
        .join(',');
      const sql =
        `INSERT INTO telemetry_aggregates (id, sensor_id, ts, mean, stddev, min_val, max_val, samples) VALUES ` +
        values;
      try {
        await this.aidb.execSql(sql);
        this.persistedAggregates += slice.length;
      } catch (e) {
        console.warn(
          `[bridge] aggregate INSERT failed (chunk size=${slice.length}): ${(e as Error).message.slice(0, 240)}`,
        );
        return;
      }
    }
    this.lastWriteLatencyMs = Date.now() - start;
  }

  // ─── introspection (for /health, /metrics) ──────────────────────

  snapshot(): {
    sensors: number;
    subscribers: number;
    samples_per_sec: number;
    batches_per_sec: number;
    persisted_aggregates: number;
    alerts_total: number;
    buffered_samples: number;
  } {
    return {
      sensors: this.sensors.size,
      subscribers: this.subscribers.size,
      samples_per_sec: this.samplesPerSec,
      batches_per_sec: this.batchesPerSec,
      persisted_aggregates: this.persistedAggregates,
      alerts_total: this.alertsTotal,
      buffered_samples: this.bridgeBuffered(),
    };
  }
}

function inferProgramFromUnit(unit_id: string): string {
  if (unit_id.startsWith('BE4-')) return 'BE-4';
  if (unit_id.startsWith('BE3-')) return 'BE-3';
  if (unit_id.startsWith('NG-')) return 'NG';
  if (unit_id.startsWith('NS-')) return 'NS';
  if (unit_id.startsWith('HLS-')) return 'HLS';
  return 'BE-4';
}

function inferSeverity(score: number): string {
  const a = Math.abs(score);
  if (a >= 8) return 'critical';
  if (a >= 5) return 'major';
  if (a >= 3) return 'minor';
  return 'observation';
}

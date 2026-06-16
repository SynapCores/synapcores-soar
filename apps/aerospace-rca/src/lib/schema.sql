-- ============================================================================
-- @synapcores/aerospace-rca — domain schema
-- ============================================================================
-- Single-tenant demo. Tables hold the engineering-anomaly corpus, the
-- graph-of-record (parts/suppliers/programs), agent run log, and the
-- immutable evidence chain that's the Blue Origin pitch's keystone.
-- ============================================================================

-- Anomalies — every flagged test-stand event, post-flight observation,
-- supplier escape. The `embedding` column is what makes "have we seen
-- this before?" a 50 ms cosine query instead of a 3-day SharePoint hunt.
CREATE TABLE IF NOT EXISTS anomalies (
  id          TEXT PRIMARY KEY,
  ts          TIMESTAMP NOT NULL,
  program     TEXT NOT NULL,
  subsystem   TEXT NOT NULL,
  unit_id     TEXT NOT NULL,
  severity    TEXT NOT NULL,
  status      TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  reporter    TEXT NOT NULL,
  test_stand  TEXT,
  source_doc  TEXT,
  embedding   VECTOR(384)
);

CREATE INDEX IF NOT EXISTS idx_anomalies_program ON anomalies(program);
CREATE INDEX IF NOT EXISTS idx_anomalies_status  ON anomalies(status);
CREATE INDEX IF NOT EXISTS idx_anomalies_ts      ON anomalies(ts);

-- Parts master — each part links to its supplier and the programs it
-- ships into. The cross-program reuse is what makes a single corrective
-- action propagation question into a graph traversal.
CREATE TABLE IF NOT EXISTS parts (
  id          TEXT PRIMARY KEY,
  part_number TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  subsystem   TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  programs    TEXT NOT NULL
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  tier  INTEGER NOT NULL,
  city  TEXT,
  state TEXT
);

-- Corrective actions — the patch that closed a prior anomaly. The
-- `applied_to_programs` column is what reveals "we fixed this on BE-4
-- but never propagated to BE-3 / NG" in one query.
CREATE TABLE IF NOT EXISTS corrective_actions (
  id                  TEXT PRIMARY KEY,
  anomaly_id          TEXT NOT NULL,
  ts                  TIMESTAMP NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  owner               TEXT NOT NULL,
  status              TEXT NOT NULL,
  applied_to_programs TEXT,
  embedding           VECTOR(384)
);

CREATE INDEX IF NOT EXISTS idx_ca_anomaly ON corrective_actions(anomaly_id);

-- RFAs — Requests for Action. The NASA OIG IG-26-004 backlog category.
-- Some have an owner that has left (departed_employees join) — that's
-- the "bureaucracy fault line" the Safety Officer agent surfaces in Act 4.
CREATE TABLE IF NOT EXISTS rfas (
  id                 TEXT PRIMARY KEY,
  opened_ts          TIMESTAMP NOT NULL,
  program            TEXT NOT NULL,
  subsystem          TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,
  owner              TEXT NOT NULL,
  status             TEXT NOT NULL,
  days_open          INTEGER NOT NULL,
  related_anomaly_id TEXT,
  related_part_id    TEXT,
  embedding          VECTOR(384)
);

CREATE INDEX IF NOT EXISTS idx_rfas_status  ON rfas(status);
CREATE INDEX IF NOT EXISTS idx_rfas_program ON rfas(program);

-- Departed employees — small lookup used by the Safety Officer agent.
CREATE TABLE IF NOT EXISTS departed_employees (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  departed   TIMESTAMP NOT NULL
);

-- Agent run log — every Reliability / Safety Officer call gets persisted
-- so the detail page can show the latest finding without re-running.
CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY,
  ts          TIMESTAMP NOT NULL,
  persona     TEXT NOT NULL,
  anomaly_id  TEXT,
  task        TEXT NOT NULL,
  result      TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_anomaly ON agent_runs(anomaly_id);

-- IMMUTABLE evidence chain — append-only, FAA-defensible chain of custody
-- for every action. Engine enforces append-only; UPDATEs are rejected.
CREATE IMMUTABLE TABLE IF NOT EXISTS evidence_chain (
  id        TEXT PRIMARY KEY,
  ts        TIMESTAMP NOT NULL,
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details   TEXT NOT NULL
);

-- ============================================================================
-- U6 — DCU live telemetry detection
-- ============================================================================
-- Three tables that live next to the U1 corpus. The DCU bridge service
-- (apps/telemetry-bridge/) writes here at runtime from a Web Worker
-- simulator running on the /dcu page. AIDB only sees the meaningful
-- 0.3% of the stream — per-sensor 1Hz/0.2Hz aggregates + detected
-- alert events. Raw 100Hz samples never hit the engine; the bridge
-- holds them in-memory in a ring buffer and computes z-score detection
-- before deciding what to persist.
-- ============================================================================

-- Sensor registry: the 3K sensors the simulator authors. Loaded by
-- bin/seed-demo.mjs once at setup; the bridge reads it at startup
-- to know which detection thresholds apply to which channel.
CREATE TABLE IF NOT EXISTS telemetry_sensors (
  id          TEXT PRIMARY KEY,
  channel     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  unit        TEXT NOT NULL,
  subsystem   TEXT NOT NULL,
  unit_id     TEXT NOT NULL,
  nominal_min REAL,
  nominal_max REAL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_sensors_unit ON telemetry_sensors(unit_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_sensors_kind ON telemetry_sensors(kind);

-- 1Hz / 0.2Hz aggregated telemetry — what the bridge persists. Honest:
-- the rate meter on /dcu showing "300K samples/sec" is what the
-- in-memory bridge handled; what landed in this table is N rows/sec
-- depending on DCU_AGGREGATE_PERIOD_MS.
CREATE TABLE IF NOT EXISTS telemetry_aggregates (
  id        TEXT PRIMARY KEY,
  sensor_id TEXT NOT NULL,
  ts        TIMESTAMP NOT NULL,
  mean      REAL NOT NULL,
  stddev    REAL NOT NULL,
  min_val   REAL NOT NULL,
  max_val   REAL NOT NULL,
  samples   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_aggregates_sensor_ts
  ON telemetry_aggregates(sensor_id, ts);

-- Detection events — every alert the bridge fires. Promoted alerts
-- back-fill `anomaly_id` once the U1 anomaly row is inserted, so the
-- UI's "Open Investigation" deep-link has a target.
CREATE TABLE IF NOT EXISTS telemetry_alerts (
  id              TEXT PRIMARY KEY,
  sensor_id       TEXT NOT NULL,
  ts              TIMESTAMP NOT NULL,
  detector        TEXT NOT NULL,
  score           REAL NOT NULL,
  value           REAL NOT NULL,
  baseline_mean   REAL NOT NULL,
  baseline_stddev REAL NOT NULL,
  status          TEXT NOT NULL,
  anomaly_id      TEXT,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_alerts_ts        ON telemetry_alerts(ts);
CREATE INDEX IF NOT EXISTS idx_telemetry_alerts_sensor    ON telemetry_alerts(sensor_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_alerts_anomaly   ON telemetry_alerts(anomaly_id);

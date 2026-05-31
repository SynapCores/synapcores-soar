-- ===========================================================================
-- @synapcores/soar v0.2.0 — schema migration for the SOAR Demo Completion
-- ===========================================================================
-- Adds the columns the closed-loop learning module + similar-incident
-- retrieval need. Run idempotently — every ALTER is guarded.
--
-- Engine notes:
--   - JSON columns store the structured arrays (entity ids, event-type
--     sequence). The engine's TEXT type backs JSON in CE.
--   - VECTOR(384) embeddings are populated by close-incident.ts via EMBED().
--   - All-new columns are nullable so existing rows continue to load.
-- ===========================================================================

-- Closed-loop learning fields on the incident row
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMP;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS final_root_cause TEXT;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS final_resolution TEXT;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS analyst_notes TEXT;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS outcome_status TEXT;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS remediation_outcome TEXT;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS mttd_seconds INTEGER;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS mttt_seconds INTEGER;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS mttr_seconds INTEGER;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS embedding VECTOR(384);
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS affected_entities TEXT;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS event_type_sequence TEXT;
ALTER TABLE soar_incidents ADD COLUMN IF NOT EXISTS graph_pattern_signature TEXT;

-- Make alert event-type explicit (was inferred from `source` previously)
ALTER TABLE soar_alerts ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE soar_alerts ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- RCA agent output cache, attached to incident
CREATE TABLE IF NOT EXISTS soar_rca (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  incident_id     TEXT NOT NULL,
  ts              TIMESTAMP NOT NULL,
  root_cause      TEXT,
  confidence      FLOAT,
  evidence        TEXT,        -- JSON array
  recommended_actions TEXT,    -- JSON array of action_ids
  blast_radius    TEXT,
  business_impact TEXT,
  rollback_path   TEXT,
  raw_output      TEXT
);

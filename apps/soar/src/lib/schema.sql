-- ============================================================================
-- @synapcores/soar — domain schema
-- ============================================================================
-- Eight row tables + one IMMUTABLE audit table. Every row carries a
-- tenant_id; every query in the app filters on it (framework's logical
-- multi-tenancy model — Phase 8 swaps to per-tenant SynapCores tenants
-- for true physical isolation).
-- ============================================================================

-- Alerts: the firehose. Triage agent dedups + scores; analyst sees the
-- non-duplicate 5%.
CREATE TABLE IF NOT EXISTS soar_alerts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  source          TEXT NOT NULL,              -- 'splunk' | 'crowdstrike' | 'okta' | ...
  source_alert_id TEXT,                       -- upstream system's ID
  severity        TEXT NOT NULL,              -- 'critical' | 'high' | 'medium' | 'low' | 'info'
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL,              -- 'new' | 'triaged' | 'duplicate' | 'incident' | 'closed'
  status_reason   TEXT,
  dup_of          TEXT,                       -- alert id this duplicates
  semantic_vec    VECTOR(384),                -- minilm embedding of title+description
  raw_payload     JSON,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  triaged_at      TIMESTAMP,
  closed_at       TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_soar_alerts_tenant_status_created
  ON soar_alerts(tenant_id, status, created_at);

-- Assets: hosts, cloud resources, applications. The "what" of an alert.
CREATE TABLE IF NOT EXISTS soar_assets (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,                  -- 'host' | 'vm' | 'container' | 'cloud_resource' | 'application'
  name        TEXT NOT NULL,
  source      TEXT,                           -- where we learned of it (cmdb, edr, csp)
  properties  JSON,
  criticality TEXT,                           -- 'tier1' | 'tier2' | 'tier3' (business-tier)
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soar_assets_tenant ON soar_assets(tenant_id);

-- Identities: users, service accounts. The "who".
CREATE TABLE IF NOT EXISTS soar_identities (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  email       TEXT,
  display_name TEXT,
  source      TEXT,                           -- 'okta' | 'azure_ad' | 'gws' | ...
  kind        TEXT,                           -- 'human' | 'service' | 'system'
  properties  JSON,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soar_identities_tenant ON soar_identities(tenant_id);

-- Incidents: alerts the triage agent escalated. Owns playbook runs +
-- evidence.
CREATE TABLE IF NOT EXISTS soar_incidents (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL,                -- 'open' | 'investigating' | 'responding' | 'closed'
  assigned_to   TEXT,                         -- user_id
  playbook_id   TEXT,                         -- the matched playbook
  opened_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMP,
  close_reason  TEXT,
  summary       TEXT
);

CREATE INDEX IF NOT EXISTS idx_soar_incidents_tenant_status_opened
  ON soar_incidents(tenant_id, status, opened_at);

-- Junction: incidents ↔ alerts (one incident can roll up many alerts).
CREATE TABLE IF NOT EXISTS soar_incident_alerts (
  incident_id TEXT NOT NULL,
  alert_id    TEXT NOT NULL,
  PRIMARY KEY (incident_id, alert_id)
);

-- Playbooks: response runbooks. Stored as JSON DAG; rendered by the
-- authoring UI; executed by the incident-responder agent.
CREATE TABLE IF NOT EXISTS soar_playbooks (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  match_when  JSON,                           -- conditions that auto-match this playbook
  steps       JSON NOT NULL,                  -- DAG of actions
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT NOT NULL,                  -- user_id
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soar_playbooks_tenant ON soar_playbooks(tenant_id);

-- Evidence: tamper-evident artefacts attached to an incident
-- (screenshots, hash snapshots, exported logs, chain-of-custody notes).
CREATE TABLE IF NOT EXISTS soar_evidence (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  incident_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,                 -- 'log' | 'screenshot' | 'hash' | 'note' | 'tool_output'
  label        TEXT,
  payload      JSON,                          -- the artefact itself or a pointer
  sha256       TEXT,                          -- content hash for verification
  collected_by TEXT,                          -- user_id or agent name
  collected_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soar_evidence_tenant_incident
  ON soar_evidence(tenant_id, incident_id);

-- Threat intel: IOCs we care about. The threat-hunter agent rescans
-- historical access against new IOC drops.
CREATE TABLE IF NOT EXISTS soar_threat_intel (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  ioc_type   TEXT NOT NULL,                   -- 'ip' | 'domain' | 'hash_sha256' | 'cve' | 'tactic_id'
  ioc_value  TEXT NOT NULL,
  source     TEXT NOT NULL,                   -- 'misp' | 'opencti' | 'recorded_future' | ...
  confidence INTEGER,                         -- 0-100
  tags       JSON,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soar_threat_intel_tenant_value
  ON soar_threat_intel(tenant_id, ioc_value);

-- Per-tenant integration configurations. BYO credentials for the
-- external systems we dispatch actions to + ingest alerts from.
-- The secret_payload column holds JSON keyed by provider-specific
-- shapes (e.g. {"api_token":"sk_..."} for CrowdStrike). It is stored
-- encrypted at rest by the engine when the column type supports it,
-- or framework-encrypted before INSERT in production.
CREATE TABLE IF NOT EXISTS soar_integrations (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  provider      TEXT NOT NULL,              -- 'crowdstrike' | 'okta' | 'slack' | 'servicenow' | ...
  label         TEXT NOT NULL,              -- humanly readable, e.g. "Acme Bank prod tenant"
  secret_payload JSON,                      -- provider-specific credentials + config
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP NOT NULL,
  last_used_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_soar_integrations_tenant
  ON soar_integrations(tenant_id, provider);

-- Action dispatch ledger. Every action the action layer attempts —
-- regardless of HBR gating — writes a row here for traceability.
-- soar_audit_log records the high-level event; this table holds the
-- request/response shape so analysts can re-run from a known-good
-- input.
CREATE TABLE IF NOT EXISTS soar_actions (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  incident_id  TEXT,                        -- nullable; ad-hoc actions
  alert_id     TEXT,
  action       TEXT NOT NULL,               -- 'isolate_endpoint' | 'disable_user' | ...
  target       TEXT,                        -- '<asset_id>' | '<identity_id>' | URL etc.
  request_payload  JSON,
  response_payload JSON,
  state        TEXT NOT NULL,               -- 'pending' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'rejected'
  requested_by TEXT NOT NULL,               -- user_id or agent name
  requested_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_soar_actions_tenant_state
  ON soar_actions(tenant_id, state, requested_at);

-- Approval queue — actions waiting on human go/no-go. The action layer
-- (Phase 6) writes here on HBR; the analyst resolves at /approvals
-- (Phase 7). Each row references the originating soar_actions row.
CREATE TABLE IF NOT EXISTS soar_approval_queue (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  action_id    TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMP NOT NULL,
  state        TEXT NOT NULL,               -- 'pending' | 'approved' | 'rejected' | 'expired'
  decided_by   TEXT,
  decided_at   TIMESTAMP,
  decision_note TEXT,
  expires_at   TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_soar_approval_queue_tenant_state
  ON soar_approval_queue(tenant_id, state, requested_at);

-- SOAR-domain audit log — IMMUTABLE. Every agent tool call, every
-- analyst action, every alert state change writes here. This is what
-- VERIFY_CHAIN runs against for the SOC 2 audit story.
CREATE IMMUTABLE TABLE IF NOT EXISTS soar_audit_log (
  event_id    INTEGER PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  ts          TIMESTAMP NOT NULL,
  actor_id    TEXT,
  actor_type  TEXT NOT NULL,                  -- 'analyst' | 'agent' | 'system' | 'mcp_token'
  action      TEXT NOT NULL,                  -- e.g. 'alert.ingest', 'alert.dedup', 'incident.open'
  alert_id    TEXT,
  incident_id TEXT,
  payload     JSON,
  request_id  TEXT
);

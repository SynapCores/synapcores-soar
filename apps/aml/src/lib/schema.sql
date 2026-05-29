-- ============================================================================
-- @synapcores/aml — domain schema
-- ============================================================================
-- Tenant-scoped throughout. Mirrors the SOAR shape (row tables + immutable
-- audit) with financial-crime semantics: transactions, customers, accounts,
-- sanctions hits, UBO relationships, cases, SARs.
-- ============================================================================

-- Customers (parties known to this workspace's KYC store)
CREATE TABLE IF NOT EXISTS aml_customers (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  external_id   TEXT,                       -- core-banking system's customer id
  name          TEXT NOT NULL,
  email         TEXT,
  kind          TEXT NOT NULL,              -- 'individual' | 'corporate' | 'msb'
  jurisdiction  TEXT,                       -- 'US' | 'GB' | 'CH' | ...
  risk_rating   TEXT,                       -- 'low' | 'medium' | 'high' | 'pep'
  kyc_status    TEXT,                       -- 'pending' | 'verified' | 'enhanced' | 'failed'
  properties    JSON,
  created_at    TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aml_customers_tenant ON aml_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aml_customers_external ON aml_customers(external_id);

-- Accounts (deposit / loan / wallet, grouped by customer)
CREATE TABLE IF NOT EXISTS aml_accounts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  customer_id   TEXT NOT NULL,
  account_number TEXT NOT NULL,
  type          TEXT NOT NULL,             -- 'deposit' | 'loan' | 'wallet' | 'card' | 'beneficiary'
  currency      TEXT,
  status        TEXT,                      -- 'active' | 'frozen' | 'closed'
  properties    JSON,
  created_at    TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aml_accounts_tenant ON aml_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aml_accounts_customer ON aml_accounts(customer_id);

-- Transactions (the firehose; structuring/velocity/peer detection happens here)
CREATE TABLE IF NOT EXISTS aml_transactions (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  source          TEXT NOT NULL,            -- 'core-banking' | 'ach' | 'swift' | 'fednow' | ...
  source_tx_id    TEXT,                     -- upstream id (for dedup-by-key)
  from_customer   TEXT,                     -- customer_id when known
  from_account    TEXT,                     -- account_number or external account
  to_counterparty TEXT,                     -- account_number, IBAN, address, beneficiary name
  to_country      TEXT,
  amount_usd      DECIMAL(18,2) NOT NULL,
  currency        TEXT NOT NULL,            -- ISO 4217
  type            TEXT NOT NULL,            -- 'wire' | 'ach' | 'card' | 'cash' | 'crypto' | 'check'
  narrative       TEXT,                     -- free-text wire memo / reference
  semantic_vec    VECTOR(384),              -- EMBED of narrative + counterparty
  status          TEXT NOT NULL,            -- 'new' | 'triaged' | 'sar_candidate' | 'cleared' | 'duplicate'
  status_reason   TEXT,
  dup_of          TEXT,                     -- tx id this duplicates
  flags           JSON,                     -- {structuring:true, velocity:true, round:true, ...}
  raw_payload     JSON,
  ts              TIMESTAMP NOT NULL,       -- when the tx actually happened upstream
  ingested_at     TIMESTAMP NOT NULL,
  triaged_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_aml_tx_tenant_status_ts
  ON aml_transactions(tenant_id, status, ts);
CREATE INDEX IF NOT EXISTS idx_aml_tx_tenant_customer_ts
  ON aml_transactions(tenant_id, from_customer, ts);
CREATE INDEX IF NOT EXISTS idx_aml_tx_source_tx_id
  ON aml_transactions(tenant_id, source, source_tx_id);

-- Sanctions / PEP / adverse-media hits
CREATE TABLE IF NOT EXISTS aml_sanctions_hits (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  customer_id     TEXT,
  transaction_id  TEXT,
  list_name       TEXT NOT NULL,            -- 'OFAC-SDN' | 'EU-Consolidated' | 'UN-1267' | 'PEP' | 'ADVERSE-MEDIA'
  matched_name    TEXT NOT NULL,
  match_score     DECIMAL(4,3),             -- 0.000 – 1.000
  status          TEXT NOT NULL,            -- 'pending' | 'true_positive' | 'false_positive'
  resolved_by     TEXT,
  resolved_at     TIMESTAMP,
  evidence        JSON,
  created_at      TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aml_sanctions_hits_tenant
  ON aml_sanctions_hits(tenant_id, status);

-- UBO ownership / control relationships (lets the sar-drafter agent walk
-- the entity graph in Phase 3)
CREATE TABLE IF NOT EXISTS aml_ubo_relationships (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  owner_id        TEXT NOT NULL,            -- aml_customers.id (could be a corporate)
  beneficial_id   TEXT NOT NULL,            -- aml_customers.id (natural person UBO)
  kind            TEXT NOT NULL,            -- 'owns' | 'controls' | 'director' | 'authorized_signer'
  percentage      DECIMAL(5,2),
  source          TEXT NOT NULL,            -- 'opencorporates' | 'self_declared' | 'commercial_registry'
  created_at      TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aml_ubo_tenant_owner
  ON aml_ubo_relationships(tenant_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_aml_ubo_tenant_beneficial
  ON aml_ubo_relationships(tenant_id, beneficial_id);

-- Cases (a case rolls up 1..N transactions for a SAR-candidate or
-- regulator-defensible investigation)
CREATE TABLE IF NOT EXISTS aml_cases (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  title           TEXT NOT NULL,
  severity        TEXT NOT NULL,            -- 'critical' | 'high' | 'medium' | 'low'
  status          TEXT NOT NULL,            -- 'open' | 'investigating' | 'sar_drafted' | 'sar_filed' | 'closed'
  primary_customer TEXT,
  primary_tx      TEXT,
  assigned_to     TEXT,
  opened_at       TIMESTAMP NOT NULL,
  closed_at       TIMESTAMP,
  summary         TEXT
);

CREATE INDEX IF NOT EXISTS idx_aml_cases_tenant_status_opened
  ON aml_cases(tenant_id, status, opened_at);

-- Junction: cases ↔ transactions
CREATE TABLE IF NOT EXISTS aml_case_transactions (
  case_id        TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  PRIMARY KEY (case_id, transaction_id)
);

-- SAR drafts + filings (jurisdiction-specific narrative template applied)
CREATE TABLE IF NOT EXISTS aml_sars (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  case_id             TEXT NOT NULL,
  jurisdiction        TEXT NOT NULL,        -- 'us-fincen' | 'uk-nca' | 'au-austrac' | 'ca-fintrac' | 'eu-goaml'
  status              TEXT NOT NULL,        -- 'draft' | 'review' | 'approved' | 'filed' | 'rejected'
  draft_narrative     TEXT,                 -- agent output
  final_narrative     TEXT,                 -- analyst-edited
  drafted_by          TEXT,                 -- agent name or user_id
  approved_by         TEXT,                 -- user_id
  filed_by            TEXT,
  filed_at            TIMESTAMP,
  regulator_ack_id    TEXT,                 -- BSA E-Filing ack, etc.
  created_at          TIMESTAMP NOT NULL,
  updated_at          TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aml_sars_tenant_status
  ON aml_sars(tenant_id, status, created_at);

-- AML-domain immutable audit log
CREATE IMMUTABLE TABLE IF NOT EXISTS aml_audit_log (
  event_id    INTEGER PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  ts          TIMESTAMP NOT NULL,
  actor_id    TEXT,
  actor_type  TEXT NOT NULL,                -- 'analyst' | 'agent' | 'system' | 'mcp_token'
  action      TEXT NOT NULL,                -- 'tx.ingest' | 'tx.flag' | 'case.open' | 'sar.draft' | ...
  transaction_id TEXT,
  case_id        TEXT,
  sar_id         TEXT,
  payload        JSON,
  request_id     TEXT
);

-- ============================================================================
-- @synapcores/app-framework — base schema
-- ============================================================================
-- This is the framework's tenancy + auth + audit foundation. Every app
-- bootstraps these tables before adding its own domain schema. The
-- framework's `bootstrap()` runs these IF NOT EXISTS.
--
-- Each app's tenant data lives in a separate SynapCores tenant (using
-- the engine's multi-tenant storage) — the tables below are in the
-- framework's "control plane" tenant. The framework spins up a tenant
-- on org creation and stores its API key on the row.
-- ============================================================================

-- Tenants (one per customer org)
CREATE TABLE IF NOT EXISTS tenants (
  id              TEXT PRIMARY KEY,           -- uuid
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  api_key_hash    TEXT NOT NULL,              -- bcrypt of the SynapCores tenant API key
  api_key_prefix  TEXT NOT NULL,              -- first 8 chars for display
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Free-form JSON for app-specific tenant settings (industry, jurisdiction, ...).
  settings        JSON
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- Users (one per human; can belong to multiple tenants)
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,         -- uuid
  email             TEXT NOT NULL UNIQUE,
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  name              TEXT,
  password_hash     TEXT,                     -- bcrypt; null = magic-link-only
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Memberships (which users belong to which tenants, with what role)
CREATE TABLE IF NOT EXISTS memberships (
  user_id     TEXT NOT NULL,
  tenant_id   TEXT NOT NULL,
  role        TEXT NOT NULL,                  -- owner|admin|analyst|viewer|auditor
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user   ON memberships(user_id);

-- Invitations (pending invites by email)
CREATE TABLE IF NOT EXISTS invitations (
  id           TEXT PRIMARY KEY,              -- uuid; also the magic-link token
  tenant_id    TEXT NOT NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL,
  invited_by   TEXT NOT NULL,                 -- user_id
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMP NOT NULL,
  accepted_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- Sessions (Auth.js JWT mode → we still want a sessions table for
-- "log out everywhere" + audit "user X was active on device Y at time T")
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,              -- session token (random)
  user_id      TEXT NOT NULL,
  tenant_id    TEXT,                          -- active tenant; null until first selection
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMP NOT NULL,
  revoked_at   TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Magic-link / password-reset / email-verification tokens
-- One table, polymorphic via `purpose`.
CREATE TABLE IF NOT EXISTS auth_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  purpose     TEXT NOT NULL,    -- 'magic-link' | 'password-reset' | 'email-verify'
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP NOT NULL,
  used_at     TIMESTAMP
);

-- MCP tokens for external auditors / examiners.
-- Scoped read-only, time-bound, every query they make writes to the audit log.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  token_hash   TEXT NOT NULL,                 -- bcrypt(token)
  label        TEXT NOT NULL,                 -- "Q3 SOC2 audit — Jane Smith @ ACME LLP"
  scope        JSON NOT NULL,                 -- {"tables":[...], "operations":["read"]}
  minted_by    TEXT NOT NULL,                 -- user_id
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMP NOT NULL,
  revoked_at   TIMESTAMP,
  last_used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_tenant ON mcp_tokens(tenant_id);

-- Personal API keys — programmatic access tokens minted by users for the
-- SDK / CLI / CI use. Scoped to a tenant + user; carry that user's
-- role at the time of mint (we don't re-resolve on use — if you change
-- the user's role, rotate the key).
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  label        TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,                  -- first 8 chars for display
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMP,
  revoked_at   TIMESTAMP,
  last_used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user   ON api_keys(user_id);

-- The framework-level audit log. Apps drop their own IMMUTABLE
-- domain-specific audit tables (e.g. soar.audit_log, aml.audit_log)
-- — this one captures the cross-cutting events (login, invite,
-- mcp-token mint, settings change, role change).
CREATE IMMUTABLE TABLE IF NOT EXISTS framework_audit_log (
  event_id    INTEGER PRIMARY KEY,
  ts          TIMESTAMP NOT NULL,
  tenant_id   TEXT,
  actor_id    TEXT,
  actor_type  TEXT NOT NULL,                  -- 'user' | 'system' | 'mcp_token'
  action      TEXT NOT NULL,                  -- e.g. 'auth.login', 'tenant.invite', 'mcp.mint'
  target_id   TEXT,
  payload     JSON,
  request_id  TEXT
);

#!/usr/bin/env node
/**
 * pnpm --filter @synapcores/workflow-studio bootstrap
 *
 * 1. Runs the app-framework bootstrap (creates users/tenants/memberships/sessions).
 * 2. Applies the workflow-studio domain schema (workflow_definitions, workflow_versions,
 *    workflow_runs, workflow_step_runs, workflow_approval_queue, workflow_deploys).
 * 3. Creates a default admin user if none exist yet.
 *
 * Required env:
 *   SYNAPCORES_URL           — engine base URL (default: http://127.0.0.1:28080)
 *   SYNAPCORES_API_KEY       — admin API key / JWT
 *   SYNAPCORES_ADMIN_API_KEY — alias for SYNAPCORES_API_KEY (either accepted)
 *
 * Optional:
 *   STUDIO_ADMIN_EMAIL    — default admin email (default: admin@localhost)
 *   STUDIO_ADMIN_PASSWORD — default admin password (default: change-me-now)
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

const baseUrl = (process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:28080').replace(/\/+$/, '');
const apiKey =
  process.env.SYNAPCORES_API_KEY ??
  process.env.SYNAPCORES_ADMIN_API_KEY;

if (!apiKey) {
  console.error('[workflow-studio-bootstrap] SYNAPCORES_API_KEY (or SYNAPCORES_ADMIN_API_KEY) is not set.');
  process.exit(2);
}

/** Execute a SQL statement against the engine. */
async function exec(sql) {
  const res = await fetch(`${baseUrl}/v1/query/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Silently skip "already exists" / "duplicate" errors — idempotent bootstrap.
    if (
      body.toLowerCase().includes('already exists') ||
      body.toLowerCase().includes('duplicate')
    ) {
      return null;
    }
    throw new Error(`[${res.status}] ${body.slice(0, 400)}`);
  }
  const json = await res.json();
  return (json.data ?? json);
}

/** Execute a parameterised statement (prepare → exec → close). */
async function execParam(sql, params) {
  const prep = await fetch(`${baseUrl}/v1/query/prepare`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ sql }),
  });
  if (!prep.ok) throw new Error(`prepare failed: ${await prep.text()}`);
  const { data } = await prep.json();
  const stmtId = data.statement_id;

  try {
    const ex = await fetch(`${baseUrl}/v1/query/exec`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ statement_id: stmtId, params }),
    });
    if (!ex.ok) throw new Error(`exec failed: ${await ex.text()}`);
    const body = await ex.json();
    return body.data ?? body;
  } finally {
    // fire-and-forget close
    fetch(`${baseUrl}/v1/query/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ statement_id: stmtId }),
    }).catch(() => undefined);
  }
}

// ─── Step 1: Framework tables ──────────────────────────────────────────────

const FRAMEWORK_TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
     id                TEXT PRIMARY KEY,
     email             TEXT NOT NULL,
     name              TEXT,
     password_hash     TEXT,
     email_verified    INT  NOT NULL DEFAULT 0,
     last_login_at     TIMESTAMP,
     created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS tenants (
     id              TEXT PRIMARY KEY,
     name            TEXT NOT NULL,
     slug            TEXT NOT NULL,
     api_key_prefix  TEXT,
     created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS memberships (
     id         TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     tenant_id  TEXT NOT NULL,
     role       TEXT NOT NULL DEFAULT 'member',
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
     id         TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     token_hash TEXT NOT NULL,
     kind       TEXT NOT NULL,
     expires_at TIMESTAMP NOT NULL,
     used_at    TIMESTAMP,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
];

// ─── Step 2: Studio domain tables ──────────────────────────────────────────

const STUDIO_TABLES = [
  `CREATE TABLE IF NOT EXISTS workflow_definitions (
     id           TEXT PRIMARY KEY,
     name         TEXT NOT NULL,
     description  TEXT,
     version      INT  NOT NULL DEFAULT 1,
     definition   TEXT NOT NULL,
     compiled_sql TEXT,
     status       TEXT NOT NULL DEFAULT 'draft',
     owner        TEXT,
     created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS workflow_versions (
     id          TEXT PRIMARY KEY,
     workflow_id TEXT NOT NULL,
     version     INT  NOT NULL,
     definition  TEXT NOT NULL,
     created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     created_by  TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
     id           TEXT PRIMARY KEY,
     workflow_id  TEXT NOT NULL,
     version      INT  NOT NULL,
     trigger_kind TEXT,
     trigger_data TEXT,
     status       TEXT NOT NULL,
     started_at   TIMESTAMP,
     ended_at     TIMESTAMP,
     error        TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS workflow_step_runs (
     id          TEXT PRIMARY KEY,
     run_id      TEXT NOT NULL,
     node_id     TEXT NOT NULL,
     node_type   TEXT NOT NULL,
     status      TEXT NOT NULL,
     input_json  TEXT,
     output_json TEXT,
     started_at  TIMESTAMP,
     ended_at    TIMESTAMP,
     error       TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS workflow_approval_queue (
     id           TEXT PRIMARY KEY,
     run_id       TEXT NOT NULL,
     node_id      TEXT NOT NULL,
     state        TEXT NOT NULL,
     requested_at TIMESTAMP,
     decided_at   TIMESTAMP,
     decided_by   TEXT,
     reason       TEXT
   )`,
];

const IMMUTABLE_TABLE = `CREATE IMMUTABLE TABLE IF NOT EXISTS workflow_deploys (
   id           TEXT PRIMARY KEY,
   workflow_id  TEXT NOT NULL,
   version      INT  NOT NULL,
   engine_url   TEXT NOT NULL,
   deployed_by  TEXT,
   deployed_at  TIMESTAMP,
   objects_json TEXT
 )`;

const FALLBACK_DEPLOYS = `CREATE TABLE IF NOT EXISTS workflow_deploys (
   id           TEXT PRIMARY KEY,
   workflow_id  TEXT NOT NULL,
   version      INT  NOT NULL,
   engine_url   TEXT NOT NULL,
   deployed_by  TEXT,
   deployed_at  TIMESTAMP,
   objects_json TEXT
 )`;

async function applyTables(tables, label) {
  let applied = 0;
  for (const sql of tables) {
    try {
      await exec(sql);
      applied++;
    } catch (err) {
      console.warn(`[${label}] warning:`, err.message);
    }
  }
  return applied;
}

async function main() {
  console.log('[workflow-studio-bootstrap] connecting to', baseUrl);

  // Step 1 — framework tables
  console.log('[workflow-studio-bootstrap] step 1: framework tables...');
  const fw = await applyTables(FRAMEWORK_TABLES, 'framework');
  console.log(`[workflow-studio-bootstrap] framework: ${fw}/${FRAMEWORK_TABLES.length} applied`);

  // Step 2 — studio tables
  console.log('[workflow-studio-bootstrap] step 2: studio domain tables...');
  const st = await applyTables(STUDIO_TABLES, 'studio');
  console.log(`[workflow-studio-bootstrap] studio: ${st}/${STUDIO_TABLES.length} applied`);

  // workflow_deploys (try IMMUTABLE, fallback to plain)
  try {
    await exec(IMMUTABLE_TABLE);
    console.log('[workflow-studio-bootstrap] workflow_deploys: IMMUTABLE TABLE created');
  } catch {
    try {
      await exec(FALLBACK_DEPLOYS);
      console.log('[workflow-studio-bootstrap] workflow_deploys: plain TABLE created (fallback)');
    } catch (err) {
      console.warn('[workflow-studio-bootstrap] workflow_deploys warning:', err.message);
    }
  }

  // Step 3 — default admin user (if users table is empty)
  console.log('[workflow-studio-bootstrap] step 3: default admin user...');
  try {
    const countResult = await exec('SELECT COUNT(*) FROM users');
    const rows = countResult?.rows ?? [];
    const count = rows[0]?.[0] ?? rows[0]?.['count(*)'] ?? rows[0]?.['COUNT(*)'] ?? 0;
    if (Number(count) === 0) {
      const email = process.env.STUDIO_ADMIN_EMAIL ?? 'admin@localhost';
      const password = process.env.STUDIO_ADMIN_PASSWORD ?? 'change-me-now';
      // Simple SHA-256 hash for the bootstrap password (production would use bcrypt,
      // but bcrypt isn't available as a plain ESM import without the binary).
      // The Auth.js credentials provider uses bcrypt — seed this with the bcrypt hash
      // of the password instead if you're using the full auth stack.
      const hash = createHash('sha256').update(password).digest('hex');
      const userId = randomUUID();
      await execParam(
        `INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, email, 'Admin', `sha256:${hash}`],
      );
      console.log(`[workflow-studio-bootstrap] created default admin: ${email}`);
      console.log('[workflow-studio-bootstrap] IMPORTANT: change this password before production use!');
    } else {
      console.log(`[workflow-studio-bootstrap] ${count} user(s) already exist — skipping seed`);
    }
  } catch (err) {
    console.warn('[workflow-studio-bootstrap] admin user seed warning:', err.message);
  }

  console.log('[workflow-studio-bootstrap] done.');
}

main().catch((err) => {
  console.error('[workflow-studio-bootstrap] unexpected error:', err);
  process.exit(1);
});

import 'server-only';
import { getAdminEngineClient } from './engine-client';

/**
 * Bootstrap all studio-side tables. Safe to call on every boot (IF NOT EXISTS).
 * Tables: workflow_definitions, workflow_versions, workflow_deploys (IMMUTABLE),
 *         workflow_runs, workflow_step_runs, workflow_approval_queue.
 *
 * The users/tenants/memberships/sessions tables are created by app-framework bootstrap.
 */
export async function bootstrapStudioTables(): Promise<void> {
  const db = getAdminEngineClient();
  const statements = [
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
       id           TEXT PRIMARY KEY,
       workflow_id  TEXT NOT NULL,
       version      INT  NOT NULL,
       definition   TEXT NOT NULL,
       created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       created_by   TEXT
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
       id           TEXT PRIMARY KEY,
       run_id       TEXT NOT NULL,
       node_id      TEXT NOT NULL,
       node_type    TEXT NOT NULL,
       status       TEXT NOT NULL,
       input_json   TEXT,
       output_json  TEXT,
       started_at   TIMESTAMP,
       ended_at     TIMESTAMP,
       error        TEXT
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
  for (const sql of statements) {
    try {
      await db.sql(sql);
    } catch (err) {
      console.warn('[workflow-studio] bootstrap warning:', err);
    }
  }
  // IMMUTABLE TABLE for deploy audit — separate because CREATE IMMUTABLE TABLE syntax
  try {
    await db.sql(
      `CREATE IMMUTABLE TABLE IF NOT EXISTS workflow_deploys (
         id           TEXT PRIMARY KEY,
         workflow_id  TEXT NOT NULL,
         version      INT  NOT NULL,
         engine_url   TEXT NOT NULL,
         deployed_by  TEXT,
         deployed_at  TIMESTAMP,
         objects_json TEXT
       )`,
    );
  } catch {
    // Graceful fallback if engine doesn't support IMMUTABLE TABLE yet
    await db.sql(
      `CREATE TABLE IF NOT EXISTS workflow_deploys (
         id           TEXT PRIMARY KEY,
         workflow_id  TEXT NOT NULL,
         version      INT  NOT NULL,
         engine_url   TEXT NOT NULL,
         deployed_by  TEXT,
         deployed_at  TIMESTAMP,
         objects_json TEXT
       )`,
    );
  }
}

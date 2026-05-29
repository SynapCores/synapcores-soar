/**
 * Playbook primitives.
 *
 * A playbook is a DAG of action calls + branches. Stored as JSON in
 * soar_playbooks.steps. The incident-responder agent (Phase 5) walks
 * the DAG when matched against an incident.
 *
 * Phase 10 ships:
 *   - PlaybookStep schema
 *   - simulate(playbook, fixtureAlert) — dry-run that emits the trace
 *     of action calls WITHOUT firing them
 *   - listPlaybooks / getPlaybook / savePlaybook / deletePlaybook
 *
 * The dry-run is the operator's "I trust this playbook" check.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getAdminClient } from '@synapcores/app-framework/db/server';
import { getActionDef } from './actions/registry';
import type { AlertRow } from './soar-alerts';

// ─── schema ──────────────────────────────────────────────────────────────

export const PlaybookStepSchema: z.ZodType<PlaybookStep> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('action'),
      name: z.string().min(1),
      action: z.string().min(1),
      args: z.record(z.unknown()),
      /** Continue executing the rest of the playbook after this step's
       *  HBR approval lands? Defaults to true. */
      continue_after_approval: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('branch'),
      name: z.string().min(1),
      /** Simple equality predicates against the alert. */
      when: z.record(z.unknown()),
      then: z.array(PlaybookStepSchema),
      else: z.array(PlaybookStepSchema).optional(),
    }),
    z.object({
      type: z.literal('note'),
      name: z.string().min(1),
      text: z.string(),
    }),
  ]),
);

export type PlaybookStep =
  | {
      type: 'action';
      name: string;
      action: string;
      args: Record<string, unknown>;
      continue_after_approval?: boolean;
    }
  | {
      type: 'branch';
      name: string;
      when: Record<string, unknown>;
      then: PlaybookStep[];
      else?: PlaybookStep[];
    }
  | {
      type: 'note';
      name: string;
      text: string;
    };

export const PlaybookSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  match_when: z.record(z.unknown()).optional(),
  steps: z.array(PlaybookStepSchema).min(1),
  enabled: z.boolean().optional(),
});

export type PlaybookDef = z.infer<typeof PlaybookSchema>;

// ─── DB primitives ───────────────────────────────────────────────────────

export interface PlaybookRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  match_when: Record<string, unknown> | null;
  steps: PlaybookStep[];
  enabled: boolean;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function listPlaybooks(tenantId: string): Promise<PlaybookRow[]> {
  const db = getAdminClient();
  const result = await db.sql<
    Omit<PlaybookRow, 'match_when' | 'steps'> & {
      match_when: string | null;
      steps: string;
    }
  >(
    `SELECT id, tenant_id, name, description, match_when, steps,
            enabled, version, created_by, created_at, updated_at
       FROM soar_playbooks
      WHERE tenant_id = $1
      ORDER BY updated_at DESC`,
    [tenantId],
  );
  return result.rows.map(parsePlaybookRow);
}

export async function getPlaybook(
  tenantId: string,
  id: string,
): Promise<PlaybookRow | null> {
  const db = getAdminClient();
  const result = await db.sql<
    Omit<PlaybookRow, 'match_when' | 'steps'> & {
      match_when: string | null;
      steps: string;
    }
  >(
    `SELECT id, tenant_id, name, description, match_when, steps,
            enabled, version, created_by, created_at, updated_at
       FROM soar_playbooks
      WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id],
  );
  const row = result.rows[0];
  return row ? parsePlaybookRow(row) : null;
}

export interface SavePlaybookInput {
  tenantId: string;
  createdBy: string;
  def: PlaybookDef;
  /** If set, updates the existing playbook (and bumps the version). */
  id?: string;
}

export async function savePlaybook(input: SavePlaybookInput): Promise<PlaybookRow> {
  const db = getAdminClient();
  if (input.id) {
    await db.sql(
      `UPDATE soar_playbooks
          SET name = $3, description = $4, match_when = $5, steps = $6,
              enabled = $7, version = version + 1, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [
        input.tenantId,
        input.id,
        input.def.name,
        input.def.description ?? null,
        JSON.stringify(input.def.match_when ?? null),
        JSON.stringify(input.def.steps),
        input.def.enabled ?? true,
      ],
    );
    const updated = await getPlaybook(input.tenantId, input.id);
    if (!updated) throw new Error('Playbook vanished after update.');
    return updated;
  }
  const id = randomUUID();
  await db.sql(
    `INSERT INTO soar_playbooks
       (id, tenant_id, name, description, match_when, steps,
        enabled, version, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NOW(), NOW())`,
    [
      id,
      input.tenantId,
      input.def.name,
      input.def.description ?? null,
      JSON.stringify(input.def.match_when ?? null),
      JSON.stringify(input.def.steps),
      input.def.enabled ?? true,
      input.createdBy,
    ],
  );
  const created = await getPlaybook(input.tenantId, id);
  if (!created) throw new Error('Playbook vanished after insert.');
  return created;
}

export async function deletePlaybook(
  tenantId: string,
  id: string,
): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `DELETE FROM soar_playbooks WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
}

// ─── simulation ──────────────────────────────────────────────────────────

export interface SimulationStep {
  name: string;
  type: PlaybookStep['type'];
  decision: 'would_fire' | 'would_pause_for_approval' | 'would_skip' | 'note';
  action?: string;
  args?: Record<string, unknown>;
  reason: string;
}

export interface SimulationResult {
  matches: boolean;
  match_reason: string;
  steps: SimulationStep[];
}

/**
 * Walk the playbook against a fixture alert and emit what would
 * happen. Honors HBR gating: actions marked HBR show as "would pause
 * for approval", not "would fire".
 */
export function simulatePlaybook(
  playbook: PlaybookDef,
  alert: Pick<AlertRow, 'severity' | 'source' | 'title' | 'status'>,
): SimulationResult {
  const matches = matchPlaybookConditions(playbook.match_when ?? {}, alert);
  const out: SimulationStep[] = [];
  if (matches.ok) {
    walkSteps(playbook.steps, alert, out);
  }
  return {
    matches: matches.ok,
    match_reason: matches.reason,
    steps: out,
  };
}

function walkSteps(
  steps: PlaybookStep[],
  alert: Pick<AlertRow, 'severity' | 'source' | 'title' | 'status'>,
  out: SimulationStep[],
): void {
  for (const step of steps) {
    if (step.type === 'note') {
      out.push({
        name: step.name,
        type: 'note',
        decision: 'note',
        reason: step.text,
      });
      continue;
    }
    if (step.type === 'branch') {
      const r = matchPlaybookConditions(step.when, alert);
      out.push({
        name: step.name,
        type: 'branch',
        decision: r.ok ? 'would_fire' : 'would_skip',
        reason: r.reason,
      });
      walkSteps(r.ok ? step.then : step.else ?? [], alert, out);
      continue;
    }
    // action
    const def = getActionDef(step.action);
    if (!def) {
      out.push({
        name: step.name,
        type: 'action',
        action: step.action,
        args: step.args,
        decision: 'would_skip',
        reason: `Unknown action '${step.action}' — no registry entry.`,
      });
      continue;
    }
    out.push({
      name: step.name,
      type: 'action',
      action: step.action,
      args: step.args,
      decision: def.hbr ? 'would_pause_for_approval' : 'would_fire',
      reason: def.hbr
        ? `HBR action — would route to /approvals before firing.`
        : `Non-HBR — would fire immediately via the configured adapter.`,
    });
  }
}

function matchPlaybookConditions(
  when: Record<string, unknown>,
  alert: Pick<AlertRow, 'severity' | 'source' | 'title' | 'status'>,
): { ok: boolean; reason: string } {
  const failures: string[] = [];
  for (const [key, expected] of Object.entries(when)) {
    const actual = (alert as unknown as Record<string, unknown>)[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) {
        failures.push(`${key}=${String(actual)} ∉ ${JSON.stringify(expected)}`);
      }
    } else if (actual !== expected) {
      failures.push(
        `${key}=${String(actual)} ≠ ${JSON.stringify(expected)}`,
      );
    }
  }
  if (failures.length > 0) {
    return { ok: false, reason: failures.join('; ') };
  }
  if (Object.keys(when).length === 0) {
    return { ok: true, reason: 'No match_when — matches every alert.' };
  }
  return { ok: true, reason: 'All conditions matched.' };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function parsePlaybookRow(row: {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  match_when: string | null;
  steps: string;
  enabled: boolean;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}): PlaybookRow {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    description: row.description,
    match_when: safeJson(row.match_when),
    steps: (safeJson<PlaybookStep[]>(row.steps) ?? []) as PlaybookStep[],
    enabled: row.enabled,
    version: row.version,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeJson<T = Record<string, unknown>>(s: string | null): T | null {
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Immutable evidence chain — every action against the corpus lands an
 * append-only row in `evidence_chain`. The engine rejects UPDATE
 * statements on this table, which is what makes the "FAA-acceptable
 * chain of custody" claim load-bearing.
 */

import 'server-only';
import { createHash, randomUUID } from 'node:crypto';

import { db } from './db';
import type { EvidenceChainEntry } from './types';

export interface WriteEvidenceInput {
  actor: string;
  action: string;
  target_id: string;
  details: Record<string, unknown>;
}

export async function writeEvidence(input: WriteEvidenceInput): Promise<string> {
  const id = `EVT-${randomUUID().slice(0, 12)}`;
  await db().sql(
    `INSERT INTO evidence_chain (id, ts, actor, action, target_id, details)
     VALUES ($1, NOW(), $2, $3, $4, $5)`,
    [
      id,
      input.actor,
      input.action,
      input.target_id,
      JSON.stringify(input.details),
    ],
  );
  return id;
}

export async function listEvidence(targetId?: string): Promise<EvidenceChainEntry[]> {
  const sql = targetId
    ? `SELECT id, ts, actor, action, target_id, details FROM evidence_chain
        WHERE target_id = $1 ORDER BY ts ASC LIMIT 500`
    : `SELECT id, ts, actor, action, target_id, details FROM evidence_chain
        ORDER BY ts DESC LIMIT 500`;
  const params = targetId ? [targetId] : [];
  const result = await db().sql<EvidenceChainEntry>(sql, params);
  return result.rows;
}

/**
 * Compute a presentation-side hash chain on top of the IMMUTABLE rows
 * — the engine already enforces tamper-evidence at the storage layer
 * (UPDATE/DELETE rejected). The deterministic SHA-256 chain on top of
 * the row text gives investigators a visual "previous hash → current
 * hash" thread suitable for export as evidence packaging.
 */
export interface HashedEvidence extends EvidenceChainEntry {
  prev_hash: string;
  hash: string;
}

export function hashChain(rows: EvidenceChainEntry[]): HashedEvidence[] {
  let prev = '0'.repeat(64);
  return rows.map((r) => {
    const payload = `${r.id}|${r.ts}|${r.actor}|${r.action}|${r.target_id}|${r.details}|${prev}`;
    const h = createHash('sha256').update(payload).digest('hex');
    const hashed = { ...r, prev_hash: prev, hash: h };
    prev = h;
    return hashed;
  });
}

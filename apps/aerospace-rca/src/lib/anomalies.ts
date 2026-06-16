/**
 * Anomaly read/write paths — list, detail, similar (vector recall),
 * ingest. Embedding is computed inline via EMBED() at INSERT time so
 * the seeder doesn't have to ship pre-computed vectors.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { db } from './db';
import { writeEvidence } from './audit';
import type { Anomaly, SimilarAnomaly } from './types';

const ANOMALY_COLS =
  'id, ts, program, subsystem, unit_id, severity, status, title, description, reporter, test_stand, source_doc';

export async function listAnomalies(opts: {
  program?: string;
  severity?: string;
  limit?: number;
} = {}): Promise<Anomaly[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.program && opts.program !== 'all') {
    params.push(opts.program);
    clauses.push(`program = $${params.length}`);
  }
  if (opts.severity && opts.severity !== 'all') {
    params.push(opts.severity);
    clauses.push(`severity = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `SELECT ${ANOMALY_COLS} FROM anomalies ${where} ORDER BY ts DESC LIMIT ${limit}`;
  const result = await db().sql<Anomaly>(sql, params);
  return result.rows;
}

export async function getAnomaly(id: string): Promise<Anomaly | null> {
  const result = await db().sql<Anomaly>(
    `SELECT ${ANOMALY_COLS} FROM anomalies WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findSimilarAnomalies(
  id: string,
  k = 5,
): Promise<SimilarAnomaly[]> {
  const result = await db().sql<SimilarAnomaly>(
    `SELECT a.id, a.ts, a.program, a.subsystem, a.unit_id, a.severity, a.status,
            a.title, a.description, a.reporter, a.test_stand, a.source_doc,
            COSINE_SIMILARITY(a.embedding, (SELECT embedding FROM anomalies WHERE id = $1)) AS similarity
       FROM anomalies a
      WHERE a.id <> $2
      ORDER BY similarity DESC
      LIMIT ${Math.min(Math.max(k, 1), 20)}`,
    [id, id],
  );
  return result.rows.map((r) => ({
    ...r,
    similarity: Number(r.similarity),
  }));
}

export interface CountsByProgram {
  open: number;
  investigating: number;
  closed: number;
  total: number;
  by_program: Record<string, number>;
}

export async function counts(): Promise<CountsByProgram> {
  const c = db();
  const total = Number(
    (await c.sqlScalar<number>(`SELECT COUNT(*) FROM anomalies`)) ?? 0,
  );
  const open = Number(
    (await c.sqlScalar<number>(
      `SELECT COUNT(*) FROM anomalies WHERE status = 'open'`,
    )) ?? 0,
  );
  const investigating = Number(
    (await c.sqlScalar<number>(
      `SELECT COUNT(*) FROM anomalies WHERE status = 'investigating'`,
    )) ?? 0,
  );
  const closed = Number(
    (await c.sqlScalar<number>(
      `SELECT COUNT(*) FROM anomalies WHERE status = 'closed'`,
    )) ?? 0,
  );
  const byProgram = await c.sql<{ program: string; n: number }>(
    `SELECT program, COUNT(*) AS n FROM anomalies GROUP BY program`,
  );
  const by_program: Record<string, number> = {};
  for (const r of byProgram.rows) {
    by_program[r.program] = Number(r.n);
  }
  return { open, investigating, closed, total, by_program };
}

export interface IngestAnomalyInput {
  id?: string;
  ts: string;
  program: string;
  subsystem: string;
  unit_id: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  reporter: string;
  test_stand?: string | null;
  source_doc?: string | null;
}

export async function ingestAnomaly(input: IngestAnomalyInput): Promise<string> {
  const id = input.id ?? `ANM-${randomUUID().slice(0, 8).toUpperCase()}`;
  await db().sql(
    `INSERT INTO anomalies (id, ts, program, subsystem, unit_id, severity, status,
                            title, description, reporter, test_stand, source_doc, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, EMBED($13))`,
    [
      id,
      input.ts,
      input.program,
      input.subsystem,
      input.unit_id,
      input.severity,
      input.status,
      input.title,
      input.description,
      input.reporter,
      input.test_stand ?? null,
      input.source_doc ?? null,
      input.description,
    ],
  );
  await writeEvidence({
    actor: 'system:ingest',
    action: 'anomaly.ingested',
    target_id: id,
    details: {
      program: input.program,
      unit_id: input.unit_id,
      severity: input.severity,
      reporter: input.reporter,
    },
  });
  return id;
}

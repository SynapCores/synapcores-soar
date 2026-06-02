/**
 * Similar incident retrieval — Requirement 4 of the SOAR Demo
 * Completion doc.
 *
 * Combines:
 *   - vector similarity over incident embeddings
 *   - graph relationship overlap (shared entities / services / users)
 *   - matching event-type sequence
 *
 * Returns a ranked list of past incidents with their resolutions —
 * the input the RCA agent uses to suggest recommended actions
 * derived from prior closures.
 */
import { getClientForSession } from '@synapcores/app-framework/db/server';
import type { Session } from '@synapcores/app-framework';

export interface SimilarIncident {
  incident_id: string;
  similarity_score: number;
  matching_factors: string[];
  previous_resolution: string;
  closed_at: string;
}

export interface SimilarIncidentsResult {
  similar_incidents: SimilarIncident[];
}

/**
 * Query the closed-incident memory for the top-K most similar past
 * incidents to the given current incident. Vector + graph overlap combined.
 */
export async function findSimilarIncidents(
  session: Session,
  currentIncidentId: string,
  k = 5,
): Promise<SimilarIncidentsResult> {
  if (!session.tenant) {
    return { similar_incidents: [] };
  }
  const db = await getClientForSession(session);

  // Load the current incident's embedding + entity fingerprint.
  const cur = await db.sql<{
    embedding: number[] | null;
    affected_entities: string;
    event_type_sequence: string;
  }>(
    `SELECT embedding, affected_entities, event_type_sequence
       FROM soar_incidents
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [currentIncidentId, session.tenant.id],
  );
  if (!cur.rows[0] || !cur.rows[0].embedding) {
    return { similar_incidents: [] };
  }
  const currentEmbedding = cur.rows[0].embedding;
  const currentEntities = safeJsonArray(cur.rows[0].affected_entities);
  const currentSeq = safeJsonArray(cur.rows[0].event_type_sequence);

  // Vector similarity over CLOSED incidents (the memory store).
  // We use the inline AUTOML-style approach for compatibility with the
  // engine's COSINE_SIMILARITY operator. The columns are in a single
  // table so the lookup is a simple ranked scan (no JOIN — engine bug
  // #207 makes JOINs on TEXT primary keys unreliable, see ENGINEER_ANSWERS).
  const vec = await db.sql<{
    id: string;
    similarity: number;
    affected_entities: string;
    event_type_sequence: string;
    final_root_cause: string;
    final_resolution: string;
    closed_at: string;
  }>(
    `SELECT id,
            COSINE_SIMILARITY(embedding, $1) AS similarity,
            affected_entities,
            event_type_sequence,
            final_root_cause,
            final_resolution,
            closed_at
       FROM soar_incidents
      WHERE tenant_id = $2
        AND status = 'closed'
        AND id <> $3
        AND embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT $4`,
    [currentEmbedding, session.tenant.id, currentIncidentId, k * 3],
  );

  // Re-rank by combining vector similarity with graph-overlap +
  // event-sequence-overlap. Each factor is in [0, 1]; final score
  // is a weighted blend (vec 0.6 / entity 0.25 / sequence 0.15).
  const ranked = vec.rows
    .map((row) => {
      const pastEntities = safeJsonArray(row.affected_entities);
      const pastSeq = safeJsonArray(row.event_type_sequence);
      const entityOverlap = jaccard(currentEntities, pastEntities);
      const seqOverlap = jaccard(currentSeq, pastSeq);
      const final =
        0.6 * (row.similarity ?? 0) + 0.25 * entityOverlap + 0.15 * seqOverlap;
      const factors: string[] = [];
      if ((row.similarity ?? 0) > 0.7) {
        factors.push(`high semantic similarity (${row.similarity.toFixed(2)})`);
      }
      if (entityOverlap > 0.3) {
        factors.push(`shared entities (${Math.round(entityOverlap * 100)}%)`);
      }
      if (seqOverlap > 0.3) {
        factors.push(`matching event sequence (${Math.round(seqOverlap * 100)}%)`);
      }
      return {
        incident_id: row.id,
        similarity_score: +final.toFixed(3),
        matching_factors: factors,
        previous_resolution: row.final_resolution,
        closed_at: row.closed_at,
      };
    })
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, k);

  return { similar_incidents: ranked };
}

// ─── helpers ─────────────────────────────────────────────────────────

function safeJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  setA.forEach((v) => {
    if (setB.has(v)) intersection++;
  });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

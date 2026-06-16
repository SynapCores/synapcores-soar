/**
 * Graph helpers — the supplier-batch fingerprint that Act 3 surfaces.
 *
 * Storage: SynapCores' native graph engine (POST /v1/graph/nodes +
 * /v1/graph/edges). MATCH queries go through the SQL endpoint —
 * v1.8.1-ce accepts Cypher-style MATCH alongside SQL on /v1/query/execute.
 *
 * Node labels: Anomaly, Part, Supplier, Program, CorrectiveAction, RFA.
 * Edge types: OCCURRED_ON, SUPPLIED_BY, USED_IN, RESOLVED_BY, APPLIED_TO,
 *             FLAGGED_BY, ALSO_FLAGGED.
 */

import 'server-only';

interface GraphNodeRecord {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

interface GraphEdgeRecord {
  id: string;
  src: string;
  dst: string;
  type: string;
  properties: Record<string, unknown>;
}

const BASE_URL = () => process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:8081';
const TOKEN = () => {
  const k = process.env.SYNAPCORES_ADMIN_API_KEY;
  if (!k) throw new Error('[graph] SYNAPCORES_ADMIN_API_KEY not set');
  return k;
};

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[graph] ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function createNode(
  labels: string[],
  properties: Record<string, unknown>,
): Promise<GraphNodeRecord> {
  return call<GraphNodeRecord>('/v1/graph/nodes', { labels, properties });
}

export async function createEdge(
  src: string,
  dst: string,
  type: string,
  properties: Record<string, unknown> = {},
): Promise<GraphEdgeRecord> {
  return call<GraphEdgeRecord>('/v1/graph/edges', {
    src,
    dst,
    type,
    properties,
  });
}

/** Drop every node + edge. Used at seed-bootstrap to rebuild cleanly. */
export async function clearAll(): Promise<void> {
  const res = await fetch(`${BASE_URL()}/v1/query/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN()}`,
    },
    body: JSON.stringify({ sql: 'MATCH (n) DETACH DELETE n' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[graph] clear → ${res.status}: ${text.slice(0, 200)}`);
  }
}

export interface GraphCloudNode {
  id: string;
  label: string;
  kind: 'anomaly' | 'part' | 'supplier' | 'program' | 'corrective' | 'rfa';
  props?: Record<string, unknown>;
}

export interface GraphCloudEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphCloud {
  nodes: GraphCloudNode[];
  edges: GraphCloudEdge[];
  summary: string;
}

/**
 * For an anomaly: find the part it occurred on, the supplier of that
 * part, the other programs the part ships to, the corrective action
 * that closed prior related anomalies, and which programs the
 * corrective action was propagated to. Returns a cloud the force
 * graph component can render directly.
 *
 * The Cypher-style MATCH below leans on the v1.8.1 engine's pattern
 * support. For batching we issue multiple MATCH calls and stitch on
 * the TS side — keeps each query under the engine's optimizer happy
 * path.
 */
export async function fingerprintForAnomaly(
  anomalyId: string,
): Promise<GraphCloud> {
  const sql = async (q: string) => {
    const res = await fetch(`${BASE_URL()}/v1/query/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN()}`,
      },
      body: JSON.stringify({ sql: q }),
    });
    if (!res.ok) return { rows: [] };
    const body = (await res.json()) as {
      data?: { rows?: unknown[][] };
    };
    return { rows: body.data?.rows ?? [] };
  };

  const escId = anomalyId.replace(/"/g, '');

  const partRow = await sql(
    `MATCH (a:Anomaly)-[:OCCURRED_ON]->(p:Part)-[:SUPPLIED_BY]->(s:Supplier)
       WHERE a.id = "${escId}" RETURN p, s`,
  );

  const partNode = partRow.rows[0]?.[0] as
    | { id: string; properties: { id: string; name: string; programs: string } }
    | undefined;
  const supplierNode = partRow.rows[0]?.[1] as
    | { id: string; properties: { id: string; name: string } }
    | undefined;

  if (!partNode || !supplierNode) {
    return {
      nodes: [],
      edges: [],
      summary: 'No graph fingerprint computed — anomaly or part missing.',
    };
  }

  const partKey = partNode.properties.id;
  const supplierKey = supplierNode.properties.id;

  // All anomalies on this part (across programs)
  const sib = await sql(
    `MATCH (sib:Anomaly)-[:OCCURRED_ON]->(p:Part)
       WHERE p.id = "${partKey}" RETURN sib`,
  );

  // All parts this supplier provides (cross-program reuse)
  const siblings = await sql(
    `MATCH (sp:Part)-[:SUPPLIED_BY]->(s:Supplier)
       WHERE s.id = "${supplierKey}" RETURN sp`,
  );

  // Corrective actions touching these anomalies
  const cas = await sql(
    `MATCH (ca:CorrectiveAction)-[:RESOLVED_BY]->(a:Anomaly)-[:OCCURRED_ON]->(p:Part)
       WHERE p.id = "${partKey}" RETURN ca`,
  );

  const nodes = new Map<string, GraphCloudNode>();
  const edges: GraphCloudEdge[] = [];
  const add = (n: GraphCloudNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };

  add({
    id: anomalyId,
    label: anomalyId,
    kind: 'anomaly',
    props: { highlight: true },
  });
  add({
    id: partKey,
    label: partNode.properties.name,
    kind: 'part',
    props: { programs: partNode.properties.programs },
  });
  add({ id: supplierKey, label: supplierNode.properties.name, kind: 'supplier' });
  edges.push({ source: anomalyId, target: partKey, type: 'OCCURRED_ON' });
  edges.push({ source: partKey, target: supplierKey, type: 'SUPPLIED_BY' });

  // Add affected programs for the part
  const programs = String(partNode.properties.programs ?? '').split(',');
  for (const p of programs) {
    const k = `PRG-${p}`;
    add({ id: k, label: p, kind: 'program' });
    edges.push({ source: partKey, target: k, type: 'USED_IN' });
  }

  // Sibling anomalies on same part
  for (const r of sib.rows) {
    const n = r[0] as { properties: { id: string; program: string } };
    if (n.properties.id === anomalyId) continue;
    add({
      id: n.properties.id,
      label: n.properties.id,
      kind: 'anomaly',
      props: { program: n.properties.program },
    });
    edges.push({
      source: n.properties.id,
      target: partKey,
      type: 'OCCURRED_ON',
    });
  }

  // Sibling parts from same supplier (cross-program reuse)
  for (const r of siblings.rows) {
    const n = r[0] as {
      properties: { id: string; name: string; programs: string };
    };
    if (n.properties.id === partKey) continue;
    add({
      id: n.properties.id,
      label: n.properties.name,
      kind: 'part',
      props: { programs: n.properties.programs },
    });
    edges.push({
      source: n.properties.id,
      target: supplierKey,
      type: 'SUPPLIED_BY',
    });
  }

  for (const r of cas.rows) {
    const n = r[0] as {
      properties: { id: string; title: string; applied_to_programs?: string };
    };
    add({
      id: n.properties.id,
      label: n.properties.id,
      kind: 'corrective',
      props: { title: n.properties.title, applied_to: n.properties.applied_to_programs },
    });
    edges.push({ source: n.properties.id, target: anomalyId, type: 'RESOLVES' });
  }

  return {
    nodes: [...nodes.values()],
    edges,
    summary: `Supplier ${supplierNode.properties.name} supplies ${partNode.properties.name} into programs: ${partNode.properties.programs}.`,
  };
}

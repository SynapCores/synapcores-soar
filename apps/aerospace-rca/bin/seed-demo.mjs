#!/usr/bin/env node
/**
 * pnpm --filter @synapcores/aerospace-rca seed-demo [--bulk|--realtime]
 *
 * --bulk    (default) loads the entire corpus immediately. Used before
 *           the cinematic demo.
 * --realtime drips anomalies in over wall-clock time, sorted by ts,
 *           accelerated 10000x — useful for "watching the system live"
 *           recording angles.
 *
 * Always: applies suppliers, parts, corrective_actions, RFAs, and
 * departed_employees first; then anomalies; then builds the native
 * graph of nodes + edges; then seeds the initial evidence_chain rows.
 *
 * Reset semantics: blows away rows in topological order before
 * re-seeding. Idempotent.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(HERE, '..', 'src', 'lib', 'seed');

const BASE = (process.env.SYNAPCORES_URL ?? 'http://127.0.0.1:8081').replace(/\/+$/, '');
const KEY = process.env.SYNAPCORES_ADMIN_API_KEY;
const MODE = process.argv.includes('--realtime') ? 'realtime' : 'bulk';
const TODAY_ANOMALY_ID = 'ANM-2026-BE4-027';

if (!KEY) {
  console.error('[seed] SYNAPCORES_ADMIN_API_KEY not set.');
  process.exit(2);
}

async function sql(statement, params = []) {
  const path = params.length === 0 ? '/v1/query/execute' : null;
  if (path) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ sql: statement }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`SQL failed (${res.status}): ${t.slice(0, 400)}\nstmt: ${statement.slice(0, 200)}`);
    }
    return (await res.json()).data;
  }
  // Prepared path
  const prep = await fetch(`${BASE}/v1/query/prepare`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ sql: statement }),
  });
  if (!prep.ok) {
    const t = await prep.text();
    throw new Error(`prepare failed (${prep.status}): ${t.slice(0, 400)}`);
  }
  const { data: prepData } = await prep.json();
  try {
    const exec = await fetch(`${BASE}/v1/query/exec`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ statement_id: prepData.statement_id, params }),
    });
    if (!exec.ok) {
      const t = await exec.text();
      throw new Error(`exec failed (${exec.status}): ${t.slice(0, 400)}`);
    }
    return (await exec.json()).data;
  } finally {
    void fetch(`${BASE}/v1/query/close`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ statement_id: prepData.statement_id }),
    }).catch(() => undefined);
  }
}

async function createNode(labels, properties) {
  const res = await fetch(`${BASE}/v1/graph/nodes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ labels, properties }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`createNode failed: ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function createEdge(src, dst, type, properties = {}) {
  const res = await fetch(`${BASE}/v1/graph/edges`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ src, dst, type, properties }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`createEdge failed: ${t.slice(0, 300)}`);
  }
  return res.json();
}

async function readJson(name) {
  return JSON.parse(await readFile(join(SEED_DIR, name), 'utf-8'));
}

async function resetTables() {
  // Topological order: anomalies/CAs/RFAs depend on suppliers+parts; agent_runs
  // depend on anomalies; evidence_chain is append-only — we DROP+CREATE the
  // immutable table to reset (DELETE rejected, UPDATE rejected).
  console.log('[seed] clearing existing rows');
  await sql('DELETE FROM agent_runs');
  await sql('DELETE FROM corrective_actions');
  await sql('DELETE FROM rfas');
  await sql('DELETE FROM anomalies');
  await sql('DELETE FROM parts');
  await sql('DELETE FROM suppliers');
  await sql('DELETE FROM departed_employees');
  // U6 — DCU telemetry tables. Aggregates can be 50K+ rows from a prior
  // demo run; truncate them so /dcu starts clean.
  await sql('DELETE FROM telemetry_alerts').catch(() => {});
  await sql('DELETE FROM telemetry_aggregates').catch(() => {});
  await sql('DELETE FROM telemetry_sensors').catch(() => {});
  // evidence_chain is immutable — drop + recreate to reset
  await sql('DROP TABLE IF EXISTS evidence_chain');
  await sql(
    `CREATE IMMUTABLE TABLE IF NOT EXISTS evidence_chain (
       id TEXT PRIMARY KEY,
       ts TIMESTAMP NOT NULL,
       actor TEXT NOT NULL,
       action TEXT NOT NULL,
       target_id TEXT NOT NULL,
       details TEXT NOT NULL
     )`,
  );
  // Clear graph
  await sql('MATCH (n) DETACH DELETE n');
}

async function seedSuppliers(rows) {
  for (const s of rows) {
    await sql(
      `INSERT INTO suppliers (id, name, tier, city, state) VALUES ($1, $2, $3, $4, $5)`,
      [s.id, s.name, s.tier, s.city, s.state],
    );
  }
  console.log(`  suppliers: ${rows.length}`);
}

async function seedParts(rows) {
  for (const p of rows) {
    await sql(
      `INSERT INTO parts (id, part_number, name, subsystem, supplier_id, programs)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [p.id, p.part_number, p.name, p.subsystem, p.supplier_id, p.programs],
    );
  }
  console.log(`  parts: ${rows.length}`);
}

async function seedCAs(rows) {
  for (const ca of rows) {
    await sql(
      `INSERT INTO corrective_actions
         (id, anomaly_id, ts, title, description, owner, status, applied_to_programs, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, EMBED($9))`,
      [
        ca.id,
        ca.anomaly_id,
        ca.ts,
        ca.title,
        ca.description,
        ca.owner,
        ca.status,
        ca.applied_to_programs,
        ca.description,
      ],
    );
  }
  console.log(`  corrective_actions: ${rows.length}`);
}

async function seedRFAs(rows) {
  for (const r of rows) {
    await sql(
      `INSERT INTO rfas
         (id, opened_ts, program, subsystem, title, description, owner, status, days_open, related_anomaly_id, related_part_id, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, EMBED($12))`,
      [
        r.id,
        r.opened_ts,
        r.program,
        r.subsystem,
        r.title,
        r.description,
        r.owner,
        r.status,
        r.days_open,
        r.related_anomaly_id,
        r.related_part_id,
        r.description,
      ],
    );
  }
  console.log(`  rfas: ${rows.length}`);
}

async function seedDeparted(rows) {
  for (const d of rows) {
    await sql(
      `INSERT INTO departed_employees (email, name, role, departed) VALUES ($1, $2, $3, $4)`,
      [d.email, d.name, d.role, d.departed],
    );
  }
  console.log(`  departed_employees: ${rows.length}`);
}

async function seedAnomalies(rows, options) {
  const includeToday = options?.includeToday ?? true;
  const filtered = rows.filter(
    (a) => includeToday || a.id !== TODAY_ANOMALY_ID,
  );
  if (MODE === 'realtime') {
    filtered.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const t0 = new Date(filtered[0]?.ts ?? Date.now()).getTime();
    const tN = new Date(filtered[filtered.length - 1]?.ts ?? Date.now()).getTime();
    const span = Math.max(tN - t0, 1);
    const compress = 10000;
    for (const a of filtered) {
      const delay = ((new Date(a.ts).getTime() - t0) / span) * (span / compress);
      await new Promise((r) => setTimeout(r, Math.min(delay, 250)));
      await insertAnomaly(a);
      process.stdout.write('.');
    }
    process.stdout.write('\n');
  } else {
    for (const a of filtered) {
      await insertAnomaly(a);
    }
  }
  console.log(`  anomalies: ${filtered.length}`);
}

async function insertAnomaly(a) {
  await sql(
    `INSERT INTO anomalies
        (id, ts, program, subsystem, unit_id, severity, status, title, description, reporter, test_stand, source_doc, embedding)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, EMBED($13))`,
    [
      a.id,
      a.ts,
      a.program,
      a.subsystem,
      a.unit_id,
      a.severity,
      a.status,
      a.title,
      a.description,
      a.reporter,
      a.test_stand,
      a.source_doc,
      a.description,
    ],
  );
}

async function seedGraph(anomalies, parts, suppliers, cas, rfas) {
  // Map domain ids → engine node UUIDs so edges can address them.
  const nodeIds = new Map();

  for (const s of suppliers) {
    const n = await createNode(['Supplier'], { id: s.id, name: s.name, tier: s.tier });
    nodeIds.set(`SUP:${s.id}`, n.id);
  }
  for (const p of parts) {
    const n = await createNode(['Part'], {
      id: p.id,
      name: p.name,
      part_number: p.part_number,
      programs: p.programs,
      subsystem: p.subsystem,
    });
    nodeIds.set(`PART:${p.id}`, n.id);
    // Part → Supplier
    await createEdge(n.id, nodeIds.get(`SUP:${p.supplier_id}`), 'SUPPLIED_BY');
    // Part → Program (lightweight Program nodes)
    for (const prog of p.programs.split(',')) {
      const progKey = `PROG:${prog}`;
      if (!nodeIds.has(progKey)) {
        const pn = await createNode(['Program'], { id: prog, name: prog });
        nodeIds.set(progKey, pn.id);
      }
      await createEdge(n.id, nodeIds.get(progKey), 'USED_IN');
    }
  }
  for (const a of anomalies) {
    const n = await createNode(['Anomaly'], {
      id: a.id,
      title: a.title,
      program: a.program,
      severity: a.severity,
      ts: a.ts,
    });
    nodeIds.set(`ANM:${a.id}`, n.id);
    if (a.part_id && nodeIds.has(`PART:${a.part_id}`)) {
      await createEdge(n.id, nodeIds.get(`PART:${a.part_id}`), 'OCCURRED_ON');
    }
  }
  for (const ca of cas) {
    const n = await createNode(['CorrectiveAction'], {
      id: ca.id,
      title: ca.title,
      owner: ca.owner,
      status: ca.status,
      applied_to_programs: ca.applied_to_programs,
    });
    nodeIds.set(`CA:${ca.id}`, n.id);
    if (nodeIds.has(`ANM:${ca.anomaly_id}`)) {
      await createEdge(n.id, nodeIds.get(`ANM:${ca.anomaly_id}`), 'RESOLVED_BY');
    }
    for (const prog of (ca.applied_to_programs ?? '').split(',').filter(Boolean)) {
      const progKey = `PROG:${prog}`;
      if (nodeIds.has(progKey)) {
        await createEdge(n.id, nodeIds.get(progKey), 'APPLIED_TO');
      }
    }
  }
  for (const r of rfas) {
    const n = await createNode(['RFA'], {
      id: r.id,
      title: r.title,
      program: r.program,
      status: r.status,
      days_open: r.days_open,
    });
    nodeIds.set(`RFA:${r.id}`, n.id);
    if (r.related_anomaly_id && nodeIds.has(`ANM:${r.related_anomaly_id}`)) {
      await createEdge(n.id, nodeIds.get(`ANM:${r.related_anomaly_id}`), 'FLAGGED_BY');
    }
    if (r.related_part_id && nodeIds.has(`PART:${r.related_part_id}`)) {
      await createEdge(n.id, nodeIds.get(`PART:${r.related_part_id}`), 'TOUCHES');
    }
  }
  console.log(`  graph nodes: ${nodeIds.size}`);
}

async function seedEvidence(anomalies) {
  // Per-anomaly initial evidence row so the chain has substance pre-demo.
  for (const a of anomalies) {
    await sql(
      `INSERT INTO evidence_chain (id, ts, actor, action, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        `EVT-INIT-${a.id}`,
        a.ts,
        'system:ingest',
        'anomaly.ingested',
        a.id,
        JSON.stringify({
          program: a.program,
          unit_id: a.unit_id,
          severity: a.severity,
          source_doc: a.source_doc,
        }),
      ],
    );
  }
  console.log(`  evidence_chain entries: ${anomalies.length}`);
}

async function seedSensors(rows) {
  // 3000 rows — batched VALUES INSERT in chunks of 200 so we don't
  // pummel the engine with 3000 separate prepared statements.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice
      .map((s) => {
        const q = (v) =>
          typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v;
        return `(${q(s.id)},${s.channel},${q(s.name)},${q(s.kind)},${q(s.unit)},${q(s.subsystem)},${q(s.unit_id)},${s.nominal_min},${s.nominal_max})`;
      })
      .join(',');
    await sql(
      `INSERT INTO telemetry_sensors (id, channel, name, kind, unit, subsystem, unit_id, nominal_min, nominal_max) VALUES ${values}`,
    );
  }
  console.log(`  telemetry_sensors: ${rows.length}`);
}

async function main() {
  console.log(`[seed] mode=${MODE} engine=${BASE}`);
  const suppliers = await readJson('suppliers.json');
  const parts = await readJson('parts.json');
  const cas = await readJson('corrective_actions.json');
  const rfas = await readJson('rfas.json');
  const anomalies = await readJson('anomalies.json');
  const departed = await readJson('departed_employees.json');
  let sensors = [];
  try {
    sensors = await readJson('sensors.json');
  } catch {
    console.warn(
      '[seed] sensors.json not found — run `node bin/generate-sensors.mjs` first if you want /dcu (U6) to work.',
    );
  }

  await resetTables();
  await seedSuppliers(suppliers);
  await seedParts(parts);
  // Hold the "today" anomaly back so the demo playback ingests it live.
  const includeTodayInBulk = !process.argv.includes('--hold-today');
  await seedAnomalies(anomalies, { includeToday: includeTodayInBulk });
  await seedCAs(cas);
  await seedRFAs(rfas);
  await seedDeparted(departed);
  if (sensors.length) {
    await seedSensors(sensors);
  }
  await seedGraph(
    anomalies.filter((a) => includeTodayInBulk || a.id !== TODAY_ANOMALY_ID),
    parts,
    suppliers,
    cas,
    rfas,
  );
  const evidenceSet = includeTodayInBulk
    ? anomalies
    : anomalies.filter((a) => a.id !== TODAY_ANOMALY_ID);
  await seedEvidence(evidenceSet);

  console.log(
    `[seed] OK — ${anomalies.length} anomalies, ${parts.length} parts, ${suppliers.length} suppliers, ${cas.length} corrective actions, ${rfas.length} RFAs, ${sensors.length} telemetry sensors.`,
  );
}

main().catch((e) => {
  console.error('[seed] crashed:', e);
  process.exit(1);
});

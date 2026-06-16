#!/usr/bin/env node
/**
 * Deterministically generate the 3000-sensor registry for U6.
 *
 *   node bin/generate-sensors.mjs > src/lib/seed/sensors.json
 *
 * Distribution (per the U6 build brief):
 *   - Programs:    BE-4: 1200, BE-3: 400, NG: 800, NS: 300, HLS: 300
 *   - Subsystems:  turbopump 600, combustion-chamber 400, nozzle 250,
 *                  pre-burner 300, igniter 200, avionics 350,
 *                  valves-actuators 400, tankage 300, gimbal 200  (= 3000)
 *
 * We allocate sensors deterministically by interleaving program ×
 * subsystem buckets. Within each bucket, the kind mix is biased by
 * subsystem (turbopump = mostly vibration, chambers = mostly pressure,
 * avionics = mostly voltage, valves = mostly flow, etc).
 *
 * The "important" sensors that the simulator plants anomalies on are
 * given canonical IDs so the bridge + UI agree:
 *   - BE4-027-TP-VIB-X-014   (Act 2 — vibration spike)
 *   - NG-2-PB-PRES-002       (Act 3 — pressure drift)
 *   - BE3-031-TP-TEMP-007    (Act 4 — false-positive temp excursion)
 *   - BE4-027-CC-VIB-Y-022   (Act 5 — second sensor on same unit)
 *
 * These four IDs are emitted up front; the remaining 2996 are filled in
 * with a stable per-bucket index. Total count is exactly 3000.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'seed', 'sensors.json');

const PROGRAM_QUOTAS = {
  'BE-4': 1200,
  'BE-3': 400,
  NG: 800,
  NS: 300,
  HLS: 300,
};

const SUBSYSTEM_QUOTAS = {
  turbopump: 600,
  'combustion-chamber': 400,
  nozzle: 250,
  'pre-burner': 300,
  igniter: 200,
  avionics: 350,
  'valves-actuators': 400,
  tankage: 300,
  gimbal: 200,
};

const SUBSYSTEM_SHORT = {
  turbopump: 'TP',
  'combustion-chamber': 'CC',
  nozzle: 'NOZ',
  'pre-burner': 'PB',
  igniter: 'IGN',
  avionics: 'AVI',
  'valves-actuators': 'VAL',
  tankage: 'TNK',
  gimbal: 'GMB',
};

// Per-subsystem kind mix (weights sum to 1)
const KIND_MIX = {
  turbopump: { vibration: 0.55, temperature: 0.25, pressure: 0.15, flow: 0.05 },
  'combustion-chamber': { pressure: 0.45, temperature: 0.4, vibration: 0.1, flow: 0.05 },
  nozzle: { temperature: 0.5, vibration: 0.3, pressure: 0.2 },
  'pre-burner': { pressure: 0.45, temperature: 0.35, vibration: 0.15, flow: 0.05 },
  igniter: { voltage: 0.45, temperature: 0.35, pressure: 0.2 },
  avionics: { voltage: 0.75, temperature: 0.2, vibration: 0.05 },
  'valves-actuators': { flow: 0.45, pressure: 0.3, voltage: 0.15, vibration: 0.1 },
  tankage: { pressure: 0.45, temperature: 0.4, flow: 0.15 },
  gimbal: { vibration: 0.4, voltage: 0.35, pressure: 0.25 },
};

const UNIT_FOR_PROGRAM = {
  'BE-4': (n) => `BE4-${String(n).padStart(3, '0')}`,
  'BE-3': (n) => `BE3-${String(n).padStart(3, '0')}`,
  NG: (n) => `NG-${n}`,
  NS: (n) => `NS-${String(n).padStart(2, '0')}`,
  HLS: (n) => `HLS-${String(n).padStart(2, '0')}`,
};

const UNIT_CYCLE = {
  'BE-4': [27, 28, 29, 30, 31, 32, 33, 34, 35, 36],
  'BE-3': [29, 30, 31, 32, 33, 34],
  NG: [1, 2, 3, 4, 5],
  NS: [29, 30, 31, 32],
  HLS: [1, 2, 3, 4],
};

const NOMINALS = {
  vibration: { unit: 'g', min: -1.5, max: 1.5, base: 0, noise: 0.2 },
  pressure: { unit: 'kPa', min: 0, max: 25000, base: 12000, noise: 80 },
  temperature: { unit: 'K', min: 80, max: 3600, base: 1200, noise: 6 },
  voltage: { unit: 'V', min: 24, max: 32, base: 28, noise: 0.05 },
  flow: { unit: 'kg/s', min: 0, max: 250, base: 60, noise: 1.2 },
};

// Deterministic PRNG (mulberry32) so the generated registry is stable.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0xc0ffee42);

function pickKindFor(subsystem) {
  const mix = KIND_MIX[subsystem];
  let r = rng();
  let acc = 0;
  for (const [kind, w] of Object.entries(mix)) {
    acc += w;
    if (r < acc) return kind;
  }
  return Object.keys(mix)[0];
}

// We allocate by building a deterministic plan: each subsystem fills
// across programs proportional to PROGRAM_QUOTAS. We compute a 2D
// matrix of program × subsystem counts that sums correctly.
function buildPlan() {
  const totalSubsystem = Object.values(SUBSYSTEM_QUOTAS).reduce((a, b) => a + b, 0);
  const matrix = {}; // program -> subsystem -> count
  for (const p of Object.keys(PROGRAM_QUOTAS)) matrix[p] = {};
  const subsystems = Object.keys(SUBSYSTEM_QUOTAS);
  for (const p of Object.keys(PROGRAM_QUOTAS)) {
    const ratio = PROGRAM_QUOTAS[p] / 3000;
    let allocated = 0;
    for (const s of subsystems) {
      const want = Math.floor(SUBSYSTEM_QUOTAS[s] * ratio);
      matrix[p][s] = want;
      allocated += want;
    }
    // Top up the rounding deficit on the biggest subsystem
    const deficit = PROGRAM_QUOTAS[p] - allocated;
    if (deficit > 0) {
      matrix[p].turbopump += deficit;
    }
  }
  // Now reconcile: each subsystem's column must sum to SUBSYSTEM_QUOTAS[s].
  // We'll iteratively shift counts to fix discrepancies.
  for (const s of subsystems) {
    let col = 0;
    for (const p of Object.keys(PROGRAM_QUOTAS)) col += matrix[p][s];
    const delta = SUBSYSTEM_QUOTAS[s] - col;
    if (delta !== 0) {
      // Shift onto BE-4 — has the biggest budget.
      matrix['BE-4'][s] += delta;
    }
  }
  return matrix;
}

function unitForProgram(program, idx) {
  const cycle = UNIT_CYCLE[program];
  const n = cycle[idx % cycle.length];
  return UNIT_FOR_PROGRAM[program](n);
}

function shortKind(kind) {
  return (
    {
      vibration: 'VIB',
      pressure: 'PRES',
      temperature: 'TEMP',
      voltage: 'VOLT',
      flow: 'FLOW',
    }[kind] ?? 'GEN'
  );
}

// The 4 anomaly-target sensor IDs the simulator and the bridge agree on.
// These are added FIRST so they always exist regardless of the rest of
// the allocation.
const PINNED = [
  {
    id: 'BE4-027-TP-VIB-X-014',
    program: 'BE-4',
    subsystem: 'turbopump',
    kind: 'vibration',
    unit_id: 'BE4-027',
  },
  {
    id: 'NG-2-PB-PRES-002',
    program: 'NG',
    subsystem: 'pre-burner',
    kind: 'pressure',
    unit_id: 'NG-2',
  },
  {
    id: 'BE3-031-TP-TEMP-007',
    program: 'BE-3',
    subsystem: 'turbopump',
    kind: 'temperature',
    unit_id: 'BE3-031',
  },
  {
    id: 'BE4-027-CC-VIB-Y-022',
    program: 'BE-4',
    subsystem: 'combustion-chamber',
    kind: 'vibration',
    unit_id: 'BE4-027',
  },
];

function main() {
  const plan = buildPlan();
  const sensors = [];
  let channel = 1;

  // Emit pinned first.
  for (const p of PINNED) {
    const nominal = NOMINALS[p.kind];
    sensors.push({
      id: p.id,
      channel: channel++,
      name: p.id,
      kind: p.kind,
      unit: nominal.unit,
      subsystem: p.subsystem,
      unit_id: p.unit_id,
      nominal_min: nominal.min,
      nominal_max: nominal.max,
    });
  }
  const pinnedIds = new Set(PINNED.map((p) => p.id));
  // Reduce plan counts for pinned subsystem slots
  for (const p of PINNED) {
    if (plan[p.program][p.subsystem] > 0) plan[p.program][p.subsystem]--;
  }

  // Emit programmatic.
  for (const program of Object.keys(PROGRAM_QUOTAS)) {
    let unitCycleIdx = 0;
    for (const subsystem of Object.keys(SUBSYSTEM_QUOTAS)) {
      let count = plan[program][subsystem];
      let perKindIdx = {};
      while (count-- > 0) {
        const unit_id = unitForProgram(program, unitCycleIdx++);
        const kind = pickKindFor(subsystem);
        perKindIdx[kind] = (perKindIdx[kind] ?? 0) + 1;
        const short = SUBSYSTEM_SHORT[subsystem];
        const ks = shortKind(kind);
        const seq = String(perKindIdx[kind]).padStart(3, '0');
        const id = `${unit_id}-${short}-${ks}-${seq}`;
        if (pinnedIds.has(id)) continue; // shouldn't happen but defensive
        const nominal = NOMINALS[kind];
        sensors.push({
          id,
          channel: channel++,
          name: id,
          kind,
          unit: nominal.unit,
          subsystem,
          unit_id,
          nominal_min: nominal.min,
          nominal_max: nominal.max,
        });
      }
    }
  }

  if (sensors.length !== 3000) {
    console.error(`[generate-sensors] expected 3000, got ${sensors.length}. Check plan reconciliation.`);
    process.exit(1);
  }
  return sensors;
}

const sensors = main();
const payload = JSON.stringify(sensors, null, 0);
await writeFile(OUT, payload);
console.error(`[generate-sensors] wrote ${sensors.length} rows to ${OUT}`);

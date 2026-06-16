import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import type { SensorRegistryRow } from '@/lib/dcu-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sensor registry — what the Web Worker simulator pulls at startup so
 * it knows which 3K channels to generate. The bridge also reads this
 * table directly via SQL, but we expose an HTTP path for the browser
 * side (cheaper than minting AIDB JWTs for the client).
 *
 * Paginates: v1.8.1-ce's SQL_MAX_ROW_COUNT caps any single SELECT at
 * 1000 rows, and the registry is 3000.
 */
export async function GET() {
  const PAGE = 1000;
  const sensors: SensorRegistryRow[] = [];
  let offset = 0;
  for (;;) {
    const result = await db().sql<SensorRegistryRow>(
      `SELECT id, channel, name, kind, unit, subsystem, unit_id, nominal_min, nominal_max
         FROM telemetry_sensors
         ORDER BY channel ASC
         LIMIT ${PAGE} OFFSET ${offset}`,
    );
    if (result.rows.length === 0) break;
    sensors.push(...result.rows);
    if (result.rows.length < PAGE) break;
    offset += PAGE;
  }
  return NextResponse.json({ sensors });
}

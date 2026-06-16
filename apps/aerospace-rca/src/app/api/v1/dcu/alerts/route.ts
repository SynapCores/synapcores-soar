import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Most recent telemetry_alerts. Used by /dcu to backfill a feed across
 * a page refresh during the demo (the bridge in-memory state resets,
 * but the alerts are durable in AIDB).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 200);
  const result = await db().sql<{
    id: string;
    sensor_id: string;
    ts: string;
    detector: string;
    score: number;
    value: number;
    baseline_mean: number;
    baseline_stddev: number;
    status: string;
    anomaly_id: string | null;
    notes: string | null;
  }>(
    `SELECT id, sensor_id, ts, detector, score, value, baseline_mean, baseline_stddev, status, anomaly_id, notes
       FROM telemetry_alerts
       ORDER BY ts DESC
       LIMIT ${limit}`,
  );
  return NextResponse.json({ alerts: result.rows });
}

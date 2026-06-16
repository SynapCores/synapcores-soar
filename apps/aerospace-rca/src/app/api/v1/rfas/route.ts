import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const onlyOpen = url.searchParams.get('open') === '1';
  const olderThan = Number(url.searchParams.get('days_open_gt') ?? 0);
  const filter: string[] = [];
  if (onlyOpen) filter.push("status IN ('open','in-review')");
  if (olderThan > 0) filter.push(`days_open > ${olderThan}`);
  const where = filter.length ? `WHERE ${filter.join(' AND ')}` : '';
  const result = await db().sql(
    `SELECT id, opened_ts, program, subsystem, title, description, owner, status,
            days_open, related_anomaly_id, related_part_id
       FROM rfas ${where}
      ORDER BY days_open DESC LIMIT 200`,
  );
  return NextResponse.json({ rows: result.rows });
}

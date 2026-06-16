import { NextResponse } from 'next/server';

import { findSimilarAnomalies, getAnomaly } from '@/lib/anomalies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const k = Number(url.searchParams.get('k') ?? 5);
  const target = await getAnomaly(id);
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const similar = await findSimilarAnomalies(id, k);
  return NextResponse.json({ target, similar });
}

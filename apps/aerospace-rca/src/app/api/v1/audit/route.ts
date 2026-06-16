import { NextResponse } from 'next/server';

import { hashChain, listEvidence } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get('target') ?? undefined;
  const rows = await listEvidence(target ?? undefined);
  return NextResponse.json({ rows: hashChain(rows) });
}

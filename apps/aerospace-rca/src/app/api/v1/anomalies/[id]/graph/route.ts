import { NextResponse } from 'next/server';

import { fingerprintForAnomaly } from '@/lib/graph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cloud = await fingerprintForAnomaly(id);
  return NextResponse.json(cloud);
}

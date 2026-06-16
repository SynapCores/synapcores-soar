import { NextResponse } from 'next/server';

import { runReliabilityEngineer, runSafetyOfficer } from '@/lib/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { persona?: string };
  const persona = body.persona ?? 'reliability_engineer';
  try {
    if (persona === 'safety_officer') {
      const f = await runSafetyOfficer(id);
      return NextResponse.json(f);
    }
    const f = await runReliabilityEngineer(id);
    return NextResponse.json(f);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'agent failed' },
      { status: 500 },
    );
  }
}

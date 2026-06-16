import { NextResponse } from 'next/server';

import { ingestAnomaly, listAnomalies } from '@/lib/anomalies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const program = url.searchParams.get('program') ?? undefined;
  const severity = url.searchParams.get('severity') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? 200);
  const rows = await listAnomalies({ program, severity, limit });
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const required = [
    'ts',
    'program',
    'subsystem',
    'unit_id',
    'severity',
    'status',
    'title',
    'description',
    'reporter',
  ];
  for (const k of required) {
    if (!body[k]) {
      return NextResponse.json(
        { error: `missing field: ${k}` },
        { status: 400 },
      );
    }
  }
  const id = await ingestAnomaly({
    id: body.id as string | undefined,
    ts: body.ts as string,
    program: body.program as string,
    subsystem: body.subsystem as string,
    unit_id: body.unit_id as string,
    severity: body.severity as string,
    status: body.status as string,
    title: body.title as string,
    description: body.description as string,
    reporter: body.reporter as string,
    test_stand: (body.test_stand as string | null) ?? null,
    source_doc: (body.source_doc as string | null) ?? null,
  });
  return NextResponse.json({ id });
}

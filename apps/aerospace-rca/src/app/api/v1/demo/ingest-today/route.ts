import { NextResponse } from 'next/server';

import { ingestAnomaly } from '@/lib/anomalies';
import { TODAY_ANOMALY_ID } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-side ingestion of the cinematic Act-1 anomaly. Idempotent — if
 * the id already exists, the engine rejects the INSERT and we return ok.
 */
export async function POST() {
  try {
    const id = await ingestAnomaly({
      id: TODAY_ANOMALY_ID,
      ts: '2026-06-12T06:14:00Z',
      program: 'BE-4',
      subsystem: 'turbopump',
      unit_id: 'BE4-027',
      severity: 'major',
      status: 'open',
      title: 'BE-4 unit 027 LOX bearing race carbon deposit, vibration excursion',
      description:
        'Carbon deposits exceed spec on LOX-side turbopump bearing race during 14-second hot-fire test on 2026-06-12T06:14:00Z. Vibration signature shifted by 3.2 sigma at T+0.7s on the high-pressure oxidizer shaft. Bearing race showed micro-pitting consistent with debris from upstream contamination, morphology near-identical to the BE4-019 and BE4-022 incidents. Bearing race batch under traceability pull — Acme Bearings AB-7821 family. Stand 4 instrumentation nominal; LOX prevalve and feedline witness samples taken.',
      reporter: 'K. Suresh',
      test_stand: 'Hot-fire Stand 4',
      source_doc: 'PFR-2026-BE4-027.pdf',
    });
    return NextResponse.json({ id, status: 'ingested' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Treat duplicate-key as success — the demo can re-run Act 1 without exploding.
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('duplicate')) {
      return NextResponse.json({ id: TODAY_ANOMALY_ID, status: 'already_present' });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

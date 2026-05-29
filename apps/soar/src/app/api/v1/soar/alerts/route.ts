/**
 * POST /api/v1/soar/alerts — SIEM/EDR webhook ingest.
 *
 * Auth: Bearer sk_user_... (a personal/programmatic API key minted
 * from /settings/api-keys; production deploys mint a service-account
 * key per SIEM connector).
 *
 * Request:
 *   {
 *     "source": "splunk",
 *     "source_alert_id": "ALR-9001",
 *     "severity": "high",
 *     "title": "Suspicious PowerShell on finance-vm-04",
 *     "description": "Encoded command, parent winword.exe",
 *     "raw_payload": { ... arbitrary upstream JSON ... }
 *   }
 *
 * Response:
 *   {
 *     "alert_id": "uuid",
 *     "status": "new" | "duplicate",
 *     "dup_of": null | "uuid",
 *     "cosine_to_nearest": null | 0.0–1.0
 *   }
 */

import 'server-only';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { resolveBearerKey } from '@/lib/api-auth';
import { ingestAlert } from '@/lib/soar-alerts';

const bodySchema = z.object({
  source: z.string().min(1),
  source_alert_id: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string().min(1),
  description: z.string().optional(),
  raw_payload: z.unknown().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const resolved = await resolveBearerKey(req);
  if (!resolved) {
    return Response.json(
      { error: 'Unauthorized: provide a valid Bearer API key.' },
      { status: 401 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = await req.json();
    parsed = bodySchema.parse(raw);
  } catch (err) {
    return Response.json(
      {
        error: 'Invalid request body.',
        details: err instanceof z.ZodError ? err.flatten() : String(err),
      },
      { status: 400 },
    );
  }

  try {
    const result = await ingestAlert({
      tenantId: resolved.tenantId,
      source: parsed.source,
      sourceAlertId: parsed.source_alert_id,
      severity: parsed.severity,
      title: parsed.title,
      description: parsed.description,
      rawPayload: parsed.raw_payload,
    });
    return Response.json(
      {
        alert_id: result.alertId,
        status: result.status,
        dup_of: result.dupOf,
        cosine_to_nearest: result.cosineToNearest,
      },
      { status: 201 },
    );
  } catch (err) {
    return Response.json(
      { error: 'Ingest failed.', details: String(err) },
      { status: 500 },
    );
  }
}

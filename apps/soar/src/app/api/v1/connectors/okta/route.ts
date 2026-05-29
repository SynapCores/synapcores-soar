import { handleConnectorMultiWebhook } from '@/lib/connectors/handler';
import {
  parseOktaAuth,
  mapOktaPayloadToAlerts,
  isOktaVerificationRequest,
  buildOktaVerificationResponse,
  type OktaEventHookPayload,
} from '@/lib/connectors/okta';

/**
 * Okta endpoint verification: GET with X-Okta-Verification-Challenge.
 */
export async function GET(req: Request): Promise<Response> {
  const challenge = req.headers.get('x-okta-verification-challenge');
  if (challenge) return buildOktaVerificationResponse(challenge);
  return Response.json({ ok: true });
}

export async function POST(req: Request): Promise<Response> {
  // First check if this is the one-time verification handshake. We
  // need to read the body once; clone it before passing to the multi-
  // handler.
  const raw = await req.clone().text();
  try {
    const parsed = JSON.parse(raw) as OktaEventHookPayload;
    if (isOktaVerificationRequest(parsed)) {
      return Response.json({ verification: parsed.verification });
    }
  } catch {
    // fall through — handler will surface a 400.
  }

  return handleConnectorMultiWebhook(req, {
    provider: 'okta',
    extractAuth: parseOktaAuth,
    mapMany: mapOktaPayloadToAlerts,
  });
}

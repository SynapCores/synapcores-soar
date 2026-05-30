import { handleConnectorWebhook } from '@/lib/connectors/handler';
import { parseFedNowAuth, mapFedNowPayload } from '@/lib/connectors/fednow';

export async function POST(req: Request): Promise<Response> {
  return handleConnectorWebhook(req, {
    provider: 'fednow',
    extractAuth: parseFedNowAuth,
    map: mapFedNowPayload,
  });
}

import { handleConnectorWebhook } from '@/lib/connectors/handler';
import { parseAchAuth, mapAchPayload } from '@/lib/connectors/ach';

export async function POST(req: Request): Promise<Response> {
  return handleConnectorWebhook(req, {
    provider: 'ach',
    extractAuth: parseAchAuth,
    map: mapAchPayload,
  });
}

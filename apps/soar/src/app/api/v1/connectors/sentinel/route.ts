import { handleConnectorWebhook } from '@/lib/connectors/handler';
import { parseSentinelAuth, mapSentinelPayload } from '@/lib/connectors/sentinel';

export async function POST(req: Request): Promise<Response> {
  return handleConnectorWebhook(req, {
    provider: 'sentinel',
    extractAuth: parseSentinelAuth,
    map: mapSentinelPayload,
  });
}

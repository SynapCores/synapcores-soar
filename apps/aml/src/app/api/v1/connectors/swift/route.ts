import { handleConnectorWebhook } from '@/lib/connectors/handler';
import { parseSwiftAuth, mapSwiftPayload } from '@/lib/connectors/swift';

export async function POST(req: Request): Promise<Response> {
  return handleConnectorWebhook(req, {
    provider: 'swift',
    extractAuth: parseSwiftAuth,
    map: mapSwiftPayload,
  });
}

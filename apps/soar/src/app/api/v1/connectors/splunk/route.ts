import { handleConnectorWebhook } from '@/lib/connectors/handler';
import { parseSplunkAuth, mapSplunkPayload } from '@/lib/connectors/splunk-hec';

export async function POST(req: Request): Promise<Response> {
  return handleConnectorWebhook(req, {
    provider: 'splunk',
    extractAuth: parseSplunkAuth,
    map: mapSplunkPayload,
  });
}

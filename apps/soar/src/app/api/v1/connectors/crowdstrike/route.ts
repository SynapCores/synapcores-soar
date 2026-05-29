import { handleConnectorWebhook } from '@/lib/connectors/handler';
import {
  parseCrowdStrikeAuth,
  mapCrowdStrikePayload,
} from '@/lib/connectors/crowdstrike';

export async function POST(req: Request): Promise<Response> {
  return handleConnectorWebhook(req, {
    provider: 'crowdstrike',
    extractAuth: parseCrowdStrikeAuth,
    map: mapCrowdStrikePayload,
  });
}

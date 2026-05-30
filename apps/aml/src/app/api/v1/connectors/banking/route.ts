import { handleConnectorWebhook } from '@/lib/connectors/handler';
import { parseBankingAuth, mapBankingPayload } from '@/lib/connectors/banking';

export async function POST(req: Request): Promise<Response> {
  return handleConnectorWebhook(req, {
    provider: 'banking',
    extractAuth: parseBankingAuth,
    map: mapBankingPayload,
  });
}

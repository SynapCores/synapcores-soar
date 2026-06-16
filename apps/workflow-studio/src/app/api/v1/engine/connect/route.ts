import { NextResponse } from 'next/server';
import { z } from 'zod';
import { saveEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';
import { randomUUID } from 'node:crypto';

const schema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  apiKey: z.string().min(1),
});

export async function POST(req: Request) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { label, url, apiKey } = body.data;
  const client = getTargetEngineClient({ url, apiKey });
  const health = await client.health();
  if (!health.ok)
    return NextResponse.json({ error: 'Cannot connect to engine at ' + url }, { status: 422 });
  // Version check
  const versionResult = await client.sqlScalar<string>('SELECT version()');
  const id = randomUUID();
  await saveEngine({ id, label, url, apiKey, createdAt: new Date().toISOString() });
  return NextResponse.json({
    id,
    label,
    url,
    version: health.version ?? versionResult,
    connected: true,
  });
}

import { NextResponse } from 'next/server';
import { getDefaultEngine, getEngine } from '@/lib/secrets';
import { getTargetEngineClient } from '@/lib/engine-client';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const engineId = url.searchParams.get('engineId') ?? 'default';
  const engine = (await getEngine(engineId)) ?? (await getDefaultEngine());
  if (!engine) {
    return NextResponse.json({ ok: false, error: 'No engine configured' }, { status: 503 });
  }
  const client = getTargetEngineClient(engine);
  const health = await client.health();
  return NextResponse.json({
    ok: health.ok,
    version: health.version,
    engineId: engine.id,
    url: engine.url,
  });
}

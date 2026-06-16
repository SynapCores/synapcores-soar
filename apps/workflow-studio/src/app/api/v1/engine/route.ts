import { NextResponse } from 'next/server';
import { listEngines, deleteEngine } from '@/lib/secrets';

export async function GET() {
  const engines = await listEngines();
  return NextResponse.json(
    engines.map(({ id, label, url, createdAt }) => ({ id, label, url, createdAt })),
  );
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await deleteEngine(id);
  return NextResponse.json({ deleted: true });
}

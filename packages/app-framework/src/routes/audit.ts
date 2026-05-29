/**
 * Shared audit-log route handler. Apps wire it as:
 *
 *   // app/api/audit/route.ts
 *   export { GET } from '@synapcores/app-framework/routes/audit';
 *
 * Returns the paginated framework + app audit-log rows for the
 * current tenant, gated on the `audit:read` permission.
 */

import 'server-only';
import { auth } from './auth';
import { getClientForSession } from '../db/server';
import { requirePermission, FRAMEWORK_PERMISSIONS, PermissionError } from '../rbac';
import type { Session } from '../auth/types';

export async function GET(request: Request): Promise<Response> {
  const raw = await auth();
  const session = (raw as unknown as { framework: Session | null })?.framework ?? null;
  try {
    requirePermission(session, FRAMEWORK_PERMISSIONS.AUDIT_READ);
  } catch (err) {
    if (err instanceof PermissionError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.code === 'unauthenticated' ? 401 : 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw err;
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1),
    500,
  );
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  const db = getClientForSession(session);
  const result = await db.sql(
    `SELECT event_id, ts, actor_id, actor_type, action, target_id, payload
       FROM framework_audit_log
      WHERE tenant_id = $1
      ORDER BY event_id DESC
      LIMIT $2 OFFSET $3`,
    [session.tenant?.id, limit, offset],
  );

  return Response.json({
    rows: result.rows,
    total: result.rowCount,
    limit,
    offset,
  });
}

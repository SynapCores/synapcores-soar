/**
 * Invitation lifecycle: invite an email + role to a tenant, accept the
 * invitation, list pending invites. The invite token IS the row id —
 * we don't need a separate auth_tokens entry for them.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { getAdminClient } from '../db/server';
import {
  findUserByEmail,
  ValidationError,
} from './users';
import { addMembership, writeAuditEvent } from './tenants';
import { sendTenantInvite } from './mailer';
import type { Role } from '../rbac/types';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteUserInput {
  tenantId: string;
  tenantName: string;
  email: string;
  role: Role;
  invitedByUserId: string;
  invitedByName: string;
  appName: string;
  appBaseUrl: string;
}

export async function inviteUser(input: InviteUserInput): Promise<{ token: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new ValidationError('A valid email is required.');
  }
  const db = getAdminClient();
  // Prevent duplicate-pending invites
  const existing = await db.sql(
    `SELECT id FROM invitations
      WHERE tenant_id = $1 AND email = $2 AND accepted_at IS NULL
      LIMIT 1`,
    [input.tenantId, email],
  );
  if (existing.rows.length > 0) {
    throw new ValidationError(
      `There's already a pending invitation for ${email}.`,
    );
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.sql(
    `INSERT INTO invitations
       (id, tenant_id, email, role, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      token,
      input.tenantId,
      email,
      input.role,
      input.invitedByUserId,
      expiresAt.toISOString(),
    ],
  );
  await sendTenantInvite({
    to: email,
    inviterName: input.invitedByName,
    workspaceName: input.tenantName,
    url: `${input.appBaseUrl}/accept-invite/${encodeURIComponent(token)}`,
    appName: input.appName,
  });
  await writeAuditEvent({
    tenantId: input.tenantId,
    actorId: input.invitedByUserId,
    actorType: 'user',
    action: 'tenant.invite',
    targetId: token,
    payload: { email, role: input.role },
  });
  return { token };
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  invited_by: string;
  created_at: string;
  expires_at: string;
}

export async function listPendingInvites(
  tenantId: string,
): Promise<PendingInvite[]> {
  const db = getAdminClient();
  const result = await db.sql<PendingInvite>(
    `SELECT id, email, role, invited_by, created_at, expires_at
       FROM invitations
      WHERE tenant_id = $1 AND accepted_at IS NULL
      ORDER BY created_at DESC`,
    [tenantId],
  );
  return result.rows;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const db = getAdminClient();
  await db.sql(`DELETE FROM invitations WHERE id = $1`, [invitationId]);
}

/**
 * Accept an invitation. The user must already be authenticated (so we
 * have a userId to add the membership to). Returns the tenantId so
 * the caller can redirect.
 */
export async function acceptInvitation(
  invitationToken: string,
  userId: string,
): Promise<{ tenantId: string; role: Role }> {
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    tenant_id: string;
    email: string;
    role: string;
    expires_at: string;
    accepted_at: string | null;
  }>(
    `SELECT id, tenant_id, email, role, expires_at, accepted_at
       FROM invitations WHERE id = $1 LIMIT 1`,
    [invitationToken],
  );
  const row = result.rows[0];
  if (!row) throw new ValidationError('Invitation not found.');
  if (row.accepted_at) throw new ValidationError('Already accepted.');
  if (new Date(row.expires_at) < new Date()) {
    throw new ValidationError('This invitation has expired.');
  }

  // Verify the invitee's email matches the user
  const userResult = await db.sql<{ email: string }>(
    `SELECT email FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const userEmail = userResult.rows[0]?.email;
  if (!userEmail || userEmail.toLowerCase() !== row.email.toLowerCase()) {
    throw new ValidationError(
      `This invitation was for ${row.email}; sign in with that address.`,
    );
  }

  await addMembership(userId, row.tenant_id, row.role as Role);
  await db.sql(
    `UPDATE invitations SET accepted_at = NOW() WHERE id = $1`,
    [invitationToken],
  );
  return { tenantId: row.tenant_id, role: row.role as Role };
}

/** Used by the team-management UI before signup — surfaces the invite preview. */
export async function previewInvitation(token: string): Promise<{
  email: string;
  role: Role;
  tenantName: string;
} | null> {
  const db = getAdminClient();
  const inv = await db.sql<{
    tenant_id: string;
    email: string;
    role: string;
    accepted_at: string | null;
    expires_at: string;
  }>(
    `SELECT tenant_id, email, role, accepted_at, expires_at
       FROM invitations WHERE id = $1 LIMIT 1`,
    [token],
  );
  const row = inv.rows[0];
  if (!row) return null;
  if (row.accepted_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  const tenant = await db.sql<{ name: string }>(
    `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
    [row.tenant_id],
  );
  const tname = tenant.rows[0]?.name;
  if (!tname) return null;

  return {
    email: row.email,
    role: row.role as Role,
    tenantName: tname,
  };
}

/**
 * Helper for finding the userId for an invitee's email (used by the
 * accept-invite flow before sign-in).
 */
export async function userExistsForEmail(email: string): Promise<boolean> {
  return (await findUserByEmail(email)) !== null;
}

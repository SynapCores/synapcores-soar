/**
 * Server-side auth — the framework's Auth.js v5 configuration.
 *
 * Apps wire this into their /app/api/auth/[...nextauth]/route.ts and
 * import { auth, signIn, signOut } from this module from server code.
 *
 * Strategy: JWT-mode sessions (no DB session store) — Auth.js holds
 * the encrypted JWT in a cookie. We keep a `sessions` table in
 * SynapCores ONLY for the "log out everywhere" + "list my devices"
 * + audit-log surfaces. The JWT itself carries the userId; we
 * resolve tenant + role per-request from the DB.
 */

import 'server-only';

import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { getAdminClient } from '../db/server';
import { DEFAULT_ROLE_GRANTS, type Role } from '../rbac/types';
import { redeemAuthToken } from './users';
import type {
  Session as FrameworkSession,
  TenantInfo,
  UserInfo,
} from './types';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/**
 * The Auth.js NextAuthConfig the framework exports. Apps may extend
 * it (`createAuth(extraConfig)`) to add their own providers — e.g.
 * Google OAuth for the Enterprise tier — without forking the
 * framework.
 */
export function createAuth(
  extraConfig: Partial<NextAuthConfig> = {},
): ReturnType<typeof NextAuth> {
  const config: NextAuthConfig = {
    session: { strategy: 'jwt' },
    pages: {
      signIn: '/login',
      error: '/login',
      verifyRequest: '/login/verify',
    },
    providers: [
      Credentials({
        id: 'credentials',
        name: 'Email + password',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const user = await verifyPassword(
            parsed.data.email,
            parsed.data.password,
          );
          return user ? { id: user.id, email: user.email, name: user.name } : null;
        },
      }),
      // Magic-link provider — caller invokes `signIn('magic-link', { token })`
      // after the user clicks the email link. The /login/verify page is the
      // catch site for those clicks.
      Credentials({
        id: 'magic-link',
        name: 'Magic link',
        credentials: {
          token: { label: 'Token', type: 'text' },
        },
        async authorize(raw) {
          const token = typeof raw?.token === 'string' ? raw.token : '';
          if (!token) return null;
          try {
            const userId = await redeemAuthToken(token, 'magic-link');
            const user = await loadUser(userId);
            return user ? { id: user.id, email: user.email, name: user.name } : null;
          } catch {
            return null;
          }
        },
      }),
      // Extra providers (Resend SMTP, GitHub, Google) get merged in
      // by callers below.
      ...(extraConfig.providers ?? []),
    ],
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.userId = user.id;
        }
        return token;
      },
      async session({ session, token }) {
        // Stuff our framework session shape onto the Auth.js session
        // object. App code reads `session.framework`.
        if (typeof token.userId === 'string') {
          const framework = await resolveFrameworkSession(token.userId);
          (session as unknown as { framework: FrameworkSession | null }).framework =
            framework;
        }
        return session;
      },
      ...extraConfig.callbacks,
    },
    trustHost: true,
    secret: process.env.AUTH_SECRET,
    ...extraConfig,
  };

  return NextAuth(config);
}

/**
 * Look up a user by id. Returns null if not found.
 */
async function loadUser(userId: string): Promise<UserInfo | null> {
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    email: string;
    name: string | null;
    email_verified: boolean;
    created_at: string;
  }>(
    `SELECT id, email, name, email_verified, created_at
       FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
  };
}

/**
 * Look up the user, check the password.
 */
async function verifyPassword(
  email: string,
  password: string,
): Promise<UserInfo | null> {
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    email: string;
    name: string | null;
    password_hash: string | null;
    email_verified: boolean;
    created_at: string;
  }>(
    `SELECT id, email, name, password_hash, email_verified, created_at
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email],
  );
  const row = result.rows[0];
  if (!row || !row.password_hash) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;

  // Stamp last_login
  await db.sql(
    `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [row.id],
  );

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
  };
}

/**
 * Resolve the framework-level session for a given user id.
 *
 * Picks the user's default tenant (most recently active membership)
 * if they have one; returns null tenant + role if they have none yet
 * (first-time-login flow — they get bounced to /onboard).
 */
async function resolveFrameworkSession(
  userId: string,
): Promise<FrameworkSession | null> {
  const db = getAdminClient();

  // user
  const userResult = await db.sql<{
    id: string;
    email: string;
    name: string | null;
    email_verified: boolean;
    created_at: string;
  }>(
    `SELECT id, email, name, email_verified, created_at
       FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const userRow = userResult.rows[0];
  if (!userRow) return null;

  // memberships (most recent first)
  // CE engine notes:
  //  - JOINs across multiple tables are unreliable. We do the two-step
  //    lookup explicitly (N+1 — acceptable since N is small).
  //  - ORDER BY requires the column to also appear in the SELECT.
  const memResult = await db.sql<{
    tenant_id: string;
    role: string;
    created_at: string;
  }>(
    `SELECT tenant_id, role, created_at
       FROM memberships
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );

  const memberships: Array<{ tenant: TenantInfo; role: Role }> = [];
  for (const m of memResult.rows) {
    const tenantResult = await db.sql<{
      id: string;
      name: string;
      slug: string;
      api_key_prefix: string;
    }>(
      `SELECT id, name, slug, api_key_prefix
         FROM tenants WHERE id = $1 LIMIT 1`,
      [m.tenant_id],
    );
    const t = tenantResult.rows[0];
    if (!t) continue;
    memberships.push({
      tenant: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        apiKey: '', // not exposed in session shape — fetched separately for DB calls
      },
      role: m.role as Role,
    });
  }

  const active = memberships[0] ?? null;

  // Resolve API key for the active tenant from the framework's
  // file-backed secret store. (Production deployments swap this for
  // AWS Secrets Manager / GCP Secret Manager / Vault — see
  // readTenantApiKey below.)
  let activeTenant: TenantInfo | null = null;
  if (active) {
    const plaintext = await readTenantApiKey(active.tenant.id);
    if (plaintext) {
      activeTenant = { ...active.tenant, apiKey: plaintext };
    }
  }

  const role = active?.role ?? null;
  const permissions: ReadonlyArray<string> = role
    ? DEFAULT_ROLE_GRANTS[role] ?? []
    : [];

  return {
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      emailVerified: userRow.email_verified,
      createdAt: userRow.created_at,
    },
    tenant: activeTenant,
    role,
    permissions,
    memberships,
  };
}

/**
 * Read the plaintext tenant API key from the framework's secret store.
 *
 * Phase 1: local file at $FRAMEWORK_TENANT_KEYS_DIR/<tenant_id>.key.
 * Set FRAMEWORK_TENANT_KEYS_DIR (defaults to ./var/tenant-keys).
 *
 * Production swap-in: AWS Secrets Manager / GCP Secret Manager / Vault.
 */
async function readTenantApiKey(tenantId: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = process.env.FRAMEWORK_TENANT_KEYS_DIR ?? './var/tenant-keys';
    const key = await readFile(join(dir, `${tenantId}.key`), 'utf-8');
    return key.trim();
  } catch {
    return null;
  }
}

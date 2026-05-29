/**
 * User-management server primitives. Apps call these from server actions
 * — the register page, the team-invites page, the password-reset flow.
 *
 * The framework writes through the admin SynapCoresClient since the
 * `users` table is in the control plane (not in any tenant's data plane).
 */

import 'server-only';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';

import { getAdminClient } from '../db/server';
import type { UserInfo } from './types';

const BCRYPT_ROUNDS = 12;

export interface CreateUserInput {
  email: string;
  password?: string;
  name?: string;
}

/**
 * Create a new user account.
 *
 * Idempotency note: if the email already exists, throws
 * `UserAlreadyExistsError` so callers can render a friendly message
 * ("Sign in instead?"). Race-safe at the engine level via the
 * users.email UNIQUE constraint.
 */
export async function createUser(input: CreateUserInput): Promise<UserInfo> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new ValidationError('A valid email is required.');
  }
  if (input.password && input.password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters.');
  }

  const db = getAdminClient();

  // Conflict check
  const existing = await db.sql(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  if (existing.rows.length > 0) {
    throw new UserAlreadyExistsError(
      `An account with ${email} already exists.`,
    );
  }

  const id = randomUUID();
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, BCRYPT_ROUNDS)
    : null;

  await db.sql(
    `INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [id, email, input.name ?? null, passwordHash, false],
  );

  return {
    id,
    email,
    name: input.name ?? null,
    emailVerified: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Look up a user by email. Returns null if not found.
 */
export async function findUserByEmail(email: string): Promise<UserInfo | null> {
  const db = getAdminClient();
  const result = await db.sql<{
    id: string;
    email: string;
    name: string | null;
    email_verified: boolean;
    created_at: string;
  }>(
    `SELECT id, email, name, email_verified, created_at
       FROM users WHERE email = $1 LIMIT 1`,
    [email.trim().toLowerCase()],
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
 * Set / change the password for a user.
 * Used by both the in-app "change password" flow and the forgot-password
 * token-redemption flow.
 */
export async function setUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) {
    throw new ValidationError('Password must be at least 8 characters.');
  }
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const db = getAdminClient();
  await db.sql(
    `UPDATE users
        SET password_hash = $2, updated_at = NOW()
      WHERE id = $1`,
    [userId, hash],
  );
}

/**
 * Mark a user's email as verified — called after the user clicks a
 * verification or magic-link token.
 */
export async function markEmailVerified(userId: string): Promise<void> {
  const db = getAdminClient();
  await db.sql(
    `UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1`,
    [userId],
  );
}

// ─── one-time tokens (magic link / password reset / email verify) ─────────

export type TokenPurpose = 'magic-link' | 'password-reset' | 'email-verify';

export interface MintedToken {
  token: string;
  expiresAt: Date;
}

const DEFAULT_TTL_BY_PURPOSE: Record<TokenPurpose, number> = {
  'magic-link': 10 * 60 * 1000, // 10 min
  'password-reset': 30 * 60 * 1000, // 30 min
  'email-verify': 24 * 60 * 60 * 1000, // 24 h
};

export async function mintAuthToken(
  userId: string,
  purpose: TokenPurpose,
): Promise<MintedToken> {
  const db = getAdminClient();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_BY_PURPOSE[purpose]);
  await db.sql(
    `INSERT INTO auth_tokens (token, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, userId, purpose, expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

/**
 * Redeem a token. Returns the userId if valid, throws otherwise.
 * Single-use — marks the token as `used_at` before returning.
 */
export async function redeemAuthToken(
  token: string,
  purpose: TokenPurpose,
): Promise<string> {
  const db = getAdminClient();
  const result = await db.sql<{
    user_id: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `SELECT user_id, expires_at, used_at
       FROM auth_tokens
      WHERE token = $1 AND purpose = $2
      LIMIT 1`,
    [token, purpose],
  );
  const row = result.rows[0];
  if (!row) throw new ValidationError('Invalid or expired token.');
  if (row.used_at) throw new ValidationError('This token has already been used.');
  if (new Date(row.expires_at) < new Date()) {
    throw new ValidationError('This token has expired.');
  }
  await db.sql(
    `UPDATE auth_tokens SET used_at = NOW() WHERE token = $1`,
    [token],
  );
  return row.user_id;
}

// ─── errors ───────────────────────────────────────────────────────────────

export class UserAlreadyExistsError extends Error {
  readonly code = 'user_already_exists';
  constructor(message: string) {
    super(message);
    this.name = 'UserAlreadyExistsError';
  }
}

export class ValidationError extends Error {
  readonly code = 'validation';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

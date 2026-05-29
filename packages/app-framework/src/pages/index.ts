/**
 * Server-only framework pages. Apps mount these directly in their
 * /app/.../page.tsx files (`export { default } from ...`) or wrap
 * them in `makeTeamPage({ appName: '...' })`-style factories that
 * take per-app config.
 *
 * IMPORTANT: import from the sub-path only. The top-level barrel
 * stays client-safe; these are server components.
 */

import 'server-only';

export { default as SettingsPage } from './SettingsPage';
export { default as ProfilePage } from './ProfilePage';
export { default as WorkspaceSettingsPage } from './WorkspaceSettingsPage';
export { default as AuditLogPage } from './AuditLogPage';
export { default as ApiKeysPage } from './ApiKeysPage';
export { default as McpTokensPage } from './McpTokensPage';
export { makeTeamPage } from './TeamPage';
export { makeAcceptInvitePage } from './AcceptInvitePage';

/**
 * RBAC primitives shared across every SynapCores app.
 *
 * Apps extend `Permission` with their own action keys via TypeScript
 * declaration merging if they want strong typing on app-specific
 * actions. The framework treats Permission as an opaque string so
 * runtime checks stay flexible.
 */

export type Role =
  /** Org-level superuser; can manage tenants, billing, every app. */
  | 'owner'
  /** Tenant admin; can invite users, change settings, see audit. */
  | 'admin'
  /** Tier-1 / operator. Sees the dashboard, runs playbooks. */
  | 'analyst'
  /** Read-only; can see dashboards + audit but cannot act. */
  | 'viewer'
  /** Special — short-lived, scoped tokens for external auditors / examiners. */
  | 'auditor';

export type Permission = string;

/**
 * Framework-level permissions every app gets. App-specific perms
 * (e.g. `soar:alert:isolate-endpoint`) live in each app.
 */
export const FRAMEWORK_PERMISSIONS = {
  // Tenant-level admin
  TENANT_MANAGE: 'tenant:manage',
  TENANT_INVITE: 'tenant:invite',
  TENANT_BILLING: 'tenant:billing',

  // User management
  USER_MANAGE: 'user:manage',
  USER_VIEW: 'user:view',

  // Audit log
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',

  // MCP tokens (for external auditors / examiners)
  MCP_MINT: 'mcp:mint',
  MCP_REVOKE: 'mcp:revoke',

  // Settings
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
} as const;

export type FrameworkPermission =
  (typeof FRAMEWORK_PERMISSIONS)[keyof typeof FRAMEWORK_PERMISSIONS];

/**
 * Default role → framework permission map. Apps extend this with their
 * own grants via `registerRolePermissions()`.
 */
export const DEFAULT_ROLE_GRANTS: Readonly<Record<Role, ReadonlyArray<Permission>>> = {
  owner: Object.values(FRAMEWORK_PERMISSIONS),
  admin: [
    FRAMEWORK_PERMISSIONS.TENANT_INVITE,
    FRAMEWORK_PERMISSIONS.USER_MANAGE,
    FRAMEWORK_PERMISSIONS.USER_VIEW,
    FRAMEWORK_PERMISSIONS.AUDIT_READ,
    FRAMEWORK_PERMISSIONS.AUDIT_EXPORT,
    FRAMEWORK_PERMISSIONS.MCP_MINT,
    FRAMEWORK_PERMISSIONS.MCP_REVOKE,
    FRAMEWORK_PERMISSIONS.SETTINGS_READ,
    FRAMEWORK_PERMISSIONS.SETTINGS_WRITE,
  ],
  analyst: [
    FRAMEWORK_PERMISSIONS.USER_VIEW,
    FRAMEWORK_PERMISSIONS.AUDIT_READ,
    FRAMEWORK_PERMISSIONS.SETTINGS_READ,
  ],
  viewer: [FRAMEWORK_PERMISSIONS.AUDIT_READ, FRAMEWORK_PERMISSIONS.SETTINGS_READ],
  auditor: [FRAMEWORK_PERMISSIONS.AUDIT_READ, FRAMEWORK_PERMISSIONS.AUDIT_EXPORT],
};

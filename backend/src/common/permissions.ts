import type { UserRole } from '@prisma/client';

export type Permission =
  | 'merchant:read'
  | 'merchant:write'
  | 'applications:read'
  | 'applications:write'
  | 'apikeys:manage'
  | 'payments:read'
  | 'payments:write'
  | 'webhooks:manage'
  | 'team:manage'
  | 'platform:admin';

const READ: Permission[] = ['merchant:read', 'applications:read', 'payments:read'];
const DEV: Permission[] = [
  ...READ,
  'applications:write',
  'apikeys:manage',
  'payments:write',
  'webhooks:manage',
];
const ADMIN: Permission[] = [...DEV, 'merchant:write', 'team:manage'];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  VIEWER: READ,
  DEVELOPER: DEV,
  ADMIN,
  OWNER: ADMIN,
  PLATFORM_ADMIN: ['platform:admin'],
};

export function hasPermissions(role: UserRole, required: Permission[]): boolean {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  return required.every((p) => granted.includes(p));
}

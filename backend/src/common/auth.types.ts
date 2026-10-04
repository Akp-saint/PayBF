import type { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: UserRole;
  merchantId: string | null;
}

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  merchantId: string | null;
}

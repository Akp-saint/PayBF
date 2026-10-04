import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from './auth.decorators';
import type { AuthUser } from './auth.types';
import { hasPermissions, Permission } from './permissions';

/** A utiliser apres JwtAuthGuard. Sans @RequirePermissions, seule l'authentification est exigee. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user || !hasPermissions(user.role, required)) {
      throw new ForbiddenException('Permission insuffisante');
    }
    return true;
  }
}

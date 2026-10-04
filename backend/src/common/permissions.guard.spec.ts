import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import type { Permission } from './permissions';

function contextWith(user: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(required?: Permission[]): PermissionsGuard {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  it('laisse passer quand aucune permission n\'est exigee', () => {
    expect(guardRequiring().canActivate(contextWith({ role: 'VIEWER' }))).toBe(true);
  });

  it('autorise un role qui possede la permission', () => {
    const guard = guardRequiring(['apikeys:manage']);
    expect(guard.canActivate(contextWith({ role: 'DEVELOPER' }))).toBe(true);
  });

  it('refuse un role sans la permission (403)', () => {
    const guard = guardRequiring(['apikeys:manage']);
    expect(() => guard.canActivate(contextWith({ role: 'VIEWER' }))).toThrow(ForbiddenException);
  });

  it('refuse une requete sans utilisateur', () => {
    const guard = guardRequiring(['merchant:read']);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});

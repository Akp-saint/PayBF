import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';
import { generateApiKey } from './api-key.util';

function setup(opts: { scopes?: string[]; allowPublishable?: boolean } = {}) {
  const prisma = {
    apiKey: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  };
  const reflector = {
    getAllAndOverride: jest.fn().mockImplementation((metaKey: string) => {
      if (metaKey === 'paybf:api-scopes') return opts.scopes;
      if (metaKey === 'paybf:allow-publishable') return opts.allowPublishable;
      return undefined;
    }),
  } as unknown as Reflector;
  const guard = new ApiKeyGuard(prisma as never, reflector);
  const request: Record<string, unknown> = {};
  const contextFor = (authorization?: string): ExecutionContext => {
    Object.assign(request, { header: (n: string) => (n === 'authorization' ? authorization : undefined) });
    return {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };
  return { guard, prisma, request, contextFor };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'key_1',
  merchantId: 'mer_1',
  applicationId: 'app_1',
  type: 'SECRET',
  environment: 'TEST',
  permissions: ['payments:write', 'payments:read'],
  revokedAt: null,
  lastUsedAt: new Date(),
  merchant: { status: 'ACTIVE' },
  ...over,
});

describe('ApiKeyGuard', () => {
  it('accepte une cle valide et renseigne le contexte (merchantId vient de la cle)', async () => {
    const { guard, prisma, request, contextFor } = setup({ scopes: ['payments:write'] });
    const { key, hash } = generateApiKey('SECRET');
    prisma.apiKey.findUnique.mockResolvedValue(row());
    await expect(guard.canActivate(contextFor(`Bearer ${key}`))).resolves.toBe(true);
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { hash } }));
    expect(request.apiKey).toMatchObject({ merchantId: 'mer_1', applicationId: 'app_1' });
  });

  it.each([undefined, 'Basic abc', 'Bearer pas-une-cle', 'Bearer sk_test_court'])(
    'refuse un en-tete absent ou mal forme (%s)',
    async (header) => {
      const { guard, contextFor } = setup();
      await expect(guard.canActivate(contextFor(header))).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('refuse une cle inconnue', async () => {
    const { guard, prisma, contextFor } = setup();
    prisma.apiKey.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(contextFor(`Bearer ${generateApiKey('SECRET').key}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuse une cle revoquee', async () => {
    const { guard, prisma, contextFor } = setup();
    prisma.apiKey.findUnique.mockResolvedValue(row({ revokedAt: new Date(Date.now() - 1000) }));
    await expect(guard.canActivate(contextFor(`Bearer ${generateApiKey('SECRET').key}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepte encore une cle en periode de grace apres rotation (revokedAt dans le futur)', async () => {
    const { guard, prisma, contextFor } = setup();
    prisma.apiKey.findUnique.mockResolvedValue(row({ revokedAt: new Date(Date.now() + 3_600_000) }));
    await expect(guard.canActivate(contextFor(`Bearer ${generateApiKey('SECRET').key}`))).resolves.toBe(true);
  });

  it('refuse une cle publique sur une route reservee aux cles secretes', async () => {
    const { guard, prisma, contextFor } = setup();
    prisma.apiKey.findUnique.mockResolvedValue(row({ type: 'PUBLISHABLE', permissions: [] }));
    await expect(guard.canActivate(contextFor(`Bearer ${generateApiKey('PUBLISHABLE').key}`))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('accepte une cle publique quand la route l\'autorise', async () => {
    const { guard, prisma, contextFor } = setup({ allowPublishable: true });
    prisma.apiKey.findUnique.mockResolvedValue(row({ type: 'PUBLISHABLE', permissions: [] }));
    await expect(guard.canActivate(contextFor(`Bearer ${generateApiKey('PUBLISHABLE').key}`))).resolves.toBe(true);
  });

  it('refuse une cle sans la permission exigee par la route', async () => {
    const { guard, prisma, contextFor } = setup({ scopes: ['refunds:write'] });
    prisma.apiKey.findUnique.mockResolvedValue(row());
    await expect(guard.canActivate(contextFor(`Bearer ${generateApiKey('SECRET').key}`))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuse un marchand suspendu et toute cle live', async () => {
    const { guard, prisma, contextFor } = setup();
    const bearer = `Bearer ${generateApiKey('SECRET').key}`;
    prisma.apiKey.findUnique.mockResolvedValue(row({ merchant: { status: 'SUSPENDED' } }));
    await expect(guard.canActivate(contextFor(bearer))).rejects.toBeInstanceOf(ForbiddenException);
    prisma.apiKey.findUnique.mockResolvedValue(row({ environment: 'LIVE' }));
    await expect(guard.canActivate(contextFor(bearer))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

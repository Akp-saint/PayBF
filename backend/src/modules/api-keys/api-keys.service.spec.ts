import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ALL_API_SCOPES } from '../../common/api-scopes';
import { sha256 } from '../../common/stable-json';
import type { AuthUser } from '../../common/auth.types';
import { ApiKeysService, ROTATION_GRACE_MS } from './api-keys.service';

const owner: AuthUser = { id: 'usr_a', role: 'OWNER', merchantId: 'mer_a' };
const platformAdmin: AuthUser = { id: 'adm', role: 'PLATFORM_ADMIN', merchantId: null };

function build() {
  const prisma = {
    application: { findFirst: jest.fn().mockResolvedValue({ id: 'app_a', merchantId: 'mer_a' }) },
    apiKey: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'key_new',
          applicationId: data.applicationId,
          type: data.type,
          environment: 'TEST',
          prefix: data.prefix,
          last4: data.last4,
          permissions: data.permissions,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date(),
        }),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new ApiKeysService(prisma as never, audit as never), prisma, audit };
}

describe('ApiKeysService', () => {
  it('create renvoie le secret complet UNE fois et ne stocke que son hash', async () => {
    const { service, prisma } = build();
    const result = await service.create(owner, { applicationId: 'app_a', type: 'SECRET' }, {});
    expect(result.secret).toMatch(/^sk_test_[A-Za-z0-9_-]{32}$/);
    const stored = prisma.apiKey.create.mock.calls[0][0].data;
    expect(stored.hash).toBe(sha256(result.secret));
    expect(JSON.stringify(stored)).not.toContain(result.secret);
    expect(stored.permissions).toEqual([...ALL_API_SCOPES]);
    expect(result.masked_key).toBe(`${result.secret.slice(0, 12)}…${result.secret.slice(-4)}`);
  });

  it('une cle publique n\'a aucune permission d\'ecriture', async () => {
    const { service, prisma } = build();
    const result = await service.create(owner, { applicationId: 'app_a', type: 'PUBLISHABLE', permissions: ['payments:write'] }, {});
    expect(result.secret.startsWith('pk_test_')).toBe(true);
    expect(prisma.apiKey.create.mock.calls[0][0].data.permissions).toEqual([]);
  });

  it('respecte les permissions demandees pour une cle secrete', async () => {
    const { service, prisma } = build();
    await service.create(owner, { applicationId: 'app_a', type: 'SECRET', permissions: ['payments:read'] }, {});
    expect(prisma.apiKey.create.mock.calls[0][0].data.permissions).toEqual(['payments:read']);
  });

  it('list ne retourne jamais le hash ni le secret, uniquement la cle masquee', async () => {
    const { service, prisma } = build();
    prisma.apiKey.findMany.mockResolvedValue([
      { id: 'k1', applicationId: 'app_a', type: 'SECRET', environment: 'TEST', prefix: 'sk_test_AbCd', last4: 'wxyz', permissions: [], lastUsedAt: null, revokedAt: null, createdAt: new Date() },
    ]);
    const { data } = await service.list(owner);
    expect(data[0].masked_key).toBe('sk_test_AbCd…wxyz');
    expect(JSON.stringify(data)).not.toMatch(/hash|secret/);
    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'mer_a' } }));
    expect(prisma.apiKey.findMany.mock.calls[0][0].select).not.toHaveProperty('hash');
  });

  it('ISOLATION : impossible de creer une cle pour l\'application d\'un autre marchand', async () => {
    const { service, prisma } = build();
    prisma.application.findFirst.mockResolvedValue(null);
    await expect(service.create(owner, { applicationId: 'app_of_b', type: 'SECRET' }, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.application.findFirst).toHaveBeenCalledWith({ where: { id: 'app_of_b', merchantId: 'mer_a' } });
    expect(prisma.apiKey.create).not.toHaveBeenCalled();
  });

  it('ISOLATION : rotation et revocation d\'une cle d\'un autre marchand renvoient 404', async () => {
    const { service, prisma } = build();
    await expect(service.rotate(owner, 'key_of_b', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.revoke(owner, 'key_of_b', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({ where: { id: 'key_of_b', merchantId: 'mer_a' } });
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('un compte sans marchand ne peut pas gerer de cles', async () => {
    const { service } = build();
    await expect(service.list(platformAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotate cree une nouvelle cle identique et laisse l\'ancienne valable 24 h', async () => {
    const { service, prisma, audit } = build();
    prisma.apiKey.findFirst.mockResolvedValue({
      id: 'key_old', merchantId: 'mer_a', applicationId: 'app_a', type: 'SECRET', permissions: ['payments:read'], revokedAt: null,
    });
    const before = Date.now();
    const result = await service.rotate(owner, 'key_old', {});
    expect(result.secret).toMatch(/^sk_test_/);
    expect(prisma.apiKey.create.mock.calls[0][0].data).toMatchObject({
      permissions: ['payments:read'],
      rotatedFromId: 'key_old',
    });
    const graceEnd: Date = prisma.apiKey.update.mock.calls[0][0].data.revokedAt;
    expect(graceEnd.getTime()).toBeGreaterThanOrEqual(before + ROTATION_GRACE_MS - 1000);
    expect(graceEnd.getTime()).toBeLessThanOrEqual(Date.now() + ROTATION_GRACE_MS + 1000);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.rotate' }));
  });

  it('rotate refuse une cle deja revoquee', async () => {
    const { service, prisma } = build();
    prisma.apiKey.findFirst.mockResolvedValue({ id: 'k', revokedAt: new Date(Date.now() - 1000) });
    await expect(service.rotate(owner, 'k', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revoke est immediat, journalise, et idempotent', async () => {
    const { service, prisma, audit } = build();
    prisma.apiKey.findFirst.mockResolvedValue({
      id: 'k1', applicationId: 'app_a', type: 'SECRET', environment: 'TEST', prefix: 'sk_test_xxxx', last4: 'abcd',
      permissions: [], lastUsedAt: null, revokedAt: null, createdAt: new Date(),
    });
    const result = await service.revoke(owner, 'k1', {});
    expect(result.revoked_at).toBeInstanceOf(Date);
    expect(prisma.apiKey.update).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'api_key.revoke' }));

    prisma.apiKey.update.mockClear();
    prisma.apiKey.findFirst.mockResolvedValue({
      id: 'k1', applicationId: 'app_a', type: 'SECRET', environment: 'TEST', prefix: 'sk_test_xxxx', last4: 'abcd',
      permissions: [], lastUsedAt: null, revokedAt: new Date(Date.now() - 5000), createdAt: new Date(),
    });
    await service.revoke(owner, 'k1', {});
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });
});

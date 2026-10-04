import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth.types';
import { ApplicationsService } from './applications.service';

const merchantA: AuthUser = { id: 'user_a', role: 'OWNER', merchantId: 'mer_a' };
const platformAdmin: AuthUser = { id: 'admin', role: 'PLATFORM_ADMIN', merchantId: null };

function build() {
  const prisma = {
    application: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'app_1', ...data })),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ApplicationsService(prisma as never, audit as never);
  return { service, prisma, audit };
}

describe('ApplicationsService - isolation multi-marchands', () => {
  it('list filtre toujours par le merchantId du jeton', async () => {
    const { service, prisma } = build();
    await service.list(merchantA);
    expect(prisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: 'mer_a' } }),
    );
  });

  it('get filtre par id ET merchantId : l\'application d\'un autre marchand est introuvable (404)', async () => {
    const { service, prisma } = build();
    await expect(service.get(merchantA, 'app_of_merchant_b')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.application.findFirst).toHaveBeenCalledWith({
      where: { id: 'app_of_merchant_b', merchantId: 'mer_a' },
    });
  });

  it('create attribue l\'application au marchand du jeton et journalise l\'action', async () => {
    const { service, prisma, audit } = build();
    const result = await service.create(merchantA, { name: 'Boutique' }, {});
    expect(prisma.application.create).toHaveBeenCalledWith({
      data: { merchantId: 'mer_a', name: 'Boutique', environment: 'TEST' },
    });
    expect(result.merchantId).toBe('mer_a');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'application.create', merchantId: 'mer_a' }));
  });

  it('un compte sans marchand (admin plateforme) ne peut pas utiliser ces routes', async () => {
    const { service } = build();
    await expect(service.list(platformAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.get(platformAdmin, 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

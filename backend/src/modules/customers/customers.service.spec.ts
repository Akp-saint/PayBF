import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiKeyContext } from '../../common/api-key.types';
import { CustomersService } from './customers.service';

const keyA: ApiKeyContext = { id: 'k', merchantId: 'mer_a', applicationId: 'app_a', environment: 'TEST', type: 'SECRET', permissions: [] };

function build() {
  const prisma = {
    customer: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date() })),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  return { service: new CustomersService(prisma as never), prisma };
}

describe('CustomersService', () => {
  it('cree un client rattache au marchand de la cle', async () => {
    const { service, prisma } = build();
    const customer = await service.create(keyA, { name: 'Awa', email: 'awa@example.com', phone: '70000000' });
    expect(customer.id).toMatch(/^cus_[0-9a-f]{24}$/);
    expect(prisma.customer.create.mock.calls[0][0].data.merchantId).toBe('mer_a');
  });

  it('refuse un email deja utilise chez ce marchand (409)', async () => {
    const { service, prisma } = build();
    prisma.customer.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }),
    );
    await expect(service.create(keyA, { name: 'Awa', email: 'awa@example.com' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('ISOLATION : le client d\'un autre marchand est introuvable', async () => {
    const { service, prisma } = build();
    await expect(service.get(keyA, 'cus_of_b')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({ where: { id: 'cus_of_b', merchantId: 'mer_a' } });
  });
});

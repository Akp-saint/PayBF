import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IDEMPOTENCY_TTL_MS, IdempotencyService } from './idempotency.service';

const duplicate = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

function build() {
  const prisma = {
    idempotencyRecord: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { service: new IdempotencyService(prisma as never), prisma };
}

describe('IdempotencyService', () => {
  it('premiere requete : enregistre la cle et laisse l\'operation s\'executer', async () => {
    const { service, prisma } = build();
    await expect(service.begin('mer_1', 'abc123', 'hash-1')).resolves.toEqual({ replay: false });
    expect(prisma.idempotencyRecord.create).toHaveBeenCalledWith({
      data: { merchantId: 'mer_1', key: 'abc123', requestHash: 'hash-1' },
    });
  });

  it('meme cle, meme corps, operation terminee : rejoue la reponse d\'origine', async () => {
    const { service, prisma } = build();
    prisma.idempotencyRecord.create.mockRejectedValue(duplicate());
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'i1',
      requestHash: 'hash-1',
      status: 'COMPLETED',
      responseSnapshot: { id: 'txn_1' },
      createdAt: new Date(),
    });
    await expect(service.begin('mer_1', 'abc123', 'hash-1')).resolves.toEqual({
      replay: true,
      response: { id: 'txn_1' },
    });
  });

  it('meme cle avec un corps different : 409 idempotency_key_reuse', async () => {
    const { service, prisma } = build();
    prisma.idempotencyRecord.create.mockRejectedValue(duplicate());
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'i1',
      requestHash: 'hash-1',
      status: 'COMPLETED',
      createdAt: new Date(),
    });
    const error = await service.begin('mer_1', 'abc123', 'AUTRE-hash').catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().code).toBe('idempotency_key_reuse');
  });

  it('requete simultanee encore en cours : 409 request_in_progress', async () => {
    const { service, prisma } = build();
    prisma.idempotencyRecord.create.mockRejectedValue(duplicate());
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'i1',
      requestHash: 'hash-1',
      status: 'IN_PROGRESS',
      createdAt: new Date(),
    });
    const error = await service.begin('mer_1', 'abc123', 'hash-1').catch((e) => e);
    expect(error.getResponse().code).toBe('request_in_progress');
  });

  it('une cle de plus de 24 h est purgee et reutilisable', async () => {
    const { service, prisma } = build();
    prisma.idempotencyRecord.create.mockRejectedValueOnce(duplicate()).mockResolvedValueOnce({});
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      id: 'old',
      requestHash: 'hash-1',
      status: 'COMPLETED',
      createdAt: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 1000),
    });
    await expect(service.begin('mer_1', 'abc123', 'hash-1')).resolves.toEqual({ replay: false });
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'old' } });
  });

  it('les autres erreurs de base de donnees ne sont pas avalees', async () => {
    const { service, prisma } = build();
    prisma.idempotencyRecord.create.mockRejectedValue(new Error('connexion perdue'));
    await expect(service.begin('mer_1', 'k', 'h')).rejects.toThrow('connexion perdue');
  });

  it('abort ne supprime que les cles encore IN_PROGRESS', async () => {
    const { service, prisma } = build();
    await service.abort('mer_1', 'abc123');
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { merchantId: 'mer_1', key: 'abc123', status: 'IN_PROGRESS' },
    });
  });
});

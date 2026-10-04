import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ApiKeyContext } from '../../common/api-key.types';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { createSandboxProviders } from '../providers/mock/mock-payment.provider';
import { ProviderRegistry } from '../providers/provider.registry';
import { PaymentLifecycleService } from './payment-lifecycle.service';
import { PaymentsService } from './payments.service';
import type { CreatePaymentDto } from './dto/payment.dto';

const keyA: ApiKeyContext = {
  id: 'key_a',
  merchantId: 'mer_a',
  applicationId: 'app_a',
  environment: 'TEST',
  type: 'SECRET',
  permissions: [],
};

const dto = (over: Partial<CreatePaymentDto> = {}): CreatePaymentDto => ({
  amount: 10000,
  currency: 'XOF',
  description: 'Consultation medicale',
  customer: { name: 'Test User', email: 'test@example.com', phone: '70000000' },
  payment_method: 'mobile_money',
  provider: 'orange_money',
  success_url: 'https://merchant.com/success',
  cancel_url: 'https://merchant.com/cancel',
  ...over,
});

function build() {
  const store: { payments: any[]; records: Map<string, any> } = { payments: [], records: new Map() };

  const tx = {
    customer: { upsert: jest.fn().mockResolvedValue({ id: 'cus_1' }) },
    payment: {
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { ...data, status: 'PENDING', createdAt: new Date(), customer: { id: 'cus_1', name: 'Test User', email: 'test@example.com', phone: '70000000' } };
        store.payments.push(row);
        return Promise.resolve(row);
      }),
    },
    transaction: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    payment: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    idempotencyRecord: {} as any,
  };

  // Idempotence reelle, adossee a un faux stockage en memoire (comme la contrainte unique de PostgreSQL).
  const { Prisma } = jest.requireActual('@prisma/client');
  prisma.idempotencyRecord = {
    create: jest.fn().mockImplementation(({ data }) => {
      const id = `${data.merchantId}:${data.key}`;
      if (store.records.has(id)) {
        return Promise.reject(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }));
      }
      store.records.set(id, { id, ...data, status: 'IN_PROGRESS', createdAt: new Date() });
      return Promise.resolve({});
    }),
    findUnique: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(store.records.get(`${where.merchantId_key.merchantId}:${where.merchantId_key.key}`) ?? null),
    ),
    update: jest.fn().mockImplementation(({ where, data }) => {
      const rec = store.records.get(`${where.merchantId_key.merchantId}:${where.merchantId_key.key}`);
      Object.assign(rec, data);
      return Promise.resolve(rec);
    }),
    deleteMany: jest.fn().mockImplementation(({ where }) => {
      store.records.delete(`${where.merchantId}:${where.key}`);
      return Promise.resolve({ count: 1 });
    }),
  };

  const config = { get: () => 'http://localhost:3000' };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const lifecycle = {
    transition: jest.fn(),
    expireIfNeeded: jest.fn().mockResolvedValue(null),
  };
  const service = new PaymentsService(
    prisma as never,
    config as never,
    new ProviderRegistry(createSandboxProviders()),
    new IdempotencyService(prisma as never),
    lifecycle as unknown as PaymentLifecycleService,
    audit as never,
  );
  return { service, prisma, tx, store, lifecycle, audit };
}

describe('PaymentsService.create', () => {
  it('cree un paiement PENDING avec payment_url et montants en nombres', async () => {
    const { service, tx } = build();
    const { payment, replayed } = await service.create(keyA, dto(), 'abc123', {});
    expect(replayed).toBe(false);
    expect(payment.status).toBe('PENDING');
    expect(payment.amount).toBe(10000);
    expect(payment.currency).toBe('XOF');
    expect(payment.id).toMatch(/^txn_[0-9a-f]{24}$/);
    expect(payment.payment_url).toBe(`http://localhost:3000/pay/${payment.id}`);
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      merchantId: 'mer_a',
      applicationId: 'app_a',
      providerCode: 'orange_money',
      methodType: 'MOBILE_MONEY',
    });
    expect(tx.transaction.create).toHaveBeenCalledTimes(1);
    expect(() => JSON.stringify(payment)).not.toThrow(); // pas de BigInt dans la reponse
  });

  it('IDEMPOTENCE : deux envois de la meme Idempotency-Key creent UNE seule transaction', async () => {
    const { service, tx, store } = build();
    const first = await service.create(keyA, dto(), 'abc123', {});
    const second = await service.create(keyA, dto(), 'abc123', {});
    expect(second.replayed).toBe(true);
    expect(second.payment).toEqual(first.payment);
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(store.payments).toHaveLength(1);
  });

  it('IDEMPOTENCE : la meme cle avec un corps different est refusee (409)', async () => {
    const { service, tx } = build();
    await service.create(keyA, dto(), 'abc123', {});
    const error = await service.create(keyA, dto({ amount: 99999 }), 'abc123', {}).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().code).toBe('idempotency_key_reuse');
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
  });

  it('IDEMPOTENCE : une meme cle chez deux marchands differents ne se melange pas', async () => {
    const { service, tx } = build();
    await service.create(keyA, dto(), 'abc123', {});
    await service.create({ ...keyA, merchantId: 'mer_b', id: 'key_b' }, dto(), 'abc123', {});
    expect(tx.payment.create).toHaveBeenCalledTimes(2);
  });

  it('sans Idempotency-Key, chaque appel cree un paiement', async () => {
    const { service, tx } = build();
    await service.create(keyA, dto(), undefined, {});
    await service.create(keyA, dto(), undefined, {});
    expect(tx.payment.create).toHaveBeenCalledTimes(2);
  });

  it('si la creation echoue, la cle est liberee et un retry est possible', async () => {
    const { service, tx, store } = build();
    tx.payment.create.mockRejectedValueOnce(new Error('base indisponible'));
    await expect(service.create(keyA, dto(), 'abc123', {})).rejects.toThrow('base indisponible');
    expect(store.records.size).toBe(0);
    const retry = await service.create(keyA, dto(), 'abc123', {});
    expect(retry.replayed).toBe(false);
  });

  it('refuse un prestataire inconnu, un moyen non supporte et une Idempotency-Key invalide', async () => {
    const { service } = build();
    await expect(service.create(keyA, dto({ provider: 'wave' }), undefined, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(keyA, dto({ provider: 'orange_money', payment_method: 'card' }), undefined, {}),
    ).rejects.toMatchObject({ response: { code: 'payment_method_not_supported' } });
    await expect(service.create(keyA, dto(), 'cle invalide avec espaces', {})).rejects.toMatchObject({
      response: { code: 'invalid_idempotency_key' },
    });
  });

  it('refuse des metadata trop volumineuses', async () => {
    const { service } = build();
    await expect(
      service.create(keyA, dto({ metadata: { blob: 'x'.repeat(2500) } }), undefined, {}),
    ).rejects.toMatchObject({ response: { code: 'metadata_too_large' } });
  });

  it('journalise la creation avec l\'acteur api_key', async () => {
    const { service, audit } = build();
    await service.create(keyA, dto(), undefined, {});
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.create', actorType: 'api_key', merchantId: 'mer_a' }),
    );
  });
});

describe('PaymentsService - isolation multi-marchands', () => {
  it('get filtre par id ET merchantId : le paiement d\'un autre marchand est introuvable', async () => {
    const { service, prisma } = build();
    await expect(service.get(keyA, 'txn_of_merchant_b')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'txn_of_merchant_b', merchantId: 'mer_a' } }),
    );
  });

  it('cancel verifie l\'appartenance avant toute transition', async () => {
    const { service, lifecycle } = build();
    await expect(service.cancel(keyA, 'txn_of_merchant_b', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(lifecycle.transition).not.toHaveBeenCalled();
  });

  it('list ne retourne que les paiements du marchand de la cle', async () => {
    const { service, prisma } = build();
    await service.list(keyA, {});
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { merchantId: 'mer_a' } }),
    );
  });

  it('cancel d\'un paiement du marchand passe par la machine a etats', async () => {
    const { service, prisma, lifecycle } = build();
    prisma.payment.findFirst.mockResolvedValue({ id: 'txn_1', merchantId: 'mer_a' });
    lifecycle.transition.mockResolvedValue({
      id: 'txn_1', status: 'CANCELLED', amount: 10000n, currency: 'XOF', description: null, providerCode: null,
      methodType: null, successUrl: null, cancelUrl: null, metadata: null, expiresAt: null, createdAt: new Date(), customer: null,
    });
    const result = await service.cancel(keyA, 'txn_1', {});
    expect(lifecycle.transition).toHaveBeenCalledWith('txn_1', 'CANCELLED');
    expect(result.status).toBe('CANCELLED');
  });
});

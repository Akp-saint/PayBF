import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createSandboxProviders } from '../providers/mock/mock-payment.provider';
import { ProviderRegistry } from '../providers/provider.registry';
import { CheckoutService } from './checkout.service';
import { PaymentLifecycleService } from './payment-lifecycle.service';

const basePayment = (over: Record<string, unknown> = {}) => ({
  id: 'txn_1',
  merchantId: 'mer_1',
  customerId: 'cus_1',
  status: 'PENDING',
  amount: 10000n,
  currency: 'XOF',
  description: 'Consultation',
  providerCode: null,
  methodType: null,
  successUrl: 'https://m.com/ok',
  cancelUrl: 'https://m.com/ko',
  expiresAt: new Date(Date.now() + 600_000),
  customer: { name: 'Awa Traore', email: 'awa@example.com' },
  merchant: { name: 'Clinique Test', logoUrl: null },
  ...over,
});

function build(payment: ReturnType<typeof basePayment> | null = basePayment()) {
  const prisma = {
    payment: {
      findUnique: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...payment, ...data })),
    },
    providerTransaction: { create: jest.fn().mockResolvedValue({}) },
    paymentMethod: { create: jest.fn().mockResolvedValue({}) },
  };
  const lifecycle = {
    transition: jest.fn().mockImplementation((_id: string, to: string, extra: object) =>
      Promise.resolve({ ...payment, status: to, ...extra }),
    ),
    expireIfNeeded: jest.fn().mockResolvedValue(null),
  };
  const service = new CheckoutService(
    prisma as never,
    new ProviderRegistry(createSandboxProviders()),
    lifecycle as unknown as PaymentLifecycleService,
  );
  return { service, prisma, lifecycle };
}

describe('CheckoutService', () => {
  it('affiche la page de paiement sans exposer l\'email complet', async () => {
    const { service } = build();
    const view = await service.view('txn_1');
    expect(view).toMatchObject({
      amount: 10000,
      currency: 'XOF',
      status: 'PENDING',
      sandbox: true,
      merchant: { name: 'Clinique Test' },
      customer: { name: 'Awa Traore', email: 'a***@example.com' },
    });
    expect(view.providers.length).toBeGreaterThan(0);
  });

  it('paiement reussi (70000001) : etat SUCCESS et redirection vers success_url', async () => {
    const { service, lifecycle, prisma } = build();
    const view = await service.pay('txn_1', { provider: 'orange_money', payer: '70000001' });
    expect(lifecycle.transition).toHaveBeenCalledWith('txn_1', 'SUCCESS', expect.objectContaining({ providerCode: 'orange_money' }));
    expect(view.status).toBe('SUCCESS');
    expect(view.redirect_url).toBe('https://m.com/ok');
    expect(prisma.providerTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('paiement echoue (70000002) : etat FAILED, erreur explicite, redirection vers cancel_url', async () => {
    const { service } = build();
    const view = await service.pay('txn_1', { provider: 'orange_money', payer: '70000002' });
    expect(view.status).toBe('FAILED');
    expect(view.error).toMatchObject({ code: 'insufficient_funds' });
    expect(view.redirect_url).toBe('https://m.com/ko');
  });

  it('paiement en attente (70000003) : reste PENDING, aucune transition', async () => {
    const { service, lifecycle, prisma } = build();
    const view = await service.pay('txn_1', { provider: 'orange_money', payer: '70000003' });
    expect(view.status).toBe('PENDING');
    expect(lifecycle.transition).not.toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalled();
  });

  it('timeout du prestataire (70000004) : le paiement reste PENDING (jamais marque en echec) et l\'erreur est tracee', async () => {
    const { service, lifecycle, prisma } = build();
    const view = await service.pay('txn_1', { provider: 'orange_money', payer: '70000004' });
    expect(view.status).toBe('PENDING');
    expect(view.error).toMatchObject({ code: 'provider_timeout' });
    expect(lifecycle.transition).not.toHaveBeenCalled();
    expect(prisma.providerTransaction.create.mock.calls[0][0].data).toMatchObject({
      errorCode: 'provider_timeout',
      rawStatus: 'ERROR',
    });
  });

  it('ne stocke que le numero masque dans les logs et le moyen de paiement', async () => {
    const { service, prisma } = build();
    await service.pay('txn_1', { provider: 'orange_money', payer: '70000001' });
    expect(prisma.providerTransaction.create.mock.calls[0][0].data.requestLog.payer).toBe('70****01');
    expect(prisma.paymentMethod.create.mock.calls[0][0].data.msisdnMasked).toBe('70****01');
    expect(JSON.stringify(prisma.providerTransaction.create.mock.calls)).not.toContain('70000001');
  });

  it('refuse de payer un paiement qui n\'est plus en attente (409)', async () => {
    const { service } = build(basePayment({ status: 'SUCCESS' }));
    await expect(service.pay('txn_1', { provider: 'orange_money', payer: '70000001' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('respecte le prestataire impose par le marchand', async () => {
    const { service } = build(basePayment({ providerCode: 'orange_money', methodType: 'MOBILE_MONEY' }));
    await expect(service.pay('txn_1', { provider: 'moov_money', payer: '70000001' })).rejects.toMatchObject({
      response: { code: 'provider_mismatch' },
    });
  });

  it('refuse une carte sur un prestataire Mobile Money', async () => {
    const { service } = build(basePayment({ methodType: 'CARD' }));
    await expect(service.pay('txn_1', { provider: 'orange_money', payer: 'tok_success' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un paiement inconnu renvoie 404', async () => {
    const { service } = build(null);
    await expect(service.view('txn_inconnu')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un paiement expire est bascule en EXPIRED au chargement', async () => {
    const payment = basePayment({ expiresAt: new Date(Date.now() - 1000) });
    const { service, lifecycle } = build(payment);
    lifecycle.expireIfNeeded.mockResolvedValue({ ...payment, status: 'EXPIRED' });
    const view = await service.view('txn_1');
    expect(view.status).toBe('EXPIRED');
    expect(view.redirect_url).toBe('https://m.com/ko');
  });
});

describe('PaymentLifecycleService', () => {
  function buildLifecycle(updateCount: number) {
    const tx = {
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'txn_1', amount: 10000n, customer: null }),
      },
      transaction: { updateMany: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { service: new PaymentLifecycleService(prisma as never), tx };
  }

  it('la transition est conditionnelle a l\'etat precedent (atomique)', async () => {
    const { service, tx } = buildLifecycle(1);
    await service.transition('txn_1', 'SUCCESS');
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'txn_1', status: { in: ['PENDING'] } } }),
    );
    expect(tx.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUCCESS', balanceEffect: 10000n } }),
    );
  });

  it('refuse (409) quand le paiement n\'est plus dans un etat de depart valide', async () => {
    const { service, tx } = buildLifecycle(0);
    await expect(service.transition('txn_1', 'SUCCESS')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('un echec ou une annulation n\'ont aucun effet sur le solde', async () => {
    const { service, tx } = buildLifecycle(1);
    await service.transition('txn_1', 'CANCELLED');
    expect(tx.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED', balanceEffect: 0n } }),
    );
  });

  it('expireIfNeeded ignore les paiements non expires ou deja traites', async () => {
    const { service } = buildLifecycle(1);
    expect(await service.expireIfNeeded({ id: 'a', status: 'PENDING', expiresAt: new Date(Date.now() + 1000) })).toBeNull();
    expect(await service.expireIfNeeded({ id: 'a', status: 'SUCCESS', expiresAt: new Date(Date.now() - 1000) })).toBeNull();
    expect(await service.expireIfNeeded({ id: 'a', status: 'PENDING', expiresAt: null })).toBeNull();
  });

  it('expireIfNeeded ne plante pas si une autre requete a traite le paiement entre-temps', async () => {
    const { service } = buildLifecycle(0);
    expect(await service.expireIfNeeded({ id: 'a', status: 'PENDING', expiresAt: new Date(Date.now() - 1000) })).toBeNull();
  });
});

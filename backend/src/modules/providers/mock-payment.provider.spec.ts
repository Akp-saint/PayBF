import { BadRequestException } from '@nestjs/common';
import {
  createSandboxProviders,
  maskPayerRef,
  MockPaymentProvider,
  normalizePayerRef,
} from './mock/mock-payment.provider';
import { ProviderTimeoutError } from './payment-provider.interface';
import { ProviderRegistry } from './provider.registry';

const provider = new MockPaymentProvider({ code: 'orange_money', name: 'Orange', methods: ['MOBILE_MONEY'] });
const input = (payerRef: string) => ({
  paymentId: 'txn_1',
  amount: 10000,
  currency: 'XOF',
  methodType: 'MOBILE_MONEY' as const,
  payerRef,
});

describe('MockPaymentProvider (sandbox)', () => {
  it('70000001 reussit, 70000002 echoue, 70000003 reste en attente', async () => {
    expect((await provider.createPayment(input('70000001'))).status).toBe('SUCCESS');
    const failed = await provider.createPayment(input('70000002'));
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('insufficient_funds');
    expect((await provider.createPayment(input('70000003'))).status).toBe('PENDING');
  });

  it('70000004 simule un timeout du prestataire', async () => {
    await expect(provider.createPayment(input('70000004'))).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('accepte l\'indicatif +226 et les espaces', async () => {
    expect((await provider.createPayment(input('+226 70 00 00 02'))).status).toBe('FAILED');
    expect(normalizePayerRef('+226 70000001')).toBe('70000001');
  });

  it('un numero quelconque reussit par defaut', async () => {
    expect((await provider.createPayment(input('76123456'))).status).toBe('SUCCESS');
  });

  it('les jetons de carte de test fonctionnent', async () => {
    const card = new MockPaymentProvider({ code: 'card', name: 'Carte', methods: ['CARD'] });
    expect((await card.createPayment({ ...input('tok_declined'), methodType: 'CARD' })).status).toBe('FAILED');
    expect((await card.createPayment({ ...input('tok_success'), methodType: 'CARD' })).status).toBe('SUCCESS');
  });

  it('verifyPayment relit le statut depuis la reference', async () => {
    const created = await provider.createPayment(input('70000003'));
    expect(await provider.getPaymentStatus(created.providerRef)).toBe('PENDING');
    expect((await provider.verifyPayment(created.providerRef)).status).toBe('PENDING');
    expect(await provider.getPaymentStatus('ref_inconnue')).toBe('FAILED');
  });

  it('masque les numeros dans les logs', () => {
    expect(maskPayerRef('70000001')).toBe('70****01');
    expect(maskPayerRef('+226 70000001')).toBe('70****01');
    expect(maskPayerRef('123')).toBe('****');
  });

  it('refund et payout sont simules', async () => {
    expect((await provider.refundPayment({ providerRef: 'x', amount: 100 })).status).toBe('SUCCESS');
    expect((await provider.payout({ amount: 100, currency: 'XOF', destination: '70000001' })).status).toBe('SUCCESS');
  });
});

describe('ProviderRegistry', () => {
  const registry = new ProviderRegistry(createSandboxProviders());

  it('resout un prestataire par son code', () => {
    expect(registry.get('orange_money')?.sandbox).toBe(true);
    expect(registry.require('moov_money').code).toBe('moov_money');
  });

  it('refuse un prestataire inconnu (400)', () => {
    expect(() => registry.require('wave')).toThrow(BadRequestException);
  });

  it('filtre par moyen de paiement', () => {
    const codes = registry.list({ method: 'CARD' }).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['mock', 'card']));
    expect(codes).not.toContain('orange_money');
  });

  it('le coeur peut accueillir un nouveau prestataire sans modification', () => {
    const extended = new ProviderRegistry([...createSandboxProviders(), new MockPaymentProvider({ code: 'wave', name: 'Wave', methods: ['MOBILE_MONEY'] })]);
    expect(extended.require('wave').name).toBe('Wave');
  });
});

import { randomBytes } from 'crypto';
import {
  CreateProviderPayment,
  PaymentProvider,
  ProviderMethod,
  ProviderOperationStatus,
  ProviderPaymentResult,
  ProviderPayoutInput,
  ProviderPayoutResult,
  ProviderRefundInput,
  ProviderRefundResult,
  ProviderTimeoutError,
} from '../payment-provider.interface';

export interface MockProviderConfig {
  code: string;
  name: string;
  methods: readonly ProviderMethod[];
}

/** Numeros de test (apres normalisation) et jetons de carte de test. */
const TEST_OUTCOMES: Record<string, 'SUCCESS' | 'FAILED' | 'PENDING' | 'TIMEOUT'> = {
  '70000001': 'SUCCESS',
  '70000002': 'FAILED',
  '70000003': 'PENDING',
  '70000004': 'TIMEOUT',
  tok_success: 'SUCCESS',
  tok_declined: 'FAILED',
  tok_pending: 'PENDING',
  tok_timeout: 'TIMEOUT',
};

/** Retire espaces, "+" et l'indicatif 226 pour comparer les numeros du Burkina Faso. */
export function normalizePayerRef(raw: string): string {
  const compact = raw.trim().replace(/[\s+-]/g, '');
  if (/^\d+$/.test(compact) && compact.length === 11 && compact.startsWith('226')) return compact.slice(3);
  return compact;
}

/** Masque un numero : 70****01. */
export function maskPayerRef(raw: string): string {
  const v = normalizePayerRef(raw);
  return v.length <= 4 ? '****' : `${v.slice(0, 2)}${'*'.repeat(v.length - 4)}${v.slice(-2)}`;
}

/**
 * Prestataire SIMULE : aucun appel reseau, aucun fonds reel.
 * Le meme adapter sert de base aux prestataires nommes (orange_money, moov_money...) tant qu'ils ne sont pas reels.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly sandbox = true;
  readonly code: string;
  readonly name: string;
  readonly methods: readonly ProviderMethod[];

  constructor(config: MockProviderConfig) {
    this.code = config.code;
    this.name = config.name;
    this.methods = config.methods;
  }

  async createPayment(input: CreateProviderPayment): Promise<ProviderPaymentResult> {
    const outcome = TEST_OUTCOMES[normalizePayerRef(input.payerRef)] ?? 'SUCCESS';
    if (outcome === 'TIMEOUT') throw new ProviderTimeoutError();

    const providerRef = `mock_${outcome.toLowerCase()}_${randomBytes(6).toString('hex')}`;
    const failed = outcome === 'FAILED';
    return {
      providerRef,
      status: outcome,
      errorCode: failed ? 'insufficient_funds' : undefined,
      errorMessage: failed ? 'Solde insuffisant (simulation)' : undefined,
      raw: { simulated: true, provider: this.code, outcome, reference: input.paymentId },
    };
  }

  async verifyPayment(providerRef: string): Promise<ProviderPaymentResult> {
    const status = await this.getPaymentStatus(providerRef);
    return { providerRef, status, raw: { simulated: true, provider: this.code } };
  }

  async getPaymentStatus(providerRef: string): Promise<ProviderOperationStatus> {
    const match = /^mock_(success|failed|pending)_/.exec(providerRef);
    return match ? (match[1].toUpperCase() as ProviderOperationStatus) : 'FAILED';
  }

  async refundPayment(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    return {
      providerRefundRef: `mock_refund_${randomBytes(6).toString('hex')}`,
      status: 'SUCCESS',
      raw: { simulated: true, provider: this.code, amount: input.amount },
    };
  }

  async payout(input: ProviderPayoutInput): Promise<ProviderPayoutResult> {
    return {
      providerPayoutRef: `mock_payout_${randomBytes(6).toString('hex')}`,
      status: 'SUCCESS',
      raw: { simulated: true, provider: this.code, amount: input.amount },
    };
  }
}

/** Prestataires simules disponibles dans le sandbox. Les vrais adapters s'ajouteront ici. */
export function createSandboxProviders(): PaymentProvider[] {
  return [
    new MockPaymentProvider({ code: 'mock', name: 'Mock (tous moyens)', methods: ['MOBILE_MONEY', 'CARD'] }),
    new MockPaymentProvider({ code: 'orange_money', name: 'Orange Money (simule)', methods: ['MOBILE_MONEY'] }),
    new MockPaymentProvider({ code: 'moov_money', name: 'Moov Money (simule)', methods: ['MOBILE_MONEY'] }),
    new MockPaymentProvider({ code: 'telecel_money', name: 'Telecel Money (simule)', methods: ['MOBILE_MONEY'] }),
    new MockPaymentProvider({ code: 'card', name: 'Carte bancaire (simulee)', methods: ['CARD'] }),
  ];
}

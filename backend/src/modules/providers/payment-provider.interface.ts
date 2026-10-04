/**
 * Contrat que tout prestataire de paiement doit respecter.
 * Le coeur de PayBF ne depend que de cette interface : ajouter Orange Money, Moov, Telecel ou une carte
 * revient a ecrire un adapter et a l'enregistrer, sans modifier les paiements, remboursements ou webhooks.
 */

export type ProviderMethod = 'MOBILE_MONEY' | 'CARD';
export type ProviderOperationStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

export interface CreateProviderPayment {
  paymentId: string;
  amount: number;
  currency: string;
  methodType: ProviderMethod;
  /** Numero Mobile Money ou jeton de carte. Jamais de PIN, de mot de passe ni de numero de carte complet. */
  payerRef: string;
  description?: string;
}

export interface ProviderPaymentResult {
  providerRef: string;
  status: ProviderOperationStatus;
  errorCode?: string;
  errorMessage?: string;
  /** Reponse brute (deja nettoyee) du prestataire, conservee pour les Developer Logs. */
  raw: Record<string, unknown>;
}

export interface ProviderRefundInput {
  providerRef: string;
  amount: number;
  reason?: string;
}

export interface ProviderRefundResult {
  providerRefundRef: string;
  status: ProviderOperationStatus;
  errorCode?: string;
  raw: Record<string, unknown>;
}

export interface ProviderPayoutInput {
  amount: number;
  currency: string;
  destination: string;
}

export interface ProviderPayoutResult {
  providerPayoutRef: string;
  status: ProviderOperationStatus;
  errorCode?: string;
  raw: Record<string, unknown>;
}

/** Le prestataire n'a pas repondu a temps : l'etat du paiement est inconnu, il ne faut PAS le marquer en echec. */
export class ProviderTimeoutError extends Error {
  constructor(message = 'Le prestataire de paiement n\'a pas repondu a temps') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export interface PaymentProvider {
  readonly code: string;
  readonly name: string;
  readonly methods: readonly ProviderMethod[];
  /** true tant que le prestataire est simule (aucun fonds reel). */
  readonly sandbox: boolean;

  createPayment(input: CreateProviderPayment): Promise<ProviderPaymentResult>;
  verifyPayment(providerRef: string): Promise<ProviderPaymentResult>;
  getPaymentStatus(providerRef: string): Promise<ProviderOperationStatus>;
  refundPayment(input: ProviderRefundInput): Promise<ProviderRefundResult>;
  payout(input: ProviderPayoutInput): Promise<ProviderPayoutResult>;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

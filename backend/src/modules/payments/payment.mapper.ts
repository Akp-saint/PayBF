/** Representation publique d'un paiement (snake_case). Les montants BigInt sont convertis en nombres. */

export interface PaymentRow {
  id: string;
  status: string;
  amount: bigint;
  currency: string;
  description: string | null;
  providerCode: string | null;
  methodType: string | null;
  successUrl: string | null;
  cancelUrl: string | null;
  metadata: unknown;
  expiresAt: Date | null;
  createdAt: Date;
  customer?: { id: string; name: string; email: string; phone: string | null } | null;
}

export interface PaymentResponse {
  id: string;
  object: 'payment';
  status: string;
  amount: number;
  currency: string;
  description: string | null;
  provider: string | null;
  payment_method: string | null;
  customer: { id: string; name: string; email: string; phone: string | null } | null;
  payment_url: string;
  success_url: string | null;
  cancel_url: string | null;
  metadata: unknown;
  expires_at: Date | null;
  created_at: Date;
}

export function toPaymentResponse(p: PaymentRow, checkoutBaseUrl: string): PaymentResponse {
  return {
    id: p.id,
    object: 'payment',
    status: p.status,
    amount: Number(p.amount),
    currency: p.currency,
    description: p.description,
    provider: p.providerCode,
    payment_method: p.methodType ? p.methodType.toLowerCase() : null,
    customer: p.customer
      ? { id: p.customer.id, name: p.customer.name, email: p.customer.email, phone: p.customer.phone }
      : null,
    payment_url: `${checkoutBaseUrl.replace(/\/+$/, '')}/pay/${p.id}`,
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    metadata: p.metadata ?? null,
    expires_at: p.expiresAt,
    created_at: p.createdAt,
  };
}

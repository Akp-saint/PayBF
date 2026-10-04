export type PaymentState =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/** Machine a etats stricte : toute autre transition est refusee. */
export const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  PENDING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  SUCCESS: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Etats depuis lesquels on peut atteindre `to` (sert de condition atomique en base). */
export function predecessorsOf(to: PaymentState): PaymentState[] {
  return (Object.keys(PAYMENT_TRANSITIONS) as PaymentState[]).filter((from) => canTransition(from, to));
}

export const isFinalState = (s: PaymentState): boolean => PAYMENT_TRANSITIONS[s].length === 0;

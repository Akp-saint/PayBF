import { canTransition, isFinalState, PAYMENT_TRANSITIONS, PaymentState, predecessorsOf } from './payment-state';

describe('machine a etats des paiements', () => {
  it('autorise PENDING vers les etats finaux', () => {
    for (const to of ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'] as PaymentState[]) {
      expect(canTransition('PENDING', to)).toBe(true);
    }
  });

  it('refuse les transitions interdites', () => {
    expect(canTransition('FAILED', 'SUCCESS')).toBe(false);
    expect(canTransition('CANCELLED', 'SUCCESS')).toBe(false);
    expect(canTransition('EXPIRED', 'SUCCESS')).toBe(false);
    expect(canTransition('SUCCESS', 'CANCELLED')).toBe(false);
    expect(canTransition('SUCCESS', 'PENDING')).toBe(false);
    expect(canTransition('REFUNDED', 'SUCCESS')).toBe(false);
  });

  it('un paiement reussi peut etre rembourse, partiellement puis totalement', () => {
    expect(canTransition('SUCCESS', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(canTransition('SUCCESS', 'REFUNDED')).toBe(true);
    expect(canTransition('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true);
  });

  it('predecessorsOf donne les etats de depart valides', () => {
    expect(predecessorsOf('SUCCESS')).toEqual(['PENDING']);
    expect(predecessorsOf('CANCELLED')).toEqual(['PENDING']);
    expect(predecessorsOf('PARTIALLY_REFUNDED').sort()).toEqual(['PARTIALLY_REFUNDED', 'SUCCESS']);
    expect(predecessorsOf('PENDING')).toEqual([]);
  });

  it('FAILED, CANCELLED, EXPIRED et REFUNDED sont finaux', () => {
    for (const s of ['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'] as PaymentState[]) {
      expect(isFinalState(s)).toBe(true);
    }
    expect(Object.keys(PAYMENT_TRANSITIONS)).toHaveLength(7);
  });
});

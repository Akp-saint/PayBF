import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentState, predecessorsOf } from './payment-state';

export interface TransitionExtra {
  providerCode?: string;
  methodType?: 'MOBILE_MONEY' | 'CARD';
}

/**
 * Point UNIQUE de changement d'etat d'un paiement.
 * La transition est atomique (UPDATE conditionnel sur l'etat precedent) : deux requetes simultanees
 * ne peuvent pas toutes les deux faire passer un paiement de PENDING a SUCCESS.
 * C'est aussi ici que les webhooks seront declenches (phase 6).
 */
@Injectable()
export class PaymentLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(paymentId: string, to: PaymentState, extra: TransitionExtra = {}) {
    const from = predecessorsOf(to);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: from } },
        data: { status: to, ...extra },
      });
      if (result.count === 0) {
        throw new ConflictException({
          code: 'invalid_payment_state',
          message: `Le paiement ne peut pas passer a l'etat ${to} depuis son etat actuel`,
        });
      }

      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { customer: true } });
      if (to === 'SUCCESS') {
        await tx.transaction.updateMany({
          where: { paymentId, kind: 'PAYMENT' },
          data: { status: 'SUCCESS', balanceEffect: payment.amount },
        });
      } else if (to === 'FAILED' || to === 'CANCELLED' || to === 'EXPIRED') {
        await tx.transaction.updateMany({
          where: { paymentId, kind: 'PAYMENT' },
          data: { status: 'FAILED', balanceEffect: 0n },
        });
      }
      return payment;
    });
  }

  /** Passe un paiement PENDING dont la date limite est depassee a EXPIRED. */
  async expireIfNeeded<T extends { id: string; status: string; expiresAt: Date | null }>(payment: T): Promise<T | null> {
    if (payment.status !== 'PENDING' || !payment.expiresAt || payment.expiresAt > new Date()) return null;
    try {
      return (await this.transition(payment.id, 'EXPIRED')) as unknown as T;
    } catch (error) {
      if (error instanceof ConflictException) return null; // deja traite par une autre requete
      throw error;
    }
  }
}

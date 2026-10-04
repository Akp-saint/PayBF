import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentLifecycleService } from './payment-lifecycle.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { maskPayerRef } from '../providers/mock/mock-payment.provider';
import { ProviderMethod, ProviderPaymentResult, ProviderTimeoutError } from '../providers/payment-provider.interface';
import type { CheckoutPayDto } from './dto/checkout.dto';

export interface CheckoutError {
  code: string;
  message: string;
}

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

/**
 * Page de paiement hebergee. Aucune cle API : l'identifiant du paiement (96 bits aleatoires) fait office de secret.
 * Les donnees exposees sont volontairement limitees (email masque, pas de metadata).
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly lifecycle: PaymentLifecycleService,
  ) {}

  async view(id: string, error: CheckoutError | null = null) {
    const payment = await this.load(id);
    return this.toView(payment, error);
  }

  async pay(id: string, dto: CheckoutPayDto) {
    const payment = await this.load(id);
    if (payment.status !== 'PENDING') {
      throw new ConflictException({ code: 'invalid_payment_state', message: 'Ce paiement n\'est plus en attente' });
    }

    const provider = this.registry.require(dto.provider);
    if (payment.providerCode && payment.providerCode !== provider.code) {
      throw new BadRequestException({
        code: 'provider_mismatch',
        message: `Ce paiement doit etre regle avec ${payment.providerCode}`,
      });
    }
    const methodType: ProviderMethod = (payment.methodType as ProviderMethod | null) ?? provider.methods[0];
    if (!provider.methods.includes(methodType)) {
      throw new BadRequestException({
        code: 'payment_method_not_supported',
        message: `Le prestataire ${provider.code} ne supporte pas ce moyen de paiement`,
      });
    }

    const requestLog = {
      amount: Number(payment.amount),
      currency: payment.currency,
      methodType,
      payer: maskPayerRef(dto.payer),
    };
    const startedAt = Date.now();
    let result: ProviderPaymentResult | null = null;
    let failure: CheckoutError | null = null;

    try {
      result = await provider.createPayment({
        paymentId: payment.id,
        amount: Number(payment.amount),
        currency: payment.currency,
        methodType,
        payerRef: dto.payer,
        description: payment.description ?? undefined,
      });
    } catch (error) {
      const timeout = error instanceof ProviderTimeoutError;
      this.logger.warn(`Erreur prestataire ${provider.code} sur ${payment.id} : ${(error as Error).message}`);
      failure = {
        code: timeout ? 'provider_timeout' : 'provider_error',
        message: timeout
          ? 'Le prestataire n\'a pas repondu. Verifiez votre telephone ou reessayez dans un instant.'
          : 'Le prestataire est momentanement indisponible.',
      };
    }

    await this.prisma.providerTransaction.create({
      data: {
        paymentId: payment.id,
        providerCode: provider.code,
        providerRef: result?.providerRef,
        rawStatus: result?.status ?? 'ERROR',
        requestLog: requestLog as Prisma.InputJsonValue,
        responseLog: (result?.raw ?? { error: failure?.code ?? null }) as Prisma.InputJsonValue,
        errorCode: result?.errorCode ?? failure?.code,
        latencyMs: Date.now() - startedAt,
      },
    });

    if (!result) {
      // Etat inconnu (timeout) : le paiement reste PENDING, on ne le declare surtout pas en echec.
      return this.toView(payment, failure);
    }

    await this.prisma.paymentMethod.create({
      data: {
        merchantId: payment.merchantId,
        customerId: payment.customerId,
        type: methodType,
        providerCode: provider.code,
        msisdnMasked: methodType === 'MOBILE_MONEY' ? maskPayerRef(dto.payer) : null,
      },
    });

    if (result.status === 'PENDING') {
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerCode: provider.code, methodType },
        include: { customer: true, merchant: { select: { name: true, logoUrl: true } } },
      });
      return this.toView(updated, null);
    }

    const settled = await this.lifecycle.transition(payment.id, result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED', {
      providerCode: provider.code,
      methodType,
    });
    const error =
      result.status === 'FAILED'
        ? { code: result.errorCode ?? 'payment_failed', message: result.errorMessage ?? 'Le paiement a echoue' }
        : null;
    return this.toView({ ...settled, merchant: payment.merchant }, error);
  }

  async cancel(id: string) {
    const payment = await this.load(id);
    const cancelled = await this.lifecycle.transition(id, 'CANCELLED');
    return this.toView({ ...cancelled, merchant: payment.merchant }, null);
  }

  private async load(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { customer: true, merchant: { select: { name: true, logoUrl: true } } },
    });
    if (!payment) throw new NotFoundException('Paiement introuvable');
    const expired = await this.lifecycle.expireIfNeeded(payment);
    return expired ? { ...expired, merchant: payment.merchant } : payment;
  }

  private toView(
    p: {
      id: string;
      status: string;
      amount: bigint;
      currency: string;
      description: string | null;
      providerCode: string | null;
      methodType: string | null;
      successUrl: string | null;
      cancelUrl: string | null;
      expiresAt: Date | null;
      customer?: { name: string; email: string } | null;
      merchant: { name: string; logoUrl: string | null };
    },
    error: CheckoutError | null,
  ) {
    const providers = this.registry
      .list({ method: (p.methodType as ProviderMethod | null) ?? undefined, code: p.providerCode })
      .map((x) => ({ code: x.code, name: x.name, payment_methods: x.methods.map((m) => m.toLowerCase()) }));

    const redirectUrl =
      p.status === 'SUCCESS'
        ? p.successUrl
        : p.status === 'FAILED' || p.status === 'CANCELLED' || p.status === 'EXPIRED'
          ? p.cancelUrl
          : null;

    return {
      id: p.id,
      status: p.status,
      amount: Number(p.amount),
      currency: p.currency,
      description: p.description,
      merchant: { name: p.merchant.name, logo_url: p.merchant.logoUrl },
      customer: p.customer ? { name: p.customer.name, email: maskEmail(p.customer.email) } : null,
      providers,
      expires_at: p.expiresAt,
      redirect_url: redirectUrl,
      sandbox: true,
      error,
    };
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { ApiKeyContext } from '../../common/api-key.types';
import { newId } from '../../common/ids';
import type { RequestContext } from '../../common/request-context';
import { sha256, stableStringify } from '../../common/stable-json';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ProviderRegistry } from '../providers/provider.registry';
import type { CreatePaymentDto, ListPaymentsQueryDto } from './dto/payment.dto';
import { PaymentLifecycleService } from './payment-lifecycle.service';
import { PaymentResponse, toPaymentResponse } from './payment.mapper';

const METHOD_MAP = { mobile_money: 'MOBILE_MONEY', card: 'CARD' } as const;
const PAYMENT_TTL_MS = 30 * 60 * 1000;
const IDEMPOTENCY_KEY_FORMAT = /^[A-Za-z0-9_\-:.]{1,255}$/;
const MAX_METADATA_BYTES = 2000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly idempotency: IdempotencyService,
    private readonly lifecycle: PaymentLifecycleService,
    private readonly audit: AuditService,
  ) {}

  private get checkoutBase(): string {
    return this.config.get<string>('CHECKOUT_BASE_URL') ?? 'http://localhost:3000';
  }

  async create(
    apiKey: ApiKeyContext,
    dto: CreatePaymentDto,
    idempotencyKeyHeader: string | undefined,
    ctx: RequestContext,
  ): Promise<{ payment: PaymentResponse; replayed: boolean }> {
    const idempotencyKey = this.parseIdempotencyKey(idempotencyKeyHeader);
    const methodType = dto.payment_method ? METHOD_MAP[dto.payment_method] : undefined;
    const provider = dto.provider ? this.registry.require(dto.provider) : undefined;
    if (provider && methodType && !provider.methods.includes(methodType)) {
      throw new BadRequestException({
        code: 'payment_method_not_supported',
        message: `Le prestataire ${provider.code} ne supporte pas ${dto.payment_method}`,
      });
    }
    if (dto.metadata && Buffer.byteLength(JSON.stringify(dto.metadata)) > MAX_METADATA_BYTES) {
      throw new BadRequestException({ code: 'metadata_too_large', message: 'metadata depasse 2 Ko' });
    }

    if (idempotencyKey) {
      const fingerprint = sha256(stableStringify({ route: 'POST /payments', body: dto }));
      const begin = await this.idempotency.begin(apiKey.merchantId, idempotencyKey, fingerprint);
      if (begin.replay) return { payment: begin.response as PaymentResponse, replayed: true };
    }

    let response: PaymentResponse;
    try {
      const row = await this.insertPayment(apiKey, dto, idempotencyKey, provider?.code, methodType);
      response = toPaymentResponse(row, this.checkoutBase);
    } catch (error) {
      if (idempotencyKey) await this.idempotency.abort(apiKey.merchantId, idempotencyKey);
      throw error;
    }

    // Si l'enregistrement du snapshot echoue, la cle reste IN_PROGRESS : un retry recoit 409 (jamais de doublon).
    if (idempotencyKey) await this.idempotency.complete(apiKey.merchantId, idempotencyKey, response);

    await this.audit.log({
      action: 'payment.create',
      actorType: 'api_key',
      actorId: apiKey.id,
      merchantId: apiKey.merchantId,
      resource: `payment:${response.id}`,
      context: ctx,
    });
    return { payment: response, replayed: false };
  }

  async get(apiKey: ApiKeyContext, id: string): Promise<PaymentResponse> {
    let payment = await this.prisma.payment.findFirst({
      where: { id, merchantId: apiKey.merchantId },
      include: { customer: true },
    });
    if (!payment) throw new NotFoundException('Paiement introuvable');
    payment = (await this.lifecycle.expireIfNeeded(payment)) ?? payment;
    return toPaymentResponse(payment, this.checkoutBase);
  }

  async list(apiKey: ApiKeyContext, query: ListPaymentsQueryDto) {
    const limit = query.limit ?? 20;
    const rows = await this.prisma.payment.findMany({
      where: { merchantId: apiKey.merchantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.starting_after ? { cursor: { id: query.starting_after }, skip: 1 } : {}),
      include: { customer: true },
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map((p) => toPaymentResponse(p, this.checkoutBase)),
      has_more: rows.length > limit,
    };
  }

  async cancel(apiKey: ApiKeyContext, id: string, ctx: RequestContext): Promise<PaymentResponse> {
    const existing = await this.prisma.payment.findFirst({ where: { id, merchantId: apiKey.merchantId } });
    if (!existing) throw new NotFoundException('Paiement introuvable');

    const payment = await this.lifecycle.transition(id, 'CANCELLED');
    await this.audit.log({
      action: 'payment.cancel',
      actorType: 'api_key',
      actorId: apiKey.id,
      merchantId: apiKey.merchantId,
      resource: `payment:${id}`,
      context: ctx,
    });
    return toPaymentResponse(payment, this.checkoutBase);
  }

  private parseIdempotencyKey(value: string | undefined): string | undefined {
    if (value === undefined || value === '') return undefined;
    if (!IDEMPOTENCY_KEY_FORMAT.test(value)) {
      throw new BadRequestException({
        code: 'invalid_idempotency_key',
        message: 'Idempotency-Key invalide (1 a 255 caracteres : lettres, chiffres, _ - : .)',
      });
    }
    return value;
  }

  private insertPayment(
    apiKey: ApiKeyContext,
    dto: CreatePaymentDto,
    idempotencyKey: string | undefined,
    providerCode: string | undefined,
    methodType: 'MOBILE_MONEY' | 'CARD' | undefined,
  ) {
    const id = newId('txn');
    const merchantId = apiKey.merchantId;
    return this.prisma.$transaction(async (tx) => {
      let customerId: string | undefined;
      if (dto.customer) {
        const customer = await tx.customer.upsert({
          where: { merchantId_email: { merchantId, email: dto.customer.email } },
          update: { name: dto.customer.name, phone: dto.customer.phone },
          create: {
            id: newId('cus'),
            merchantId,
            name: dto.customer.name,
            email: dto.customer.email,
            phone: dto.customer.phone,
          },
        });
        customerId = customer.id;
      }

      const payment = await tx.payment.create({
        data: {
          id,
          merchantId,
          applicationId: apiKey.applicationId,
          customerId,
          amount: BigInt(dto.amount),
          currency: dto.currency,
          description: dto.description,
          providerCode,
          methodType,
          successUrl: dto.success_url,
          cancelUrl: dto.cancel_url,
          idempotencyKey,
          metadata: dto.metadata as Prisma.InputJsonValue | undefined,
          expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
        },
        include: { customer: true },
      });
      await tx.transaction.create({
        data: { merchantId, paymentId: id, kind: 'PAYMENT', amount: BigInt(dto.amount), status: 'PENDING' },
      });
      return payment;
    });
  }
}

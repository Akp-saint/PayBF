import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyBegin = { replay: false } | { replay: true; response: unknown };

/**
 * Garantit qu'une meme Idempotency-Key ne cree qu'UNE seule operation.
 * La contrainte unique (merchantId, key) de PostgreSQL sert d'arbitre en cas de requetes simultanees.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async begin(merchantId: string, key: string, requestHash: string, attempt = 0): Promise<IdempotencyBegin> {
    try {
      await this.prisma.idempotencyRecord.create({ data: { merchantId, key, requestHash } });
      return { replay: false };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { merchantId_key: { merchantId, key } },
    });
    if (!existing) {
      if (attempt >= 2) throw new ConflictException({ code: 'request_in_progress', message: 'Requete en cours' });
      return this.begin(merchantId, key, requestHash, attempt + 1);
    }

    if (Date.now() - existing.createdAt.getTime() > IDEMPOTENCY_TTL_MS) {
      await this.prisma.idempotencyRecord.deleteMany({ where: { id: existing.id } });
      if (attempt >= 2) throw new ConflictException({ code: 'request_in_progress', message: 'Requete en cours' });
      return this.begin(merchantId, key, requestHash, attempt + 1);
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'idempotency_key_reuse',
        message: 'Cette Idempotency-Key a deja ete utilisee avec une requete differente',
      });
    }
    if (existing.status === 'COMPLETED') return { replay: true, response: existing.responseSnapshot };

    throw new ConflictException({
      code: 'request_in_progress',
      message: 'Une requete avec cette Idempotency-Key est deja en cours de traitement',
    });
  }

  async complete(merchantId: string, key: string, response: unknown): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { merchantId_key: { merchantId, key } },
      data: { status: 'COMPLETED', responseSnapshot: response as Prisma.InputJsonValue },
    });
  }

  /** Libere la cle quand l'operation a echoue : le client pourra reessayer avec la meme cle. */
  async abort(merchantId: string, key: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({ where: { merchantId, key, status: 'IN_PROGRESS' } });
  }
}

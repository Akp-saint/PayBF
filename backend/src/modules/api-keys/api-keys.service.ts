import { Injectable, NotFoundException } from '@nestjs/common';
import { ALL_API_SCOPES } from '../../common/api-scopes';
import { generateApiKey } from '../../common/api-key.util';
import type { AuthUser } from '../../common/auth.types';
import { requireMerchantId } from '../../common/merchant-scope';
import type { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateApiKeyDto } from './dto/api-key.dto';

/** Duree pendant laquelle l'ancienne cle reste valable apres une rotation. */
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

interface KeyRow {
  id: string;
  applicationId: string;
  type: 'SECRET' | 'PUBLISHABLE';
  environment: 'TEST' | 'LIVE';
  prefix: string;
  last4: string;
  permissions: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const toView = (k: KeyRow) => ({
  id: k.id,
  application_id: k.applicationId,
  type: k.type,
  environment: k.environment,
  masked_key: `${k.prefix}…${k.last4}`,
  permissions: k.permissions,
  last_used_at: k.lastUsedAt,
  revoked_at: k.revokedAt,
  created_at: k.createdAt,
});

const SELECT = {
  id: true,
  applicationId: true,
  type: true,
  environment: true,
  prefix: true,
  last4: true,
  permissions: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const keys = await this.prisma.apiKey.findMany({
      where: { merchantId: requireMerchantId(user) },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    });
    return { data: keys.map(toView) };
  }

  async create(user: AuthUser, dto: CreateApiKeyDto, ctx: RequestContext) {
    const merchantId = requireMerchantId(user);
    const application = await this.prisma.application.findFirst({
      where: { id: dto.applicationId, merchantId },
    });
    if (!application) throw new NotFoundException('Application introuvable');

    const permissions = dto.type === 'SECRET' ? (dto.permissions ?? [...ALL_API_SCOPES]) : [];
    const created = await this.persist(merchantId, application.id, dto.type, permissions);

    await this.audit.log({
      action: 'api_key.create',
      actorType: 'user',
      actorId: user.id,
      merchantId,
      resource: `api_key:${created.row.id}`,
      diff: { type: dto.type, permissions },
      context: ctx,
    });
    return { ...toView(created.row), secret: created.key };
  }

  /** Cree une nouvelle cle identique ; l'ancienne reste valable 24 h puis expire (rotation sans coupure). */
  async rotate(user: AuthUser, id: string, ctx: RequestContext) {
    const merchantId = requireMerchantId(user);
    const old = await this.prisma.apiKey.findFirst({ where: { id, merchantId } });
    if (!old || (old.revokedAt && old.revokedAt <= new Date())) throw new NotFoundException('Cle API introuvable');

    const created = await this.persist(merchantId, old.applicationId, old.type, old.permissions, old.id);
    const graceEnd = new Date(Date.now() + ROTATION_GRACE_MS);
    if (!old.revokedAt || old.revokedAt > graceEnd) {
      await this.prisma.apiKey.update({ where: { id: old.id }, data: { revokedAt: graceEnd } });
    }

    await this.audit.log({
      action: 'api_key.rotate',
      actorType: 'user',
      actorId: user.id,
      merchantId,
      resource: `api_key:${old.id}`,
      diff: { new_key_id: created.row.id, previous_key_expires_at: graceEnd.toISOString() },
      context: ctx,
    });
    return { ...toView(created.row), secret: created.key, previous_key_expires_at: graceEnd };
  }

  async revoke(user: AuthUser, id: string, ctx: RequestContext) {
    const merchantId = requireMerchantId(user);
    const key = await this.prisma.apiKey.findFirst({ where: { id, merchantId } });
    if (!key) throw new NotFoundException('Cle API introuvable');

    const now = new Date();
    if (!key.revokedAt || key.revokedAt > now) {
      await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: now } });
      await this.audit.log({
        action: 'api_key.revoke',
        actorType: 'user',
        actorId: user.id,
        merchantId,
        resource: `api_key:${id}`,
        context: ctx,
      });
    }
    return toView({ ...key, revokedAt: key.revokedAt && key.revokedAt <= now ? key.revokedAt : now });
  }

  private async persist(
    merchantId: string,
    applicationId: string,
    type: 'SECRET' | 'PUBLISHABLE',
    permissions: string[],
    rotatedFromId?: string,
  ): Promise<{ key: string; row: KeyRow }> {
    const generated = generateApiKey(type, 'TEST');
    const row = await this.prisma.apiKey.create({
      data: {
        merchantId,
        applicationId,
        type,
        environment: 'TEST',
        prefix: generated.prefix,
        hash: generated.hash,
        last4: generated.last4,
        permissions,
        rotatedFromId,
      },
      select: SELECT,
    });
    return { key: generated.key, row };
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_PUBLISHABLE_KEY, API_SCOPES_KEY } from './api-key.decorators';
import type { ApiKeyContext } from './api-key.types';
import { sha256 } from './stable-json';

const KEY_FORMAT = /^(sk|pk)_(test|live)_[A-Za-z0-9_-]{20,}$/;
const TOUCH_INTERVAL_MS = 60_000;

/** Authentifie les requetes de l'API publique via `Authorization: Bearer sk_test_...`. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { apiKey?: ApiKeyContext }>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token || !KEY_FORMAT.test(token)) {
      throw new UnauthorizedException('Cle API manquante ou mal formee');
    }

    const key = await this.prisma.apiKey.findUnique({
      where: { hash: sha256(token) },
      include: { merchant: { select: { status: true } } },
    });
    if (!key) throw new UnauthorizedException('Cle API invalide');

    const now = new Date();
    // revokedAt peut etre dans le futur : periode de grace apres une rotation.
    if (key.revokedAt && key.revokedAt <= now) throw new UnauthorizedException('Cle API revoquee');
    if (key.merchant.status !== 'ACTIVE') throw new ForbiddenException('Compte marchand suspendu');
    if (key.environment !== 'TEST') {
      throw new ForbiddenException('Seul l\'environnement sandbox (cles test) est disponible');
    }

    const targets = [context.getHandler(), context.getClass()];
    const allowPublishable = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_PUBLISHABLE_KEY, targets);
    if (key.type === 'PUBLISHABLE' && !allowPublishable) {
      throw new ForbiddenException('Cette route requiert une cle secrete (sk_...)');
    }
    const scopes = this.reflector.getAllAndOverride<string[] | undefined>(API_SCOPES_KEY, targets) ?? [];
    if (!scopes.every((s) => key.permissions.includes(s))) {
      throw new ForbiddenException('Permission insuffisante pour cette cle API');
    }

    req.apiKey = {
      id: key.id,
      merchantId: key.merchantId,
      applicationId: key.applicationId,
      environment: key.environment,
      type: key.type,
      permissions: key.permissions,
    };

    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      void this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } }).catch(() => undefined);
    }
    return true;
  }
}

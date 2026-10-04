import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actorType: 'user' | 'api_key' | 'system';
  actorId?: string | null;
  merchantId?: string | null;
  resource?: string;
  diff?: Record<string, unknown>;
  context?: RequestContext;
}

/** Journal d'audit en ajout seul. Une erreur d'ecriture ne doit jamais casser la requete metier. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          merchantId: entry.merchantId ?? null,
          resource: entry.resource,
          diff: entry.diff as Prisma.InputJsonValue | undefined,
          ip: entry.context?.ip,
          userAgent: entry.context?.userAgent,
          correlationId: entry.context?.correlationId,
        },
      });
    } catch (error) {
      this.logger.error(`Echec d'ecriture du journal d'audit (${entry.action})`, error as Error);
    }
  }
}

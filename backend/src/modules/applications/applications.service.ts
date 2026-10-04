import { Injectable, NotFoundException } from '@nestjs/common';
import { Application } from '@prisma/client';
import type { AuthUser } from '../../common/auth.types';
import { requireMerchantId } from '../../common/merchant-scope';
import type { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateApplicationDto } from './dto/application.dto';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Toutes les requetes sont filtrees par le merchantId du jeton : isolation multi-marchands. */
  async list(user: AuthUser): Promise<Application[]> {
    return this.prisma.application.findMany({
      where: { merchantId: requireMerchantId(user) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string): Promise<Application> {
    const application = await this.prisma.application.findFirst({
      where: { id, merchantId: requireMerchantId(user) },
    });
    if (!application) throw new NotFoundException('Application introuvable');
    return application;
  }

  async create(user: AuthUser, dto: CreateApplicationDto, ctx: RequestContext): Promise<Application> {
    const merchantId = requireMerchantId(user);
    const application = await this.prisma.application.create({
      data: { merchantId, name: dto.name, environment: 'TEST' },
    });
    await this.audit.log({
      action: 'application.create',
      actorType: 'user',
      actorId: user.id,
      merchantId,
      resource: `application:${application.id}`,
      context: ctx,
    });
    return application;
  }
}

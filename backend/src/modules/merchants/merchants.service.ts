import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth.types';
import { requireMerchantId } from '../../common/merchant-scope';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(user: AuthUser) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: requireMerchantId(user) },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        status: true,
        planTier: true,
        kycStatus: true,
        createdAt: true,
      },
    });
    if (!merchant) throw new NotFoundException('Marchand introuvable');
    return merchant;
  }
}

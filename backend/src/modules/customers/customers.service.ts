import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiKeyContext } from '../../common/api-key.types';
import { newId } from '../../common/ids';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateCustomerDto } from './dto/customer.dto';

const toResponse = (c: { id: string; name: string; email: string; phone: string | null; createdAt: Date }) => ({
  id: c.id,
  object: 'customer' as const,
  name: c.name,
  email: c.email,
  phone: c.phone,
  created_at: c.createdAt,
});

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(apiKey: ApiKeyContext, dto: CreateCustomerDto) {
    try {
      const customer = await this.prisma.customer.create({
        data: { id: newId('cus'), merchantId: apiKey.merchantId, name: dto.name, email: dto.email, phone: dto.phone },
      });
      return toResponse(customer);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'customer_exists', message: 'Un client existe deja avec cet email' });
      }
      throw error;
    }
  }

  async get(apiKey: ApiKeyContext, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, merchantId: apiKey.merchantId } });
    if (!customer) throw new NotFoundException('Client introuvable');
    return toResponse(customer);
  }
}

import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentApiKey, RequireScopes } from '../../common/api-key.decorators';
import { ApiKeyGuard } from '../../common/api-key.guard';
import type { ApiKeyContext } from '../../common/api-key.types';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { getRequestContext } from '../../common/request-context';
import { CreatePaymentDto, ListPaymentsQueryDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @RequireScopes('payments:write')
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Meme cle = une seule transaction' })
  async create(
    @CurrentApiKey() apiKey: ApiKeyContext,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { payment, replayed } = await this.payments.create(apiKey, dto, idempotencyKey, getRequestContext(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return payment;
  }

  @Get()
  @RequireScopes('payments:read')
  list(@CurrentApiKey() apiKey: ApiKeyContext, @Query() query: ListPaymentsQueryDto) {
    return this.payments.list(apiKey, query);
  }

  @Get(':id')
  @RequireScopes('payments:read')
  get(@CurrentApiKey() apiKey: ApiKeyContext, @Param('id') id: string) {
    return this.payments.get(apiKey, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequireScopes('payments:write')
  cancel(@CurrentApiKey() apiKey: ApiKeyContext, @Param('id') id: string, @Req() req: Request) {
    return this.payments.cancel(apiKey, id, getRequestContext(req));
  }
}

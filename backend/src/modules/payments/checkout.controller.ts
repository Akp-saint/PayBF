import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit, RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { CheckoutService } from './checkout.service';
import { CheckoutPayDto } from './dto/checkout.dto';

/** Routes publiques utilisees par la page /pay/:id. Limitees par adresse IP. */
@ApiTags('checkout')
@UseGuards(RateLimitGuard)
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get(':id')
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'ip', name: 'checkout-view' })
  view(@Param('id') id: string) {
    return this.checkout.view(id);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 60, by: 'ip', name: 'checkout-pay' })
  pay(@Param('id') id: string, @Body() dto: CheckoutPayDto) {
    return this.checkout.pay(id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 60, by: 'ip', name: 'checkout-cancel' })
  cancel(@Param('id') id: string) {
    return this.checkout.cancel(id);
  }
}

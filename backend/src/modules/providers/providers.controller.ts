import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowPublishableKey } from '../../common/api-key.decorators';
import { ApiKeyGuard } from '../../common/api-key.guard';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { ProviderRegistry } from './provider.registry';

@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ApiKeyGuard, RateLimitGuard)
@Controller('providers')
export class ProvidersController {
  constructor(private readonly registry: ProviderRegistry) {}

  @Get()
  @AllowPublishableKey()
  list() {
    return {
      data: this.registry.list().map((p) => ({
        code: p.code,
        name: p.name,
        payment_methods: p.methods.map((m) => m.toLowerCase()),
        sandbox: p.sandbox,
      })),
    };
  }
}

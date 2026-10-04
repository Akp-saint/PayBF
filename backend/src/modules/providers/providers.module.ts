import { Module } from '@nestjs/common';
import { createSandboxProviders } from './mock/mock-payment.provider';
import { PAYMENT_PROVIDERS } from './payment-provider.interface';
import { ProviderRegistry } from './provider.registry';
import { ProvidersController } from './providers.controller';

@Module({
  controllers: [ProvidersController],
  providers: [{ provide: PAYMENT_PROVIDERS, useFactory: createSandboxProviders }, ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}

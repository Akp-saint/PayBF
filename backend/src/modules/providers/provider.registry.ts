import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PAYMENT_PROVIDERS, PaymentProvider, ProviderMethod } from './payment-provider.interface';

/** Pattern Strategy : resout le prestataire a utiliser a partir de son code. */
@Injectable()
export class ProviderRegistry {
  private readonly byCode = new Map<string, PaymentProvider>();

  constructor(@Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[]) {
    for (const provider of providers) this.byCode.set(provider.code, provider);
  }

  get(code: string): PaymentProvider | undefined {
    return this.byCode.get(code);
  }

  require(code: string): PaymentProvider {
    const provider = this.byCode.get(code);
    if (!provider) {
      throw new BadRequestException({
        code: 'provider_not_supported',
        message: `Prestataire inconnu : "${code}"`,
      });
    }
    return provider;
  }

  list(filter?: { method?: ProviderMethod; code?: string | null }): PaymentProvider[] {
    return [...this.byCode.values()].filter(
      (p) => (!filter?.method || p.methods.includes(filter.method)) && (!filter?.code || p.code === filter.code),
    );
  }
}

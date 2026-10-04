import { Global, Module } from '@nestjs/common';
import { ApiKeyGuard } from '../api-key.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimiter } from './rate-limiter.service';

/** Global : fournit le limiteur et les guards de l'API publique a tous les modules. */
@Global()
@Module({
  providers: [RateLimiter, RateLimitGuard, ApiKeyGuard],
  exports: [RateLimiter, RateLimitGuard, ApiKeyGuard],
})
export class RateLimitModule {}

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
// Ordre des modules : les modules globaux (Prisma, Redis, RateLimit, Audit, Idempotency, Auth) d'abord.
import { ConfigModule } from '@nestjs/config';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { RedisModule } from './common/redis.module';
import { validateEnv } from './config/env.validation';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HealthModule } from './modules/health/health.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    RedisModule,
    RateLimitModule,
    AuditModule,
    IdempotencyModule,
    AuthModule,
    MerchantsModule,
    ApplicationsModule,
    ApiKeysModule,
    ProvidersModule,
    CustomersModule,
    PaymentsModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}

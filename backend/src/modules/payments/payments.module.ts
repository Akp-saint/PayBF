import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PaymentLifecycleService } from './payment-lifecycle.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ProvidersModule],
  controllers: [PaymentsController, CheckoutController],
  providers: [PaymentsService, CheckoutService, PaymentLifecycleService],
  exports: [PaymentsService, PaymentLifecycleService],
})
export class PaymentsModule {}

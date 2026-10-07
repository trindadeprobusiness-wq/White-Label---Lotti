import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutRepo } from './checkout.repo';
import { CheckoutService } from './checkout.service';
import { CheckoutTokenGuard } from './checkout-token.guard';

/**
 * Checkout do site institucional (servidor a servidor). UsuariosRepo vem do AuthModule (mesma
 * criação de conta do cadastro); PrismaService do PrismaModule global; ENV do EnvModule global.
 */
@Module({
  imports: [AuthModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, CheckoutRepo, CheckoutTokenGuard],
})
export class CheckoutModule {}

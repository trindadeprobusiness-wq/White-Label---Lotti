import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AssinaturaController } from './assinatura.controller';
import { AssinaturaService } from './assinatura.service';
import { CatalogoController } from './catalogo.controller';
import { CatalogoRepo } from './catalogo.repo';
import { CatalogoService } from './catalogo.service';
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';

@Module({
  imports: [PrismaModule],
  controllers: [CatalogoController, AssinaturaController, OnboardingController],
  providers: [AssinaturaService, CatalogoService, CatalogoRepo, OnboardingService, SupabaseAuthGuard],
})
export class AssinaturaModule {}

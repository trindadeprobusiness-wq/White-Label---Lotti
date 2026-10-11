import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CentralComercialController } from './central-comercial.controller';
import { CentralComercialService } from './central-comercial.service';

@Module({ controllers: [CentralComercialController], providers: [CentralComercialService, SupabaseAuthGuard] })
export class CentralComercialModule {}

import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { RotinaComandoService } from './comando/rotina-comando.service';
import { RotinaGooglePublicoController } from './google/rotina-google-publico.controller';
import { RotinaGoogleController } from './google/rotina-google.controller';
import { RotinaGoogleRepo } from './google/rotina-google.repo';
import { RotinaGoogleService } from './google/rotina-google.service';
import { RotinaMaintainJob } from './google/rotina-maintain.job';
import { RotinaController } from './rotina.controller';
import { RotinaService } from './rotina.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [RotinaController, RotinaGoogleController, RotinaGooglePublicoController],
  providers: [RotinaService, RotinaGoogleRepo, RotinaGoogleService, RotinaComandoService, RotinaMaintainJob, SupabaseAuthGuard],
})
export class RotinaModule {}

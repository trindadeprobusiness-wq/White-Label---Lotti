import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { UsuariosRepo } from './usuarios.repo';

/**
 * Login próprio da API (saída gradual do Supabase Auth). O PrismaService vem do
 * PrismaModule (@Global) e o ENV do EnvModule (@Global). O guard duplo também é
 * exportado para quem precisar reaproveitar a instância.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, UsuariosRepo, SupabaseAuthGuard],
  exports: [SupabaseAuthGuard],
})
export class AuthModule {}

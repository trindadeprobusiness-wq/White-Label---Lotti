import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { UsuariosRepo } from './usuarios.repo';

/**
 * Login próprio da API (saída gradual do Supabase Auth) e o perfil de quem está logado
 * (/api/perfil). O PrismaService e o TenantDb vêm do PrismaModule (@Global) e o ENV do
 * EnvModule (@Global). O guard duplo também é exportado para quem precisar reaproveitar
 * a instância.
 */
@Module({
  controllers: [AuthController, PerfilController],
  providers: [AuthService, UsuariosRepo, PerfilService, SupabaseAuthGuard],
  // UsuariosRepo: o checkout do site cria a conta e o link de senha pelo mesmo código do cadastro.
  exports: [SupabaseAuthGuard, UsuariosRepo],
})
export class AuthModule {}

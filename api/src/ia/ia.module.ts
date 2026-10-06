import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AcaoIaService } from './acao.service';
import { AnexosIaService } from './anexos.service';
import { AssistenteService } from './assistente.service';
import { ConversasService } from './conversas.service';
import { FerramentasIaService } from './ferramentas.service';
import { FotosIaService } from './fotos.service';
import { IaConversasController } from './ia-conversas.controller';
import { IaController } from './ia.controller';
import { MensagensIaService } from './mensagens.service';

// Porte das Edge Functions de IA (ai-assistant, ai-action, ai-process-file, analisar-foto,
// analisar-fotos-imovel, generate-whatsapp-message, inbox-suggest). TenantDb/PrismaService vêm do
// PrismaModule global e StorageService do StorageModule global.
@Module({
  controllers: [IaConversasController, IaController],
  providers: [
    ConversasService,
    FerramentasIaService,
    AssistenteService,
    AcaoIaService,
    AnexosIaService,
    FotosIaService,
    MensagensIaService,
    SupabaseAuthGuard,
  ],
})
export class IaModule {}

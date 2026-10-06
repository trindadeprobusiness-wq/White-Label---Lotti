import { Module } from '@nestjs/common';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappRuntimeController } from './whatsapp-runtime.controller';
import { WhatsappService } from './whatsapp.service';
@Module({controllers:[WhatsappController,WhatsappRuntimeController],providers:[WhatsappService,SupabaseAuthGuard,AgentTokenGuard]})
export class WhatsappModule{}


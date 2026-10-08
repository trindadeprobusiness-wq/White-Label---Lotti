import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { BridgeDto, CampanhaDto, ConfiguracoesDto, ContatoDto, ControleCampanhaDto, EmpresaDto, MesclarDto, ModoDto, ReconciliarDto, StatusDto } from './whatsapp.dto';
import { filtroStatusConversa, WhatsappService } from './whatsapp.service';

const UUID=new ParseUUIDPipe();
@Controller('whatsapp')
@UseGuards(SupabaseAuthGuard)
export class WhatsappController {
 constructor(private readonly w:WhatsappService){}
 @Post('bridge') bridge(@Claims()c:SupabaseClaims,@Body()b:BridgeDto){return this.w.ponte(c,b);}
 @Get('conversas') conversas(@Claims()c:SupabaseClaims,@Query('status')s?:string){return this.w.listarConversas(c,filtroStatusConversa(s));}
 @Get('conversas/contagem') contagem(@Claims()c:SupabaseClaims){return this.w.contarConversas(c);}
 @Get('mensagens/ultimas') ultimas(@Claims()c:SupabaseClaims){return this.w.ultimasMensagens(c);}
 @Get('conversas/:id/mensagens') mensagens(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string){return this.w.mensagens(c,id);}
 @Get('conversas/:id/eventos') eventos(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string){return this.w.eventos(c,id);}
 @Patch('conversas/:id/modo') modo(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string,@Body()b:ModoDto){return this.w.modo(c,id,b.mode);}
 @Post('conversas/:id/reconciliar') reconciliar(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string,@Body()b:ReconciliarDto){return this.w.reconciliar(c,id,b.chegou);}
 @Post('conversas/:id/limpar-opt-out') limpar(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string){return this.w.limparOptOut(c,id);}
 @Patch('conversas/:id/contato') contato(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string,@Body()b:ContatoDto){return this.w.atualizarContato(c,id,b.name,b.phone);}
 @Post('conversas/mesclar') mesclar(@Claims()c:SupabaseClaims,@Body()b:MesclarDto){return this.w.mesclar(c,b.keep,b.drop);}
 @Patch('conversas/:id/status') status(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string,@Body()b:StatusDto){return this.w.status(c,id,b.status);}
 @Get('canal') canal(@Claims()c:SupabaseClaims,@Query('phone')p:string){return this.w.canal(c,p);}
 @Patch('canal/empresa') empresa(@Claims()c:SupabaseClaims,@Query('phone')p:string,@Body()b:EmpresaDto){return this.w.empresa(c,p,b.name);}
 @Get('configuracoes') configuracoes(@Claims()c:SupabaseClaims){return this.w.configuracoes(c);}
 @Put('configuracoes') salvarConfiguracoes(@Claims()c:SupabaseClaims,@Body()b:ConfiguracoesDto){return this.w.salvarConfiguracoes(c,b.settings);}
 @Get('broadcasts') broadcasts(@Claims()c:SupabaseClaims){return this.w.listarCampanhas(c);}
 @Get('broadcasts/automacao') automacao(@Claims()c:SupabaseClaims){return this.w.automacaoOnline(c).then(online=>({online}));}
 @Get('broadcasts/:id') broadcast(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string){return this.w.campanha(c,id);}
 @Post('broadcasts/salvar') salvar(@Claims()c:SupabaseClaims,@Body()b:CampanhaDto){return this.w.salvarCampanha(c,b.campaign);}
 @Post('broadcasts/preview') preview(@Claims()c:SupabaseClaims,@Body()b:CampanhaDto){return this.w.previewCampanha(c,b.campaign);}
 @Post('broadcasts/:id/ativar') ativar(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string){return this.w.ativarCampanha(c,id);}
 @Post('broadcasts/:id/controlar') controlar(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string,@Body()b:ControleCampanhaDto){return this.w.controlarCampanha(c,id,b.action);}
 @Post('broadcasts/:id/duplicar') duplicar(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string){return this.w.duplicarCampanha(c,id);}
 @Delete('broadcasts/:id') apagar(@Claims()c:SupabaseClaims,@Param('id',UUID)id:string){return this.w.apagarRascunho(c,id);}
 @Get('esperando') esperando(@Claims()c:SupabaseClaims){return this.w.esperando(c);}
}

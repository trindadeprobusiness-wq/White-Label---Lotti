import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { FachadasMidiasService, Midias } from './fachadas-midias.service';
import { ID } from './fachadas.controller';

@Controller('fachadas/midias')
@UseGuards(SupabaseAuthGuard)
export class FachadasMidiasController {
  constructor(private readonly midias: FachadasMidiasService) {}

  @Get(':imovelId')
  obter(@Claims() claims: SupabaseClaims, @Param('imovelId', ID) imovelId: string): Promise<Midias> {
    return this.midias.obter(claims, imovelId);
  }
}

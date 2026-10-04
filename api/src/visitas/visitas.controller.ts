import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { VisitasService } from './visitas.service';

@Controller('visitas')
@UseGuards(SupabaseAuthGuard)
export class VisitasController {
  constructor(private readonly visitas: VisitasService) {}

  @Post(':visitaId/confirmar')
  confirmar(@Claims() claims: SupabaseClaims, @Param('visitaId', ParseUUIDPipe) visitaId: string) {
    return this.visitas.confirmar(claims, visitaId);
  }
}

import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { ConviteService } from './convite/convite.service';
import { ConviteSemProvedor, PORTA_CONVITE } from './convite/porta-convite';
import { DiagnosticoPublicoController } from './diagnostico/diagnostico-publico.controller';
import { DiagnosticoRepo } from './diagnostico/diagnostico.repo';
import { DiagnosticoService } from './diagnostico/diagnostico.service';
import { ParceirosController } from './parceiros.controller';
import { PortalService } from './portal/portal.service';
import { ParceirosPublicoController } from './publico/parceiros-publico.controller';
import { ParceirosPublicoRepo } from './publico/parceiros-publico.repo';
import { ParceirosPublicoService } from './publico/parceiros-publico.service';

@Module({
  imports: [PrismaModule],
  controllers: [ParceirosPublicoController, DiagnosticoPublicoController, ParceirosController, AdminController],
  providers: [
    SupabaseAuthGuard,
    ParceirosPublicoRepo,
    ParceirosPublicoService,
    DiagnosticoRepo,
    DiagnosticoService,
    PortalService,
    ConviteService,
    AdminService,
    { provide: PORTA_CONVITE, useClass: ConviteSemProvedor },
  ],
})
export class ParceirosModule {}

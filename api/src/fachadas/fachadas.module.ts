import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { FachadasLeadsController } from './fachadas-leads.controller';
import { FachadasLeadsService } from './fachadas-leads.service';
import { FachadasMetricasController } from './fachadas-metricas.controller';
import { FachadasMetricasService } from './fachadas-metricas.service';
import { FachadasMidiasController } from './fachadas-midias.controller';
import { FachadasMidiasService } from './fachadas-midias.service';
import { FachadasTemplatesController } from './fachadas-templates.controller';
import { FachadasTemplatesService } from './fachadas-templates.service';
import { FachadasController } from './fachadas.controller';
import { FachadasService } from './fachadas.service';
import { FachadasPublicoController } from './publico/fachadas-publico.controller';
import { FachadasPublicoRepo } from './publico/fachadas-publico.repo';
import { FachadasPublicoService } from './publico/fachadas-publico.service';

// TenantDb e PrismaService vêm do PrismaModule global.
// ORDEM DOS CAMINHOS (contrato §1.1): fachadas/leads, /metricas, /templates e /midias colidem com
// a rota de id de fachadas, e o Nest casa na ordem de registro — que é a ordem deste array.
// FachadasController, o único com rota de id, fica por ÚLTIMO.
@Module({
  controllers: [FachadasLeadsController, FachadasMetricasController, FachadasTemplatesController,
    FachadasMidiasController, FachadasPublicoController, FachadasController],
  providers: [SupabaseAuthGuard, FachadasService, FachadasLeadsService, FachadasMetricasService,
    FachadasTemplatesService, FachadasMidiasService, FachadasPublicoService, FachadasPublicoRepo],
})
export class FachadasModule {}

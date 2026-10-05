import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { MetricasDto } from './fachadas.dto';
import { rodar } from './fachadas.service';

export const DIAS_PADRAO = 30;

export interface DiaMetrica {
  data: string;
  leads: number;
  escaneamentos: number;
}

/** O mesmo objeto FachadaMetricas de src/types/fachada.ts, montado no servidor. */
export interface Metricas {
  totalFachadas: number;
  totalEscaneamentos: number;
  totalLeads: number;
  taxaConversao: number;
  fachadasMaisAcessadas: never[];
  leadsPorDia: DiaMetrica[];
}

interface LinhaAgregada {
  total_fachadas: number;
  total_leads: number;
  total_escaneamentos: number;
  leads_por_dia: DiaMetrica[];
}

@Injectable()
export class FachadasMetricasService {
  constructor(private readonly db: TenantDb) {}

  /**
   * F7: uma consulta só, no mesmo run. Sem limit porque não há lista — são agregações, e é por isso
   * que esta rota corrige o corte silencioso de 1000 linhas do PostgREST (contrato §6.8).
   */
  async obter(claims: SupabaseClaims, q: MetricasDto): Promise<Metricas> {
    const dias = q.dias ?? DIAS_PADRAO;
    const linhas = await rodar(this.db, claims, (tx) => tx.$queryRaw<LinhaAgregada[]>(Prisma.sql`
      with janela as (select (now() - make_interval(days => ${dias}::int)) as inicio),
       ativas as (select count(*)::int as n from public.fachadas where ativo = true),
       eventos as (
         select (l.created_at at time zone 'UTC')::date as dia, 1 as leads, 0 as scans
           from public.fachada_leads l, janela j where l.created_at >= j.inicio
         union all
         select (s.created_at at time zone 'UTC')::date, 0, 1
           from public.fachada_escaneamentos s, janela j where s.created_at >= j.inicio),
       dias as (select dia, sum(leads)::int as leads, sum(scans)::int as escaneamentos
                  from eventos group by dia)
      select (select n from ativas) as total_fachadas,
             coalesce((select sum(leads)::int from dias), 0) as total_leads,
             coalesce((select sum(escaneamentos)::int from dias), 0) as total_escaneamentos,
             coalesce((select jsonb_agg(jsonb_build_object('data', to_char(dia, 'YYYY-MM-DD'),
                       'leads', leads, 'escaneamentos', escaneamentos) order by dia) from dias), '[]'::jsonb) as leads_por_dia`));
    const r = linhas[0];
    const totalEscaneamentos = Number(r.total_escaneamentos);
    const totalLeads = Number(r.total_leads);
    return {
      totalFachadas: Number(r.total_fachadas),
      totalEscaneamentos,
      totalLeads,
      // A mesma conta de hoje (useFachadas.ts), agora no servidor.
      taxaConversao: totalEscaneamentos > 0 ? Math.round((totalLeads / totalEscaneamentos) * 100) : 0,
      // Hoje é [] fixo e o dashboard já lida com isso; preencher mudaria tela que ninguém pediu (§7.1.1).
      fachadasMaisAcessadas: [],
      leadsPorDia: r.leads_por_dia ?? [],
    };
  }
}

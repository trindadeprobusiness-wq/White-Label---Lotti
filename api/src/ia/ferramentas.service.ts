import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { AcaoInvalida, validarProposta } from './acoes';
import type { ClienteSql } from './cotas';
import { argUuid, filtroNumero, filtroTexto, limiteEntre, termoDeBusca } from './ferramentas';
import { codigoDe } from './ia.erros';
import type { RefEntidade } from './pedido';

type Tx = Prisma.TransactionClient;
type Linha = Record<string, unknown>;

export interface ContextoFerramenta {
  claims: SupabaseClaims;
  runId: string | null;
  corretorId: string;
  userId: string;
  entityRefs: RefEntidade[];
}

const linhas = (r: Array<{ linha: Linha }>) => r.map((l) => l.linha);

/** 'YYYY-MM-01' do mês, do trimestre ou do ano corrente, em UTC (a Edge Function rodava em UTC). */
export function inicioDoPeriodo(periodo: string, agora = new Date()): string {
  const ano = agora.getUTCFullYear();
  if (periodo === 'year') return `${ano}-01-01`;
  const mes = periodo === 'quarter' ? Math.floor(agora.getUTCMonth() / 3) * 3 : agora.getUTCMonth();
  return `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
}

/**
 * Ferramentas do Assistente. As de leitura rodam no TenantDb com as claims de quem conversa (o mesmo
 * RLS do cliente com o token do usuário na Edge Function), cada uma num run próprio: um erro do banco
 * aborta só aquela consulta e volta para o modelo como { error }, sem derrubar a conversa.
 * suggest_action só GRAVA a proposta (ai_action_proposals é do service_role): a escrita de verdade
 * acontece no POST /api/ia/acao, depois da confirmação.
 */
@Injectable()
export class FerramentasIaService {
  private readonly log = new Logger('IaFerramentas');

  constructor(private readonly db: TenantDb, private readonly prisma: PrismaService) {}

  async executar(nome: string, args: Record<string, unknown>, ctx: ContextoFerramenta): Promise<string> {
    if (nome === 'suggest_action') return this.proporAcao(args, ctx);
    const consulta = CONSULTAS[nome];
    if (!consulta) return JSON.stringify({ error: `Unknown tool: ${nome}` });
    try {
      return JSON.stringify(await this.db.run(ctx.claims, (tx) => consulta(tx, args)));
    } catch (e) {
      this.log.warn(`ferramenta ${nome} falhou ${codigoDe(e)}`);
      return JSON.stringify({ error: 'query_failed' });
    }
  }

  private async proporAcao(args: Record<string, unknown>, ctx: ContextoFerramenta): Promise<string> {
    let proposta;
    try {
      proposta = validarProposta(args);
    } catch (e) {
      if (!(e instanceof AcaoInvalida)) throw e;
      return JSON.stringify({
        error: 'invalid_action_schema',
        message: 'A proposta não passou na validação e não pode ser executada.',
      });
    }
    const id = randomUUID();
    const preview = { action_type: proposta.action_type, description: proposta.description, fields: Object.keys(proposta.params) };
    try {
      await (this.prisma as unknown as ClienteSql).$executeRaw(Prisma.sql`
        insert into public.ai_action_proposals (id, run_id, corretor_id, user_id, action_type, entity_refs, preview, payload, idempotency_key)
        values (${id}::uuid, ${ctx.runId}::uuid, ${ctx.corretorId}::uuid, ${ctx.userId}::uuid, ${proposta.action_type}::text,
          ${JSON.stringify(ctx.entityRefs)}::jsonb, ${JSON.stringify(preview)}::jsonb, ${JSON.stringify(proposta)}::jsonb,
          ${randomUUID()}::text)`);
    } catch (e) {
      this.log.warn(`proposta de ação não gravada ${codigoDe(e)}`);
      return JSON.stringify({
        error: 'action_persistence_unavailable',
        message: 'A ação não pôde ser preparada com segurança. Tente novamente.',
      });
    }
    return JSON.stringify({
      type: 'action',
      action: { id, action_type: proposta.action_type, params: proposta.params, description: proposta.description, status: 'pending' },
    });
  }
}

type Consulta = (tx: Tx, args: Record<string, unknown>) => Promise<unknown>;

/** Porte de executeTool: mesmas colunas, filtros, ordem e tetos do PostgREST (desc = nulls first). */
export const CONSULTAS: Record<string, Consulta> = {
  async search_clients(tx, args) {
    const busca = termoDeBusca(args.query);
    const padrao = `%${busca}%`;
    const status = filtroTexto(args.status_funil);
    const interesse = filtroTexto(args.tipo_interesse);
    return linhas(await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email,
        'status_funil', c.status_funil, 'tipo_interesse', c.tipo_interesse, 'ultimo_contato', c.ultimo_contato,
        'proximo_followup', c.proximo_followup) as linha
      from public.clientes c
      where (${busca}::text = '' or c.nome ilike ${padrao}::text or c.email ilike ${padrao}::text or c.telefone ilike ${padrao}::text)
        and (${status}::text is null or c.status_funil::text = ${status}::text)
        and (${interesse}::text is null or c.tipo_interesse::text = ${interesse}::text)
      order by c.created_at desc nulls first, c.id
      limit ${limiteEntre(args.limit, 10, 25)}::int`));
  },

  async get_client_details(tx, args) {
    const id = argUuid(args, 'client_id');
    if (!id) return { error: 'invalid_client_id' };
    const cliente = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select to_jsonb(c) as linha from public.clientes c where c.id = ${id}::uuid limit 1`);
    const historico = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select to_jsonb(h) as linha from public.historico_contatos h where h.cliente_id = ${id}::uuid
      order by h.data_contato desc, h.id limit 10`);
    return { client: cliente[0]?.linha ?? null, history: linhas(historico) };
  },

  async search_properties(tx, args) {
    const busca = termoDeBusca(args.query);
    const padrao = `%${busca}%`;
    const tipo = filtroTexto(args.tipo);
    const cidade = filtroTexto(args.cidade);
    const min = filtroNumero(args.preco_min);
    const max = filtroNumero(args.preco_max);
    return linhas(await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select jsonb_build_object('id', i.id, 'titulo', i.titulo, 'tipo', i.tipo, 'valor', i.valor, 'area_m2', i.area_m2,
        'dormitorios', i.dormitorios, 'garagem', i.garagem, 'endereco', i.endereco, 'bairro', i.bairro, 'cidade', i.cidade) as linha
      from public.imoveis i
      where (${busca}::text = '' or i.titulo ilike ${padrao}::text or i.endereco ilike ${padrao}::text)
        and (${tipo}::text is null or i.tipo::text = ${tipo}::text)
        and (${cidade === null ? null : `%${cidade}%`}::text is null or i.cidade ilike ${cidade === null ? null : `%${cidade}%`}::text)
        and (${min}::numeric is null or i.valor >= ${min}::numeric)
        and (${max}::numeric is null or i.valor <= ${max}::numeric)
      order by i.created_at desc nulls first, i.id
      limit ${limiteEntre(args.limit, 10, 25)}::int`));
  },

  async get_property_details(tx, args) {
    const id = argUuid(args, 'property_id');
    if (!id) return { error: 'invalid_property_id' };
    const imovel = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select to_jsonb(i) as linha from public.imoveis i where i.id = ${id}::uuid limit 1`);
    const fotos = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select jsonb_build_object('arquivo_url', f.arquivo_url, 'principal', f.principal, 'ordem', f.ordem) as linha
      from public.imovel_fotos f where f.imovel_id = ${id}::uuid order by f.ordem asc nulls last, f.id`);
    return { property: imovel[0]?.linha ?? null, photos: linhas(fotos) };
  },

  async get_financial_summary(tx, args) {
    const period = (args.period as string) || 'month';
    const [r] = await tx.$queryRaw<Array<{ receita: number; despesa: number; total: number }>>(Prisma.sql`
      select coalesce(sum(l.valor) filter (where l.tipo = 'RECEITA'), 0)::float8 as receita,
        coalesce(sum(l.valor) filter (where l.tipo = 'DESPESA'), 0)::float8 as despesa,
        count(*)::int as total
      from public.lancamentos_financeiros l where l.data >= ${inicioDoPeriodo(period)}::timestamptz`);
    return { period, receita: r.receita, despesa: r.despesa, saldo: r.receita - r.despesa, total_lancamentos: r.total };
  },

  async get_financial_entries(tx, args) {
    const tipo = filtroTexto(args.tipo);
    const categoria = filtroTexto(args.categoria);
    const de = filtroTexto(args.date_from);
    const ate = filtroTexto(args.date_to);
    return linhas(await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select to_jsonb(l) as linha from public.lancamentos_financeiros l
      where (${tipo}::text is null or l.tipo = ${tipo}::text)
        and (${categoria}::text is null or l.categoria = ${categoria}::text)
        and (${de}::timestamptz is null or l.data >= ${de}::timestamptz)
        and (${ate}::timestamptz is null or l.data <= ${ate}::timestamptz)
      order by l.data desc, l.id
      limit ${limiteEntre(args.limit, 20, 1000)}::int`));
  },

  async get_contracts(tx, args) {
    const status = filtroTexto(args.status);
    const tipo = filtroTexto(args.tipo);
    const cliente = filtroTexto(args.client_id);
    return linhas(await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select jsonb_build_object('id', c.id, 'tipo', c.tipo, 'cliente_id', c.cliente_id, 'imovel_id', c.imovel_id,
        'valor', c.valor, 'data_inicio', c.data_inicio, 'prazo_meses', c.prazo_meses, 'status', c.status,
        'created_at', c.created_at) as linha
      from public.contratos c
      where (${status}::text is null or c.status = ${status}::text)
        and (${tipo}::text is null or c.tipo::text = ${tipo}::text)
        and (${cliente}::text is null or c.cliente_id::text = ${cliente}::text)
      order by c.created_at desc nulls first, c.id
      limit 10`));
  },

  async get_alerts(tx, args) {
    const tipo = filtroTexto(args.tipo);
    // alertas não tem coluna prioridade: a ação create_alert a guarda em metadata.
    const prioridade = filtroTexto(args.prioridade);
    return linhas(await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select to_jsonb(a) as linha from public.alertas a
      where a.lido = false
        and (${tipo}::text is null or a.tipo::text = ${tipo}::text)
        and (${prioridade}::text is null or a.metadata->>'prioridade' = ${prioridade}::text)
      order by a.created_at desc, a.id
      limit 20`));
  },

  async get_funnel_stats(tx) {
    const grupos = await tx.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
      select c.status_funil::text as status, count(*)::int as n from public.clientes c group by 1 order by 1`);
    const porStatus: Record<string, number> = {};
    let total = 0;
    for (const g of grupos) {
      porStatus[g.status] = g.n;
      total += g.n;
    }
    return { total, by_status: porStatus };
  },

  async get_contact_history(tx, args) {
    const id = argUuid(args, 'client_id');
    if (!id) return { error: 'invalid_client_id' };
    return linhas(await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select to_jsonb(h) as linha from public.historico_contatos h where h.cliente_id = ${id}::uuid
      order by h.data_contato desc, h.id limit 20`));
  },
};


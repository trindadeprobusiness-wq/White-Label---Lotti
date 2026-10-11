import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { AcaoInvalida, validarProposta } from './acoes';
import type { ClienteSql } from './cotas';
import { argUuid, filtroNumero, filtroTexto, limiteEntre, palavrasDeBusca, telefoneDaBusca, tiposDeContrato } from './ferramentas';
import { codigoDe } from './ia.erros';
import { diaBr, diaNoFuso, diaValido, FUSO_PADRAO, fusoValido, periodoDaTela, somarDias } from './periodo';
import type { RefEntidade } from './pedido';
import {
  CATEGORIA_FINANCEIRA, FINALIDADE, INTERESSE, PRIORIDADE, rotulo, SITUACAO_IMOVEL, STATUS_CLIENTE, TIPO_ALERTA,
  TIPO_CONTRATO, TIPO_ETAPA, TIPO_IMOVEL, TIPO_LANCAMENTO,
} from './rotulos';

type Tx = Prisma.TransactionClient;
type Linha = Record<string, unknown>;

export interface ContextoFerramenta {
  claims: SupabaseClaims;
  runId: string | null;
  corretorId: string;
  userId: string;
  entityRefs: RefEntidade[];
  /** Instante do pedido e fuso de quem conversa; sem eles, o relógio e São Paulo. */
  agora?: Date;
  fuso?: string;
}

/** "Hoje" e o fuso de quem conversa: as telas contam por dia do calendário local. */
export interface Relogio {
  agora: Date;
  fuso: string;
  hoje: string;
}

/** Registro que apareceu numa resposta: o modelo usa o ID no turno seguinte sem mostrá-lo no texto. */
export interface RegistroCitado {
  tipo: 'cliente' | 'imovel' | 'contrato';
  id: string;
  nome: string;
  telefone_final?: string;
}

const linhas = (r: Array<{ linha: Linha }>) => r.map((l) => l.linha);
const semVazios = (o: Linha): Linha => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== false));

/**
 * Lançamentos guardam só a data (00:00 UTC), e a tela Financeiro filtra pelo dia: [de 00:00 UTC, ate+1 00:00 UTC).
 * A mesma conta que /api/financeiro/lancamentos, com o mesmo filtro de dono (corretor_id = get_corretor_id()).
 */
function filtroDeDias(de: string | null, ate: string | null): Prisma.Sql {
  return Prisma.sql`l.corretor_id = public.get_corretor_id()
    and (${de}::date is null or l.data >= (${de}::date)::timestamp at time zone 'UTC')
    and (${ate}::date is null or l.data < (${ate}::date + 1)::timestamp at time zone 'UTC')`;
}

/** Cada palavra precisa aparecer em algum dos campos; palavra que é número de telefone compara só os dígitos. */
function buscaPorPalavras(palavras: string[], campos: Prisma.Sql[], telefone?: Prisma.Sql): Prisma.Sql {
  if (!palavras.length) return Prisma.sql`true`;
  return Prisma.join(palavras.map((p) => {
    const digitos = p.replace(/[^0-9]/g, '');
    if (telefone && digitos.length >= 4 && /^[0-9().+\-]+$/.test(p)) {
      return Prisma.sql`regexp_replace(coalesce(${telefone}, ''), '[^0-9]', '', 'g') like ${`%${digitos}%`}::text`;
    }
    return Prisma.sql`(${Prisma.join(campos.map((c) => Prisma.sql`${c} ilike ${`%${p}%`}::text`), ' or ')})`;
  }), ' and ');
}

const finalDoTelefone = (t: unknown) => (typeof t === 'string' ? t.replace(/[^0-9]/g, '').slice(-4) : '');

/** IDs que a resposta mencionou, para o turno seguinte (ex.: "agenda um follow-up para ela"). */
export function registrosCitados(nome: string, resultado: unknown): RegistroCitado[] {
  const r = (resultado ?? {}) as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? (v as Linha[]) : []);
  const cliente = (c: Linha | undefined, id = c?.id): RegistroCitado[] =>
    c && typeof id === 'string' && typeof c.nome === 'string'
      ? [{ tipo: 'cliente', id, nome: c.nome, ...(finalDoTelefone(c.telefone) ? { telefone_final: finalDoTelefone(c.telefone) } : {}) }]
      : [];
  const imovel = (i: Linha | undefined): RegistroCitado[] =>
    i && typeof i.id === 'string' && typeof i.titulo === 'string' ? [{ tipo: 'imovel', id: i.id, nome: i.titulo }] : [];
  switch (nome) {
    case 'search_clients': return lista(r.clientes).flatMap((c) => cliente(c));
    case 'get_client_details': return cliente(r.cliente as Linha | undefined);
    case 'search_properties': return lista(r.imoveis).flatMap(imovel);
    case 'get_property_details': return imovel(r.imovel as Linha | undefined);
    case 'get_contracts': return lista(r.contratos).flatMap((c) => [
      ...(typeof c.id === 'string' ? [{ tipo: 'contrato' as const, id: c.id, nome: [c.tipo, c.cliente, c.imovel].filter(Boolean).join(' · ') }] : []),
      ...cliente({ nome: c.cliente } as Linha, c.cliente_id),
    ]);
    case 'get_funnel_stats': return lista((r.etapa as Linha | undefined)?.negocios).flatMap((n) => cliente({ nome: n.cliente } as Linha, n.cliente_id));
    default: return [];
  }
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

  /** `permitidas`: as ferramentas que o modo ofereceu ao modelo; outra chamada não roda. */
  async executar(nome: string, args: Record<string, unknown>, ctx: ContextoFerramenta, permitidas?: readonly string[]): Promise<string> {
    if (permitidas && !permitidas.includes(nome)) return JSON.stringify({ error: 'tool_not_available' });
    if (nome === 'suggest_action') return this.proporAcao(args, ctx);
    const consulta = CONSULTAS[nome];
    if (!consulta) return JSON.stringify({ error: `Unknown tool: ${nome}` });
    const fuso = fusoValido(ctx.fuso);
    const agora = ctx.agora ?? new Date();
    const relogio: Relogio = { agora, fuso, hoje: diaNoFuso(agora, fuso) };
    try {
      return JSON.stringify(await this.db.run(ctx.claims, (tx) => consulta(tx, args, relogio)));
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
      // O campo que falhou vai junto: o modelo diz o que faltou ou veio errado, em vez de inventar a causa.
      return JSON.stringify({
        error: 'invalid_action_schema',
        campo: e.campo,
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
    // O cartão mostra para quem é a ação: o nome do cliente, nunca o ID (lido com o RLS de quem conversa).
    const clienteId = argUuid(proposta.params as Record<string, unknown>, 'client_id');
    let cliente: string | undefined;
    if (clienteId) {
      try {
        const [c] = await this.db.run(ctx.claims, (tx) => tx.$queryRaw<Array<{ nome: string }>>(Prisma.sql`
          select c.nome from public.clientes c where c.id = ${clienteId}::uuid limit 1`));
        cliente = c?.nome;
      } catch (e) {
        this.log.warn(`nome do cliente da proposta não lido ${codigoDe(e)}`);
      }
    }
    return JSON.stringify({
      type: 'action',
      action: {
        id, action_type: proposta.action_type, params: proposta.params, description: proposta.description, status: 'pending',
        ...(cliente ? { cliente_nome: cliente } : {}),
      },
    });
  }
}

type Consulta = (tx: Tx, args: Record<string, unknown>, r: Relogio) => Promise<unknown>;

/** Consultas de leitura. Rótulos prontos, datas já no fuso (dd/mm/aaaa) e envelope { total, mostrando, ... }. */
export const CONSULTAS: Record<string, Consulta> = {
  /**
   * Sem retorno = aba "Sem retorno" da tela Clientes. Follow-up = os follow-ups marcados de "Próximos contatos" da
   * tela Início (sem perdidos e sem demonstração); com followup_ate, só os que vencem até aquele dia.
   */
  async search_clients(tx, args, r) {
    const status = filtroTexto(args.status_funil);
    const interesse = filtroTexto(args.tipo_interesse);
    const ordem = args.ordem === 'sem_contato' || args.ordem === 'proximo_followup' ? args.ordem : 'recentes';
    const dias = limiteEntre(args.sem_contato_dias ?? 30, 30, 3650);
    const temAte = ordem === 'proximo_followup' && args.followup_ate !== undefined && args.followup_ate !== null && args.followup_ate !== '';
    const followupAte = temAte ? diaValido(args.followup_ate) : null;
    if (temAte && !followupAte) return { error: 'invalid_date', message: 'followup_ate no formato AAAA-MM-DD.' };
    // Número colado inteiro ("+55 62 99999-0001") vira uma busca só pelos dígitos, sem o 55 do país.
    const telefone = telefoneDaBusca(args.query);
    const busca = telefone
      ? Prisma.sql`regexp_replace(coalesce(c.telefone, ''), '[^0-9]', '', 'g') like ${`%${telefone}%`}::text`
      : buscaPorPalavras(palavrasDeBusca(args.query), [Prisma.sql`c.nome`, Prisma.sql`c.email`, Prisma.sql`c.telefone`], Prisma.sql`c.telefone`);
    const filtroOrdem = ordem === 'sem_contato'
      ? Prisma.sql`and c.status_funil::text not in ('FECHADO_GANHO', 'FECHADO_PERDIDO') and c.ultimo_contato is not null
          and c.ultimo_contato < ${r.agora.toISOString()}::timestamptz - (${dias}::int * interval '1 day')`
      : ordem === 'proximo_followup'
        ? Prisma.sql`and c.status_funil::text <> 'FECHADO_PERDIDO' and c.proximo_followup is not null and not c.is_sample_data
            and (${followupAte}::date is null or (c.proximo_followup at time zone ${r.fuso}::text)::date <= ${followupAte}::date)`
        : Prisma.empty;
    const ordenacao = ordem === 'sem_contato'
      ? Prisma.sql`c.ultimo_contato asc, c.id`
      : ordem === 'proximo_followup'
        ? Prisma.sql`c.proximo_followup asc nulls last, c.ultimo_contato asc nulls first, c.id`
        : Prisma.sql`c.created_at desc nulls first, c.id`;
    const rows = await tx.$queryRaw<Array<{ linha: Linha; total: number; demonstracao: number }>>(Prisma.sql`
      select jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email,
        'status', c.status_funil::text, 'interesse', c.tipo_interesse::text,
        'ultimo_contato', to_char(c.ultimo_contato at time zone ${r.fuso}::text, 'DD/MM/YYYY'),
        'dias_sem_contato', ${r.hoje}::date - (c.ultimo_contato at time zone ${r.fuso}::text)::date,
        'proximo_followup', to_char(c.proximo_followup at time zone ${r.fuso}::text, 'DD/MM/YYYY'),
        'followup_atrasado', (c.proximo_followup at time zone ${r.fuso}::text)::date < ${r.hoje}::date,
        'etapa_funil', (select e.nome from public.crm_oportunidades o join public.crm_etapas e on e.id = o.etapa_id
          where o.cliente_id = c.id and e.ativo order by o.updated_at desc, o.id limit 1),
        'demonstracao', c.is_sample_data) as linha,
        count(*) over ()::int as total,
        (count(*) filter (where c.is_sample_data) over ())::int as demonstracao
      from public.clientes c
      where ${busca}
        and (${status}::text is null or c.status_funil::text = ${status}::text)
        and (${interesse}::text is null or c.tipo_interesse::text = ${interesse}::text)
        ${filtroOrdem}
      order by ${ordenacao}
      limit ${limiteEntre(args.limit, 10, 50)}::int`);
    const clientes = rows.map(({ linha }) => semVazios({
      ...linha, status: rotulo(STATUS_CLIENTE, linha.status), interesse: rotulo(INTERESSE, linha.interesse),
    }));
    return {
      total: rows[0]?.total ?? 0,
      mostrando: clientes.length,
      ...(rows[0]?.demonstracao ? { demonstracao: rows[0].demonstracao } : {}),
      // A aba Sem retorno corta fixo em 30 dias: com outro corte, o número não é o da aba.
      ...(ordem === 'sem_contato'
        ? { criterio: `mais de ${dias} dias sem contato, sem os fechados${dias === 30 ? ' (aba Sem retorno da tela Clientes)' : ''}` }
        : {}),
      ...(ordem === 'proximo_followup'
        ? { criterio: `follow-ups marcados, sem os perdidos e sem demonstração${followupAte ? `, até ${diaBr(followupAte)}` : ''}` }
        : {}),
      clientes,
    };
  },

  async get_client_details(tx, args, r) {
    const id = argUuid(args, 'client_id');
    if (!id) return { error: 'invalid_client_id' };
    const [c] = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'email', c.email,
        'status', c.status_funil::text, 'interesse', c.tipo_interesse::text, 'profissao', c.profissao,
        'estado_civil', c.estado_civil, 'endereco', c.endereco_completo, 'observacoes', c.observacoes,
        'ultimo_contato', to_char(c.ultimo_contato at time zone ${r.fuso}::text, 'DD/MM/YYYY'),
        'proximo_followup', to_char(c.proximo_followup at time zone ${r.fuso}::text, 'DD/MM/YYYY'),
        'cadastrado_em', to_char(c.created_at at time zone ${r.fuso}::text, 'DD/MM/YYYY'),
        'demonstracao', c.is_sample_data) as linha
      from public.clientes c where c.id = ${id}::uuid limit 1`);
    if (!c) return { cliente: null, negocios: [], contatos: [] };
    const negocios = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
      select jsonb_build_object('titulo', o.titulo, 'etapa', e.nome, 'situacao', e.tipo, 'valor', o.valor_estimado,
        'imovel', i.titulo) as linha
      from public.crm_oportunidades o join public.crm_etapas e on e.id = o.etapa_id
      left join public.imoveis i on i.id = o.imovel_id
      where o.cliente_id = ${id}::uuid
      order by o.updated_at desc, o.id limit 5`);
    return {
      cliente: semVazios({ ...c.linha, status: rotulo(STATUS_CLIENTE, c.linha.status), interesse: rotulo(INTERESSE, c.linha.interesse) }),
      negocios: linhas(negocios).map((n) => semVazios({ ...n, situacao: rotulo(TIPO_ETAPA, n.situacao) })),
      contatos: await ultimosContatos(tx, id, 10, r),
    };
  },

  async search_properties(tx, args, r) {
    const tipo = filtroTexto(args.tipo);
    const finalidade = args.finalidade === 'VENDA' || args.finalidade === 'LOCACAO' ? args.finalidade : null;
    const situacao = typeof args.situacao === 'string' && args.situacao in SITUACAO_IMOVEL ? args.situacao : null;
    const cidade = filtroTexto(args.cidade);
    const min = filtroNumero(args.preco_min);
    const max = filtroNumero(args.preco_max);
    const busca = buscaPorPalavras(palavrasDeBusca(args.query), [Prisma.sql`i.titulo`, Prisma.sql`i.endereco`, Prisma.sql`i.bairro`]);
    const rows = await tx.$queryRaw<Array<{ linha: Linha; total: number; demonstracao: number }>>(Prisma.sql`
      select jsonb_build_object('id', i.id, 'titulo', i.titulo, 'tipo', i.tipo::text, 'finalidade', i.finalidade::text,
        'situacao', i.status_venda::text, 'inativo', i.ativo is false, 'anunciado', i.anunciado, 'valor', i.valor,
        'area_m2', i.area_m2, 'dormitorios', i.dormitorios, 'garagem', i.garagem, 'endereco', i.endereco, 'bairro', i.bairro,
        'cidade', i.cidade, 'links_anuncio', i.links_anuncio,
        'pagina_lotti', (select 'https://app.plataformalotti.com.br/p/' || f.id from public.fachadas f
          where f.imovel_id = i.id and f.ativo order by f.created_at desc limit 1),
        'demonstracao', i.is_sample_data) as linha,
        count(*) over ()::int as total,
        (count(*) filter (where i.is_sample_data) over ())::int as demonstracao
      from public.imoveis i
      where ${busca}
        and (${tipo}::text is null or i.tipo::text = ${tipo}::text)
        and (${finalidade}::text is null or i.finalidade::text in (${finalidade}::text, 'AMBOS'))
        and (${args.disponivel === true}::boolean is false or (i.status_venda::text = 'DISPONIVEL' and i.ativo is not false))
        and (${situacao}::text is null or i.status_venda::text = ${situacao}::text)
        and (${cidade === null ? null : `%${cidade}%`}::text is null or i.cidade ilike ${cidade === null ? null : `%${cidade}%`}::text)
        and (${min}::numeric is null or i.valor >= ${min}::numeric)
        and (${max}::numeric is null or i.valor <= ${max}::numeric)
      order by i.created_at desc nulls first, i.id
      limit ${limiteEntre(args.limit, 10, 50)}::int`);
    const imoveis = rows.map(({ linha }) => {
      const links = Array.isArray(linha.links_anuncio) && linha.links_anuncio.length ? linha.links_anuncio : null;
      return semVazios({
        ...linha, links_anuncio: links, tipo: rotulo(TIPO_IMOVEL, linha.tipo), finalidade: rotulo(FINALIDADE, linha.finalidade),
        situacao: rotulo(SITUACAO_IMOVEL, linha.situacao),
      });
    });
    return {
      total: rows[0]?.total ?? 0,
      mostrando: imoveis.length,
      ...(rows[0]?.demonstracao ? { demonstracao: rows[0].demonstracao } : {}),
      imoveis,
    };
  },

  /** Mesmos nomes de search_properties (situacao, inativo, demonstracao); sem IDs de outras tabelas nem colunas técnicas. */
  async get_property_details(tx, args, r) {
    const id = argUuid(args, 'property_id');
    if (!id) return { error: 'invalid_property_id' };
    const [i] = await tx.$queryRaw<Array<{ linha: Linha; fotos: number }>>(Prisma.sql`
      select jsonb_build_object('id', i.id, 'titulo', i.titulo, 'tipo', i.tipo::text, 'finalidade', i.finalidade::text,
        'situacao', i.status_venda::text, 'inativo', i.ativo is false, 'anunciado', i.anunciado is true, 'valor', i.valor,
        'area_m2', i.area_m2, 'dormitorios', i.dormitorios, 'suites', i.suites, 'banheiros', i.banheiros, 'garagem', i.garagem,
        'endereco', i.endereco, 'bairro', i.bairro, 'cidade', i.cidade, 'estado', i.estado, 'cep', i.cep,
        'descricao', i.descricao, 'descricao_curta', i.descricao_curta,
        'exclusividade_ate', to_char(i.exclusividade_ate, 'DD/MM/YYYY'),
        'proprietario_nome', i.proprietario_nome, 'proprietario_telefone', i.proprietario_telefone,
        'proprietario_email', i.proprietario_email, 'proprietario_cpf', i.proprietario_cpf,
        'links_anuncio', i.links_anuncio,
        'cadastrado_em', to_char(i.created_at at time zone ${r.fuso}::text, 'DD/MM/YYYY'),
        'pagina_lotti', (select 'https://app.plataformalotti.com.br/p/' || f.id from public.fachadas f
          where f.imovel_id = i.id and f.ativo order by f.created_at desc limit 1),
        'demonstracao', i.is_sample_data) as linha,
        (select count(*)::int from public.imovel_fotos f where f.imovel_id = i.id) as fotos
      from public.imoveis i where i.id = ${id}::uuid limit 1`);
    if (!i) return { imovel: null };
    const l = i.linha;
    const links = Array.isArray(l.links_anuncio) && l.links_anuncio.length ? l.links_anuncio : null;
    return {
      imovel: {
        ...semVazios({
          ...l, links_anuncio: links, tipo: rotulo(TIPO_IMOVEL, l.tipo), finalidade: rotulo(FINALIDADE, l.finalidade),
          situacao: rotulo(SITUACAO_IMOVEL, l.situacao),
        }),
        // "Não anunciado" também é informação: não some como os outros false.
        anunciado: l.anunciado === true,
      },
      fotos: i.fotos,
    };
  },

  /** Os números dos cartões da tela Financeiro (Receitas, Despesas, Lucro) no período pedido. */
  async get_financial_summary(tx, args, r) {
    let { de, ate } = periodoDaTela(args.period, r.hoje);
    if (args.date_from !== undefined || args.date_to !== undefined) {
      const inicio = diaValido(args.date_from);
      const fim = args.date_to === undefined || args.date_to === null || args.date_to === '' ? r.hoje : diaValido(args.date_to);
      if (!inicio || !fim || fim < inicio) return { error: 'invalid_period', message: 'Mande date_from e date_to válidos (AAAA-MM-DD), com date_to depois de date_from.' };
      de = inicio;
      ate = fim;
    }
    const amanha = somarDias(r.hoje, 1);
    const [t] = await tx.$queryRaw<Array<{ receita: number; despesa: number; saldo: number; total: number;
      receita_ate_hoje: number; despesa_ate_hoje: number; saldo_ate_hoje: number }>>(Prisma.sql`
      with l as (select l.tipo, l.valor, l.data from public.lancamentos_financeiros l where ${filtroDeDias(de, ate)}),
      s as (
        select coalesce(sum(valor) filter (where tipo = 'RECEITA'), 0) as receita,
          coalesce(sum(valor) filter (where tipo = 'DESPESA'), 0) as despesa,
          coalesce(sum(valor) filter (where tipo = 'RECEITA' and data < (${amanha}::date)::timestamp at time zone 'UTC'), 0) as receita_ate_hoje,
          coalesce(sum(valor) filter (where tipo = 'DESPESA' and data < (${amanha}::date)::timestamp at time zone 'UTC'), 0) as despesa_ate_hoje,
          count(*)::int as total
        from l)
      select receita::float8 as receita, despesa::float8 as despesa, (receita - despesa)::float8 as saldo, total,
        receita_ate_hoje::float8 as receita_ate_hoje, despesa_ate_hoje::float8 as despesa_ate_hoje,
        (receita_ate_hoje - despesa_ate_hoje)::float8 as saldo_ate_hoje
      from s`);
    const periodo = { de: diaBr(de), ate: diaBr(ate) };
    const base = {
      periodo, consultado_em: diaBr(r.hoje),
      receitas: t.receita, despesas: t.despesa, saldo: t.saldo, total_lancamentos: t.total,
    };
    // Período que ainda não terminou: a tela soma também o que tem data futura (recorrentes já gerados).
    if (ate < r.hoje || de > r.hoje) return base;
    return {
      ...base,
      lancado_ate_hoje: { receitas: t.receita_ate_hoje, despesas: t.despesa_ate_hoje, saldo: t.saldo_ate_hoje },
      previsto_depois_de_hoje: {
        receitas: Math.round((t.receita - t.receita_ate_hoje) * 100) / 100,
        despesas: Math.round((t.despesa - t.despesa_ate_hoje) * 100) / 100,
      },
    };
  },

  async get_financial_entries(tx, args, r) {
    const tipo = filtroTexto(args.tipo);
    const categoria = filtroTexto(args.categoria);
    const temDe = args.date_from !== undefined && args.date_from !== null && args.date_from !== '';
    const temAte = args.date_to !== undefined && args.date_to !== null && args.date_to !== '';
    const de = temDe ? diaValido(args.date_from) : null;
    const ate = temAte ? diaValido(args.date_to) : null;
    if ((temDe && !de) || (temAte && !ate)) return { error: 'invalid_date', message: 'Datas no formato AAAA-MM-DD.' };
    const amanha = somarDias(r.hoje, 1);
    const rows = await tx.$queryRaw<Array<{ linha: Linha; total: number; receitas: number; despesas: number }>>(Prisma.sql`
      select jsonb_build_object('data', to_char(l.data at time zone 'UTC', 'DD/MM/YYYY'), 'tipo', l.tipo, 'categoria', l.categoria,
        'descricao', l.descricao, 'valor', l.valor, 'recorrente', l.recorrente,
        'futuro', l.data >= (${amanha}::date)::timestamp at time zone 'UTC') as linha,
        count(*) over ()::int as total,
        (coalesce(sum(l.valor) filter (where l.tipo = 'RECEITA') over (), 0))::float8 as receitas,
        (coalesce(sum(l.valor) filter (where l.tipo = 'DESPESA') over (), 0))::float8 as despesas
      from public.lancamentos_financeiros l
      where ${filtroDeDias(de, ate)}
        and (${tipo}::text is null or l.tipo = ${tipo}::text)
        and (${categoria}::text is null or l.categoria = ${categoria}::text)
      order by l.data desc, l.id
      limit ${limiteEntre(args.limit, 10, 100)}::int`);
    const lancamentos = rows.map(({ linha }) => semVazios({
      ...linha, tipo: rotulo(TIPO_LANCAMENTO, linha.tipo), categoria: rotulo(CATEGORIA_FINANCEIRA, linha.categoria),
    }));
    return {
      ...(de || ate ? { periodo: { de: de ? diaBr(de) : null, ate: ate ? diaBr(ate) : null } } : {}),
      total: rows[0]?.total ?? 0,
      mostrando: lancamentos.length,
      soma_receitas: rows[0]?.receitas ?? 0,
      soma_despesas: rows[0]?.despesas ?? 0,
      lancamentos,
    };
  },

  /**
   * "Ativos" = status ATIVO (cartão Contratos Ativos da tela Aluguéis). O fim do contrato vem da coluna data_fim
   * (Central de Contratos) ou, na locação, de data_fim_calculada dentro do conteúdo (tela Aluguéis), ou de
   * início + prazo. O filtro de vencimento é feito aqui, sobre todos os contratos da conta.
   */
  async get_contracts(tx, args, r) {
    const status = filtroTexto(args.status);
    const tipos = tiposDeContrato(args.tipo);
    if (tipos && !tipos.length) return { error: 'invalid_tipo', tipos_validos: Object.keys(TIPO_CONTRATO) };
    const cliente = argUuid(args, 'client_id');
    const rows = await tx.$queryRaw<Array<{
      id: string; tipo: string; status: string; valor: number; inicio: string | null; fim: string | null; fim_conteudo: string | null;
      prazo_meses: number | null; dia_vencimento: number | null; cliente: string | null; cliente_id: string | null; imovel: string | null;
    }>>(Prisma.sql`
      select c.id::text as id, c.tipo::text as tipo, c.status, c.valor::float8 as valor,
        to_char(c.data_inicio, 'YYYY-MM-DD') as inicio, to_char(c.data_fim, 'YYYY-MM-DD') as fim,
        substring(c.conteudo from '"data_fim_calculada"[[:space:]]*:[[:space:]]*"([0-9]{4}-[0-9]{2}-[0-9]{2}[^"]{0,30})"') as fim_conteudo,
        c.prazo_meses, c.dia_vencimento, cl.nome as cliente, c.cliente_id::text as cliente_id, i.titulo as imovel
      from public.contratos c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.imoveis i on i.id = c.imovel_id
      where (${status}::text is null or c.status = ${status}::text)
        and (${args.ativos === true}::boolean is false or c.status = 'ATIVO')
        and ${tipos ? Prisma.sql`c.tipo::text in (${Prisma.join(tipos)})` : Prisma.sql`true`}
        and (${cliente}::text is null or c.cliente_id::text = ${cliente}::text)
      order by c.created_at desc nulls first, c.id
      limit 1000`);
    const emVigor = new Set(['ATIVO', 'VIGENTE', 'ENCERRANDO']);
    let todos = rows.map((c) => ({ ...c, termino: fimDoContrato(c, r.fuso) }));
    const dias = args.vence_em_dias === undefined || args.vence_em_dias === null ? null : limiteEntre(args.vence_em_dias, 30, 3650);
    const ordenarPorFim = dias !== null || args.vencidos === true;
    if (dias !== null) {
      const limite = somarDias(r.hoje, dias);
      todos = todos.filter((c) => emVigor.has(c.status) && c.termino && c.termino >= r.hoje && c.termino <= limite);
    } else if (args.vencidos === true) {
      todos = todos.filter((c) => emVigor.has(c.status) && c.termino && c.termino < r.hoje);
    }
    if (ordenarPorFim) todos.sort((a, b) => String(a.termino).localeCompare(String(b.termino)));
    const mostrados = todos.slice(0, limiteEntre(args.limit, 10, 50));
    return {
      total: todos.length,
      mostrando: mostrados.length,
      soma_valor: Math.round(todos.reduce((s, c) => s + (Number(c.valor) || 0), 0) * 100) / 100,
      ...(dias !== null ? { criterio: `terminam entre ${diaBr(r.hoje)} e ${diaBr(somarDias(r.hoje, dias))}` } : {}),
      contratos: mostrados.map((c) => semVazios({
        id: c.id, tipo: rotulo(TIPO_CONTRATO, c.tipo), status: rotulo({}, c.status), cliente: c.cliente, cliente_id: c.cliente_id,
        imovel: c.imovel, valor: c.valor, inicio: c.inicio ? diaBr(c.inicio) : null, fim: c.termino ? diaBr(c.termino) : null,
        dia_vencimento: c.dia_vencimento,
      })),
    };
  },

  async get_alerts(tx, args, r) {
    const tipo = filtroTexto(args.tipo);
    // alertas não tem coluna prioridade: a ação create_alert a guarda em metadata.
    const prioridade = filtroTexto(args.prioridade);
    const rows = await tx.$queryRaw<Array<{ linha: Linha; total: number }>>(Prisma.sql`
      select jsonb_build_object('tipo', a.tipo::text, 'mensagem', a.mensagem, 'prioridade', a.metadata->>'prioridade',
        'criado_em', to_char(a.created_at at time zone ${r.fuso}::text, 'DD/MM/YYYY HH24:MI')) as linha,
        count(*) over ()::int as total
      from public.alertas a
      where a.lido = false
        and (${tipo}::text is null or a.tipo::text = ${tipo}::text)
        and (${prioridade}::text is null or a.metadata->>'prioridade' = ${prioridade}::text)
      order by a.created_at desc, a.id
      limit ${limiteEntre(args.limit, 10, 50)}::int`);
    const alertas = rows.map(({ linha }) => semVazios({
      ...linha, tipo: rotulo(TIPO_ALERTA, linha.tipo), prioridade: rotulo(PRIORIDADE, linha.prioridade),
    }));
    return { total: rows[0]?.total ?? 0, mostrando: alertas.length, alertas };
  },

  /**
   * O Funil de Vendas da tela Funil: etapas ativas na ordem do kanban, com a contagem de cada coluna (inclui os
   * negócios de demonstração, como o kanban, e diz quantos são). O resumo segue o painel do CRM (sem demonstração).
   */
  async get_funnel_stats(tx, args, r) {
    const etapas = await tx.$queryRaw<Array<{ id: string; nome: string; tipo: string; negocios: number; demonstracao: number; valor: number; valor_demonstracao: number }>>(Prisma.sql`
      select e.id::text as id, e.nome, e.tipo, count(o.id)::int as negocios,
        (count(o.id) filter (where o.is_sample_data))::int as demonstracao,
        coalesce(sum(o.valor_estimado), 0)::float8 as valor,
        coalesce(sum(o.valor_estimado) filter (where o.is_sample_data), 0)::float8 as valor_demonstracao
      from public.crm_etapas e
      left join public.crm_oportunidades o on o.etapa_id = e.id
      where e.ativo = true
      group by e.id, e.nome, e.tipo, e.ordem
      order by e.ordem, e.nome, e.id`);
    const soma = (tipo: string, campo: 'negocios' | 'valor') => etapas.filter((e) => e.tipo === tipo)
      .reduce((s, e) => s + (campo === 'negocios' ? e.negocios - e.demonstracao : e.valor - e.valor_demonstracao), 0);
    const ganhos = soma('GANHO', 'negocios');
    const perdidos = soma('PERDIDO', 'negocios');
    const resultado: Record<string, unknown> = {
      etapas: etapas.map((e) => semVazios({
        etapa: e.nome, situacao: rotulo(TIPO_ETAPA, e.tipo), negocios: e.negocios, valor: e.valor,
        demonstracao: e.demonstracao || null,
      })),
      resumo: {
        em_aberto: soma('ABERTA', 'negocios'),
        valor_em_aberto: Math.round(soma('ABERTA', 'valor') * 100) / 100,
        ganhos,
        valor_ganho: Math.round(soma('GANHO', 'valor') * 100) / 100,
        perdidos,
        taxa_conversao: ganhos + perdidos ? `${Math.round((ganhos / (ganhos + perdidos)) * 100)}%` : 'sem negócios encerrados',
        observacao: 'Resumo sem os negócios de demonstração. Ganhos, perdidos e taxa contam todo o histórico.',
      },
    };
    const pedida = filtroTexto(args.etapa);
    if (!pedida) return resultado;
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const alvo = etapas.find((e) => norm(e.nome) === norm(pedida)) ?? etapas.find((e) => norm(e.nome).includes(norm(pedida)));
    if (!alvo) return { ...resultado, etapa: { error: 'etapa_nao_encontrada', etapas_existentes: etapas.map((e) => e.nome) } };
    const negocios = await tx.$queryRaw<Array<{ linha: Linha; total: number }>>(Prisma.sql`
      select jsonb_build_object('titulo', o.titulo, 'cliente', cl.nome, 'cliente_id', o.cliente_id, 'imovel', i.titulo,
        'valor', o.valor_estimado, 'previsao_fechamento', to_char(o.data_prevista_fechamento, 'DD/MM/YYYY'),
        'criado_em', to_char(o.created_at at time zone ${r.fuso}::text, 'DD/MM/YYYY'), 'demonstracao', o.is_sample_data) as linha,
        count(*) over ()::int as total
      from public.crm_oportunidades o
      left join public.clientes cl on cl.id = o.cliente_id
      left join public.imoveis i on i.id = o.imovel_id
      where o.etapa_id = ${alvo.id}::uuid
      order by o.ordem, o.id
      limit ${limiteEntre(args.limit, 10, 50)}::int`);
    const lista = negocios.map(({ linha }) => semVazios(linha));
    return { ...resultado, etapa: { nome: alvo.nome, total: negocios[0]?.total ?? 0, mostrando: lista.length, negocios: lista } };
  },

  async get_contact_history(tx, args, r) {
    const id = argUuid(args, 'client_id');
    if (!id) return { error: 'invalid_client_id' };
    const limite = limiteEntre(args.limit, 10, 30);
    const [t] = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      select count(*)::int as n from public.historico_contatos h where h.cliente_id = ${id}::uuid`);
    const contatos = await ultimosContatos(tx, id, limite, r);
    return { total: t?.n ?? 0, mostrando: contatos.length, contatos };
  },
};

async function ultimosContatos(tx: Tx, clienteId: string, limite: number, r: Relogio): Promise<Linha[]> {
  const rows = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
    select jsonb_build_object('data', to_char(h.data_contato at time zone ${r.fuso}::text, 'DD/MM/YYYY HH24:MI'),
      'canal', h.tipo::text, 'direcao', case when h.direcao::text = 'IN' then 'Recebido' else 'Enviado' end,
      'conteudo', left(h.conteudo, 500)) as linha
    from public.historico_contatos h where h.cliente_id = ${clienteId}::uuid
    order by h.data_contato desc, h.id limit ${limite}::int`);
  return linhas(rows).map((c) => ({ ...c, canal: rotulo({ WHATSAPP: 'WhatsApp', EMAIL: 'E-mail' }, c.canal) }));
}

/**
 * Fim do contrato: coluna data_fim; senão data_fim_calculada do conteúdo (locação); senão início + prazo.
 * data_fim_calculada é um instante ISO (o cadastro manual grava 'AAAA-MM-DDT00:00:00.000Z') e a tela Aluguéis
 * mostra o dia no fuso de quem vê: o dia sai no fuso, não dos 10 primeiros caracteres.
 */
export function fimDoContrato(
  c: { fim: string | null; fim_conteudo: string | null; inicio: string | null; prazo_meses: number | null },
  fuso: string = FUSO_PADRAO,
): string | null {
  if (c.fim) return c.fim;
  const doConteudo = diaDoConteudo(c.fim_conteudo, fuso);
  if (doConteudo) return doConteudo;
  if (c.inicio && c.prazo_meses && c.prazo_meses > 0) {
    const [a, m, d] = c.inicio.split('-').map(Number);
    const alvo = new Date(Date.UTC(a, m - 1 + c.prazo_meses, 1));
    const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    alvo.setUTCDate(Math.min(d, ultimo));
    return alvo.toISOString().slice(0, 10);
  }
  return null;
}

function diaDoConteudo(valor: string | null, fuso: string): string | null {
  if (!valor) return null;
  const soDia = diaValido(valor);
  if (soDia) return soDia;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(valor)) return null;
  const instante = new Date(valor);
  return Number.isNaN(instante.getTime()) ? null : diaNoFuso(instante, fuso);
}


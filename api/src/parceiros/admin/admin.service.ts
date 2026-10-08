import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import {
  CancelarLoteDto, CriarLinkDto, CriarParceiroDto, DefinirPercentualDto, DefinirStatusCorretorDto, EditarParceiroDto,
  EstornarReceitaDto, GerarLoteDto, LIMITE_LISTA, ListarAcessosDto, ListarAssinaturasDto, ListarAtendimentoDto,
  ListarAuditoriaDto, ListarCancelamentosDto, ListarComissoesDto, ListarDiagnosticosDto, ListarLotesDto,
  ListarOrganizacoesDto, ListarPagamentosDto, ListarParceirosDto, ListarReceitaDto, ListarUsuariosDto, MarcarLotePagoDto,
  PaginaDto, PeriodoDto, POR_PAGINA, POR_PAGINA_AUDITORIA, POR_PAGINA_DIAGNOSTICOS, RegistrarAuditoriaDto,
  RegistrarCancelamentoDto, RegistrarPagamentoDto, RegistrarReceitaDto, SalvarConfigDto, StatusDiagnosticoDto,
  TransicionarComissaoDto,
} from '../parceiros.dto';
import { ERROS, traduzirErroBanco } from '../parceiros.erros';

export type Linha = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

/** Colunas de escrita: constantes do service, nunca chave vinda do cliente. */
const COLUNAS_PARCEIRO = [
  'nome', 'empresa', 'documento', 'email', 'telefone', 'responsavel', 'status', 'data_inicio',
  'janela_atribuicao_dias', 'observacoes', 'chave_pix', 'tipo_chave_pix', 'cortesia_dias', 'cortesia_expira_em', 'tipo',
] as const;
const COLUNAS_LINK = ['parceiro_id', 'slug', 'campanha', 'principal'] as const;

export { COLUNAS_LINK, COLUNAS_PARCEIRO };

function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

function jsonDe(dados: object, cols: readonly string[]): string {
  return JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dados as Record<string, unknown>)[c]])));
}

const lista = (cols: readonly string[], prefixo = '') => Prisma.raw(cols.map((c) => `${prefixo}${c}`).join(', '));

interface Pagina {
  limite: number;
  offset: number;
  pagina: number;
}

function paginar(q: PaginaDto, padrao = POR_PAGINA): Pagina {
  const pagina = q.pagina ?? 1;
  const limite = q.por_pagina ?? padrao;
  return { limite, offset: (pagina - 1) * limite, pagina };
}

const texto = (v: string | null | undefined): string | null => (v === undefined ? null : v);

/**
 * Backoffice (B1–B44), todo no caminho do usuário.
 *
 * Cada rota é uma chamada de RPC existente dentro do TenantDb, ou a mesma leitura/escrita direta que o
 * front faz hoje. NENHUMA regra de papel é reimplementada aqui: quem decide é exigir_admin() /
 * exigir_super_admin() dentro das RPCs e as policies is_admin()/is_super_admin() nas tabelas. O
 * resultado das RPCs é devolvido sem transformar nada — é o mesmo valor que o PostgREST entrega hoje.
 *
 * Nenhuma rota faz UPDATE ou DELETE em admin_auditoria (§0.6.7): a escrita só acontece por
 * registrar_auditoria_admin() e pelos gatilhos, que seguem disparando porque a escrita continua
 * passando pelo TenantDb como `authenticated`.
 */
@Injectable()
export class AdminService {
  constructor(private readonly db: TenantDb) {}

  // ------------------------------------------------------------ papéis e auditoria

  /** B1: não é protegida por papel — todo autenticado pode ler os próprios papéis (hoje devolve []). */
  papeis(claims: SupabaseClaims): Promise<string[]> {
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ papeis: string[] }>>(Prisma.sql`select public.meus_papeis() as papeis`);
      return r[0]?.papeis ?? [];
    });
  }

  listarAuditoria(claims: SupabaseClaims, q: ListarAuditoriaDto): Promise<unknown> {
    const { limite, offset } = paginar(q, POR_PAGINA_AUDITORIA);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_auditoria(${texto(q.entidade)}::text, ${texto(q.acao)}::text,
        ${texto(q.de)}::date, ${texto(q.ate)}::date, ${limite}::int, ${offset}::int) as resultado`));
  }

  /** B3: ::int porque a função devolve bigint, que o JSON.stringify do Nest não serializa. */
  registrarAuditoria(claims: SupabaseClaims, dto: RegistrarAuditoriaDto): Promise<{ id: number }> {
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        select public.registrar_auditoria_admin(${dto.acao}::text, ${dto.entidade}::text, ${texto(dto.entidade_id)}::text,
          ${dto.dados_antes ?? null}::jsonb, ${dto.dados_depois ?? null}::jsonb, ${texto(dto.motivo)}::text)::int as id`);
      return { id: r[0].id };
    });
  }

  // ------------------------------------------------------------ parceiros, percentuais e links

  listarParceiros(claims: SupabaseClaims, q: ListarParceirosDto): Promise<unknown> {
    const { limite, offset } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_parceiros(${texto(q.busca)}::text, ${texto(q.status)}::text,
        ${limite}::int, ${offset}::int) as resultado`));
  }

  opcoesParceiros(claims: SupabaseClaims): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_opcoes_parceiros() as resultado`));
  }

  /** B6: as mesmas quatro consultas de useParceiro hoje, na mesma ordem e com os mesmos limites. */
  parceiro(claims: SupabaseClaims, id: string): Promise<{ parceiro: Linha; percentuais: Linha[]; links: Linha[]; atribuicoes: Linha[] }> {
    return this.rodar(claims, async (tx) => {
      const p = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(p) as linha from public.parceiros p where p.id = ${id}::uuid`);
      if (p.length === 0) throw ERROS.naoEncontrado();
      const percentuais = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(pp) as linha from public.parceiro_percentuais pp
         where pp.parceiro_id = ${id}::uuid order by pp.vigencia_inicio desc, pp.id desc limit ${LIMITE_LISTA}::int`);
      const links = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(l) as linha from public.parceiro_links l
         where l.parceiro_id = ${id}::uuid order by l.criado_em desc, l.id desc limit ${LIMITE_LISTA}::int`);
      // jsonb_build_object reproduz literalmente o shape do embed corretores(nome, email) do PostgREST,
      // inclusive o null quando não há corretor — é o que AtribuicaoParceiro já espera.
      const atribuicoes = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(a) || jsonb_build_object('corretores',
                 case when c.id is null then null else jsonb_build_object('nome', c.nome, 'email', c.email) end) as linha
          from public.parceiro_atribuicoes a
          left join public.corretores c on c.id = a.corretor_id
         where a.parceiro_id = ${id}::uuid order by a.criado_em desc, a.id desc limit ${100}::int`);
      return {
        parceiro: p[0].linha,
        percentuais: percentuais.map((l) => l.linha),
        links: links.map((l) => l.linha),
        atribuicoes: atribuicoes.map((l) => l.linha),
      };
    });
  }

  /** B7: criado_por é coluna fixa (claims.sub), fora do JSON. user_id vem do gatilho. */
  criarParceiro(claims: SupabaseClaims, dto: CriarParceiroDto): Promise<{ id: string }> {
    const cols = presentes(dto, COLUNAS_PARCEIRO);
    const json = jsonDe(dto, cols);
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into public.parceiros as x (criado_por, ${lista(cols)})
        select ${claims.sub}::uuid, ${lista(cols, 'r.')}
          from jsonb_populate_record(null::public.parceiros, ${json}::jsonb) r
        returning x.id::text as id`);
      return { id: r[0].id };
    });
  }

  async editarParceiro(claims: SupabaseClaims, id: string, dto: EditarParceiroDto): Promise<{ id: string }> {
    const cols = presentes(dto, COLUNAS_PARCEIRO);
    if (cols.length === 0) throw ERROS.nadaParaAtualizar();
    const json = jsonDe(dto, cols);
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.parceiros x set (${lista(cols)}) = (select ${lista(cols, 'r.')}
          from jsonb_populate_record(null::public.parceiros, ${json}::jsonb) r)
         where x.id = ${id}::uuid returning x.id::text as id`);
      if (r.length === 0) throw ERROS.naoEncontrado();
      return { id: r[0].id };
    });
  }

  definirPercentual(claims: SupabaseClaims, id: string, dto: DefinirPercentualDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_definir_percentual(${id}::uuid, ${dto.percentual}::numeric, ${dto.base_calculo}::text,
        ${dto.valor_fixo ?? null}::numeric, ${texto(dto.vigencia_inicio)}::date, ${texto(dto.motivo)}::text) as resultado`));
  }

  criarLink(claims: SupabaseClaims, parceiroId: string, dto: CriarLinkDto): Promise<{ id: string; slug: string }> {
    const dados = { parceiro_id: parceiroId, slug: dto.slug, campanha: dto.campanha, principal: dto.principal };
    const cols = presentes(dados, COLUNAS_LINK);
    const json = jsonDe(dados, cols);
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ id: string; slug: string }>>(Prisma.sql`
        insert into public.parceiro_links as x (criado_por, ${lista(cols)})
        select ${claims.sub}::uuid, ${lista(cols, 'r.')}
          from jsonb_populate_record(null::public.parceiro_links, ${json}::jsonb) r
        returning x.id::text as id, x.slug`);
      return { id: r[0].id, slug: r[0].slug };
    });
  }

  revogarLink(claims: SupabaseClaims, id: string): Promise<{ revogado: true }> {
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.parceiro_links set ativo = false, revogado_em = now()
         where id = ${id}::uuid returning id::text as id`);
      if (r.length === 0) throw ERROS.naoEncontrado();
      return { revogado: true as const };
    });
  }

  // ------------------------------------------------------------ comissões, pagamentos e receita

  listarComissoes(claims: SupabaseClaims, q: ListarComissoesDto): Promise<unknown> {
    const { limite, offset } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_comissoes(${texto(q.parceiro_id)}::uuid, ${texto(q.status)}::text,
        ${texto(q.de)}::date, ${texto(q.ate)}::date, ${limite}::int, ${offset}::int) as resultado`));
  }

  transicionarComissao(claims: SupabaseClaims, id: string, dto: TransicionarComissaoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_transicionar_comissao(${id}::uuid, ${dto.novo_status}::text, ${texto(dto.motivo)}::text) as resultado`));
  }

  registrarPagamento(claims: SupabaseClaims, dto: RegistrarPagamentoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_registrar_pagamento(${dto.parceiro_id}::uuid, ${dto.comissao_ids}::uuid[],
        ${texto(dto.metodo)}::text, ${texto(dto.referencia)}::text, ${texto(dto.pago_em)}::date,
        ${texto(dto.observacoes)}::text) as resultado`));
  }

  listarReceita(claims: SupabaseClaims, q: ListarReceitaDto): Promise<unknown> {
    const { limite, offset } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_receita(${texto(q.corretor_id)}::uuid, ${texto(q.status)}::text,
        ${texto(q.de)}::date, ${texto(q.ate)}::date, ${limite}::int, ${offset}::int) as resultado`));
  }

  registrarReceita(claims: SupabaseClaims, dto: RegistrarReceitaDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_registrar_receita(${dto.corretor_id}::uuid, ${dto.valor_bruto}::numeric,
        ${dto.confirmado_em}::timestamptz, ${dto.tipo ?? 'assinatura'}::text, ${dto.valor_liquido ?? null}::numeric,
        ${texto(dto.competencia)}::date, ${dto.motivo}::text) as resultado`));
  }

  estornarReceita(claims: SupabaseClaims, id: string, dto: EstornarReceitaDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_estornar_receita(${id}::uuid, ${dto.motivo}::text) as resultado`));
  }

  // ------------------------------------------------------------ repasses em lote

  elegiveisRepasse(claims: SupabaseClaims, saldoMinimo: number | null): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_parceiros_elegiveis_repasse(${saldoMinimo}::numeric) as resultado`));
  }

  listarLotes(claims: SupabaseClaims, q: ListarLotesDto): Promise<unknown> {
    const { limite, pagina } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_lotes(${texto(q.status)}::text, ${pagina}::int, ${limite}::int) as resultado`));
  }

  lote(claims: SupabaseClaims, id: string): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_detalhe_lote(${id}::uuid) as resultado`));
  }

  gerarLote(claims: SupabaseClaims, dto: GerarLoteDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_gerar_lote_repasse(${dto.parceiro_ids}::uuid[], ${dto.saldo_minimo ?? null}::numeric,
        ${texto(dto.observacoes)}::text) as resultado`));
  }

  marcarLoteExportado(claims: SupabaseClaims, id: string): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_marcar_lote_exportado(${id}::uuid) as resultado`));
  }

  marcarLotePago(claims: SupabaseClaims, id: string, dto: MarcarLotePagoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_marcar_lote_pago(${id}::uuid, ${dto.pago_em}::date, ${dto.referencia}::text,
        ${texto(dto.comprovante_url)}::text) as resultado`));
  }

  cancelarLote(claims: SupabaseClaims, id: string, dto: CancelarLoteDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_cancelar_lote(${id}::uuid, ${dto.motivo}::text) as resultado`));
  }

  // ------------------------------------------------------------ usuários, atendimento e assinaturas

  listarUsuarios(claims: SupabaseClaims, q: ListarUsuariosDto): Promise<unknown> {
    const { limite, offset } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_usuarios(${texto(q.busca)}::text, ${texto(q.status)}::text, ${texto(q.atividade)}::text,
        ${texto(q.parceiro_id)}::uuid, ${texto(q.criado_de)}::date, ${texto(q.criado_ate)}::date,
        ${q.ordenar ?? 'criado_em'}::text, ${q.direcao ?? 'desc'}::text, ${limite}::int, ${offset}::int) as resultado`));
  }

  usuario(claims: SupabaseClaims, corretorId: string): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_detalhe_usuario(${corretorId}::uuid) as resultado`));
  }

  definirStatusCorretor(claims: SupabaseClaims, corretorId: string, dto: DefinirStatusCorretorDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_definir_status_corretor(${corretorId}::uuid, ${dto.status}::text, ${dto.motivo}::text) as resultado`));
  }

  listarAtendimento(claims: SupabaseClaims, q: ListarAtendimentoDto): Promise<unknown> {
    const { limite, offset } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_atendimento(${texto(q.busca)}::text, ${texto(q.status)}::text, ${texto(q.parceiro_id)}::uuid,
        ${q.origem_direta ?? false}::boolean, ${texto(q.campanha)}::text, ${limite}::int, ${offset}::int) as resultado`));
  }

  listarAssinaturas(claims: SupabaseClaims, q: ListarAssinaturasDto): Promise<unknown> {
    const { limite, pagina } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_assinaturas(${texto(q.busca)}::text, ${texto(q.status)}::text, ${texto(q.plano)}::text,
        ${texto(q.ciclo)}::text, ${pagina}::int, ${limite}::int) as resultado`));
  }

  listarPagamentos(claims: SupabaseClaims, q: ListarPagamentosDto): Promise<unknown> {
    const { limite, pagina } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_pagamentos(${texto(q.busca)}::text, ${texto(q.status)}::text, ${texto(q.metodo)}::text,
        ${texto(q.plano)}::text, ${texto(q.inicio)}::date, ${texto(q.fim)}::date, ${pagina}::int, ${limite}::int) as resultado`));
  }

  listarCancelamentos(claims: SupabaseClaims, q: ListarCancelamentosDto): Promise<unknown> {
    const { limite, pagina } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_cancelamentos(${texto(q.motivo)}::text, ${texto(q.origem)}::text, ${texto(q.plano)}::text,
        ${texto(q.inicio)}::date, ${texto(q.fim)}::date, ${pagina}::int, ${limite}::int) as resultado`));
  }

  registrarCancelamento(claims: SupabaseClaims, dto: RegistrarCancelamentoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_registrar_cancelamento(${dto.motivo}::text, ${texto(dto.corretor_id)}::uuid,
        ${texto(dto.contato_nome)}::text, ${texto(dto.contato_email)}::text, ${texto(dto.contato_telefone)}::text,
        ${texto(dto.plano_anterior)}::text, ${texto(dto.comentario)}::text, ${dto.origem ?? 'outro'}::text,
        ${texto(dto.data)}::date) as resultado`));
  }

  listarOrganizacoes(claims: SupabaseClaims, q: ListarOrganizacoesDto): Promise<unknown> {
    const { limite, offset } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_organizacoes(${texto(q.busca)}::text, ${texto(q.status)}::text, ${texto(q.plano)}::text,
        ${limite}::int, ${offset}::int) as resultado`));
  }

  organizacao(claims: SupabaseClaims, id: string): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_detalhe_organizacao(${id}::uuid) as resultado`));
  }

  listarAcessos(claims: SupabaseClaims, q: ListarAcessosDto): Promise<unknown> {
    const { limite, offset } = paginar(q);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_acessos(${texto(q.busca)}::text, ${limite}::int, ${offset}::int) as resultado`));
  }

  // ------------------------------------------------------------ métricas

  metricas(claims: SupabaseClaims, q: PeriodoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_metricas_visao_geral(${q.inicio}::date, ${q.fim}::date) as resultado`));
  }

  metricasSaas(claims: SupabaseClaims, q: PeriodoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_metricas_saas(${q.inicio}::date, ${q.fim}::date) as resultado`));
  }

  metricasCancelamento(claims: SupabaseClaims, q: PeriodoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_metricas_cancelamento(${q.inicio}::date, ${q.fim}::date) as resultado`));
  }

  metricasOnboarding(claims: SupabaseClaims, q: PeriodoDto): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_onboarding_metricas(${q.inicio}::timestamptz, ${q.fim}::timestamptz) as resultado`));
  }

  statusIntegracoes(claims: SupabaseClaims): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_status_integracoes() as resultado`));
  }

  // ------------------------------------------------------------ configuração e diagnósticos

  /** B40: é o que useConfigAdmin chama hoje (a RPC valida a chave contra a lista interna). */
  listarConfig(claims: SupabaseClaims): Promise<unknown> {
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_listar_config() as resultado`));
  }

  /** B40b: o tabelaAdmin('admin_config').select('*').order('chave') de AdminConfiguracoes.tsx. */
  listarLinhasConfig(claims: SupabaseClaims): Promise<Linha[]> {
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(c) as linha from public.admin_config c order by c.chave asc limit ${LIMITE_LISTA}::int`);
      return r.map((l) => l.linha);
    });
  }

  /** B41: o UPDATE direto de AdminConfiguracoes.tsx (policy de super_admin + gatilho de auditoria). */
  atualizarConfig(claims: SupabaseClaims, chave: string, dto: SalvarConfigDto): Promise<Linha> {
    const json = JSON.stringify(dto.valor ?? null);
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.admin_config set valor = ${json}::jsonb, atualizado_em = now()
         where chave = ${chave}::text returning to_jsonb(admin_config.*) as linha`);
      if (r.length === 0) throw ERROS.configDesconhecida();
      return r[0].linha;
    });
  }

  /** B42: a RPC que useSalvarConfig chama. */
  salvarConfig(claims: SupabaseClaims, chave: string, dto: SalvarConfigDto): Promise<unknown> {
    const json = JSON.stringify(dto.valor ?? null);
    return this.rpc(claims, (tx) => tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
      select public.admin_salvar_config(${chave}::text, ${json}::jsonb) as resultado`));
  }

  listarDiagnosticos(claims: SupabaseClaims, q: ListarDiagnosticosDto): Promise<Linha[]> {
    const { limite, offset } = paginar(q, POR_PAGINA_DIAGNOSTICOS);
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        select to_jsonb(d) as linha from public.commercial_diagnostics d
         order by d.created_at desc, d.id desc limit ${limite}::int offset ${offset}::int`);
      return r.map((l) => l.linha);
    });
  }

  atualizarStatusDiagnostico(claims: SupabaseClaims, id: string, dto: StatusDiagnosticoDto): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const r = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.commercial_diagnostics set status = ${dto.status}::text
         where id = ${id}::uuid returning to_jsonb(commercial_diagnostics.*) as linha`);
      if (r.length === 0) throw ERROS.diagnosticoNaoEncontrado();
      return r[0].linha;
    });
  }

  // ------------------------------------------------------------ apoio

  /** O resultado da RPC vai sem transformação: é o mesmo valor que o PostgREST entrega hoje. */
  private rpc(claims: SupabaseClaims, consulta: (tx: Tx) => Promise<Array<{ resultado: unknown }>>): Promise<unknown> {
    return this.rodar(claims, async (tx) => (await consulta(tx))[0]?.resultado ?? null);
  }

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada. */
  private async rodar<T>(claims: SupabaseClaims, work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.run(claims, work);
    } catch (e) {
      traduzirErroBanco(e, { origem: 'backoffice' });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import {
  AlterarContratoDto, COLUNAS_ALTERACAO, COLUNAS_CRIACAO, COLUNAS_LOCACAO, ContratosDosClientesDto, CriarContratoDto, CriarLocacaoDto,
  EditarLocacaoDto, LIMITE_LISTA, ListarLocacaoDto,
} from './contratos.dto';
import { erroApi, OpcoesErro, traduzirErroBanco } from './contratos.erros';

/** Linha de to_jsonb: chaves e tipos iguais aos que o PostgREST entrega hoje. */
export type Linha = Record<string, unknown>;
export type Tx = Prisma.TransactionClient;
type Linhas = Array<{ linha: Linha }>;

const OPCOES: OpcoesErro = { semPermissao: 'Você não tem permissão para alterar contratos desta conta.' };

export function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

/** Colunas vêm só das constantes do DTO; os valores vão num JSON convertido pelo próprio banco. */
export function montarCampos(dados: object, cols: readonly string[]) {
  const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dados as Record<string, unknown>)[c]])));
  const alvo = Prisma.raw(cols.join(', '));
  const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
  return { json, alvo, origem };
}

export async function corretorDoUsuario(tx: Tx): Promise<string> {
  const linhas = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select public.get_corretor_id()::text as id`);
  const id = linhas[0]?.id;
  if (!id) throw erroApi(403, 'corretor_nao_identificado', 'Não foi possível identificar o corretor.');
  return id;
}

/** A checagem de FK ignora RLS: confere antes, no mesmo run, que cliente e imóvel são visíveis. Null/ausente não confere. */
export async function exigirVinculos(tx: Tx, dados: { cliente_id?: string | null; imovel_id?: string | null }): Promise<void> {
  if (dados.cliente_id) {
    const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`select count(*)::int as n from public.clientes where id = ${dados.cliente_id}::uuid`);
    if (n === 0) throw erroApi(422, 'cliente_invalido', 'Cliente não encontrado nesta conta.');
  }
  if (dados.imovel_id) {
    const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`select count(*)::int as n from public.imoveis where id = ${dados.imovel_id}::uuid`);
    if (n === 0) throw erroApi(422, 'imovel_invalido', 'Imóvel não encontrado nesta conta.');
  }
}

const naoEncontrado = () => erroApi(404, 'contrato_nao_encontrado', 'Contrato não encontrado.');

@Injectable()
export class ContratosService {
  constructor(private readonly db: TenantDb) {}

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada. */
  private async rodar<T>(claims: SupabaseClaims, trabalho: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.run(claims, trabalho);
    } catch (e) {
      traduzirErroBanco(e, OPCOES);
    }
  }

  private async lista(claims: SupabaseClaims, consulta: Prisma.Sql): Promise<Linha[]> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Linhas>(consulta));
    return linhas.map((l) => l.linha);
  }

  listar(claims: SupabaseClaims): Promise<Linha[]> {
    return this.lista(claims, Prisma.sql`
      select to_jsonb(c) as linha from public.contratos c
      order by c.created_at desc, c.id
      limit ${LIMITE_LISTA}::int`);
  }

  listarCentral(claims: SupabaseClaims): Promise<Linha[]> {
    return this.lista(claims, Prisma.sql`
      select jsonb_build_object(
        'id', c.id, 'tipo', c.tipo, 'status', c.status, 'valor', c.valor,
        'data_inicio', c.data_inicio, 'data_fim', c.data_fim, 'observacoes', c.observacoes,
        'arquivo_url', c.arquivo_url, 'imovel_id', c.imovel_id, 'cliente_id', c.cliente_id,
        'created_at', c.created_at,
        'imoveis', case when i.id is null then null else jsonb_build_object('titulo', i.titulo) end,
        'clientes', case when cl.id is null then null else jsonb_build_object('nome', cl.nome) end
      ) as linha
      from public.contratos c
      left join public.imoveis i on i.id = c.imovel_id
      left join public.clientes cl on cl.id = c.cliente_id
      order by c.data_fim asc nulls last, c.id
      limit ${LIMITE_LISTA}::int`);
  }

  listarLocacao(claims: SupabaseClaims, q: ListarLocacaoDto): Promise<Linha[]> {
    const tipo = q.tipo ?? 'LOCACAO_RESIDENCIAL';
    return this.lista(claims, Prisma.sql`
      select to_jsonb(c) || jsonb_build_object(
        'clientes', case when cl.id is null then null else jsonb_build_object('nome', cl.nome, 'telefone', cl.telefone) end,
        'imoveis', case when i.id is null then null else jsonb_build_object('titulo', i.titulo, 'endereco', i.endereco, 'proprietario_nome', i.proprietario_nome) end
      ) as linha
      from public.contratos c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.imoveis i on i.id = c.imovel_id
      where c.tipo = ${tipo}::public.tipo_contrato
      order by c.created_at desc, c.id
      limit ${LIMITE_LISTA}::int`);
  }

  listarDosClientes(claims: SupabaseClaims, dto: ContratosDosClientesDto): Promise<Linha[]> {
    return this.lista(claims, Prisma.sql`
      select jsonb_build_object('id', c.id, 'cliente_id', c.cliente_id, 'tipo', c.tipo, 'status', c.status,
        'imoveis', case when i.id is null then null else jsonb_build_object('titulo', i.titulo) end) as linha
      from public.contratos c
      left join public.imoveis i on i.id = c.imovel_id
      where c.cliente_id = any(${dto.cliente_ids}::uuid[])
      order by c.created_at desc, c.id
      limit ${LIMITE_LISTA}::int`);
  }

  criar(claims: SupabaseClaims, dto: CriarContratoDto): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const corretor = await corretorDoUsuario(tx);
      await exigirVinculos(tx, dto);
      const { json, alvo, origem } = montarCampos(dto, presentes(dto, COLUNAS_CRIACAO));
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        insert into public.contratos as x (corretor_id, ${alvo})
        select ${corretor}::uuid, ${origem} from jsonb_populate_record(null::public.contratos, ${json}::jsonb) r
        returning to_jsonb(x) as linha`);
      return linhas[0].linha;
    });
  }

  /** Contrato ATIVO e primeira fatura no MESMO run: ou entram os dois, ou nada. */
  criarLocacao(claims: SupabaseClaims, dto: CriarLocacaoDto): Promise<{ contrato: Linha; fatura: Linha }> {
    const dados = { ...dto, tipo: dto.tipo ?? 'LOCACAO_RESIDENCIAL' };
    return this.rodar(claims, async (tx) => {
      const corretor = await corretorDoUsuario(tx);
      await exigirVinculos(tx, dados);
      const { json, alvo, origem } = montarCampos(dados, presentes(dados, COLUNAS_LOCACAO));
      const [{ linha: contrato }] = await tx.$queryRaw<Linhas>(Prisma.sql`
        insert into public.contratos as x (corretor_id, status, ${alvo})
        select ${corretor}::uuid, 'ATIVO', ${origem} from jsonb_populate_record(null::public.contratos, ${json}::jsonb) r
        returning to_jsonb(x) as linha`);
      const venc = dto.primeira_fatura.data_vencimento;
      const [{ linha: fatura }] = await tx.$queryRaw<Linhas>(Prisma.sql`
        insert into public.faturas_aluguel as f
          (contrato_id, cliente_id, imovel_id, corretor_id, valor_aluguel, data_vencimento, status, mes_referencia)
        values (${contrato.id as string}::uuid, ${dto.cliente_id}::uuid, ${dto.imovel_id}::uuid, ${corretor}::uuid, ${dto.valor}::numeric,
          ${venc}::date,
          case when ${venc}::date <= (now() at time zone 'America/Sao_Paulo')::date then 'ATRASADO' else 'PENDENTE' end,
          ${dto.primeira_fatura.mes_referencia}::text)
        returning to_jsonb(f) as linha`);
      return { contrato, fatura };
    });
  }

  /** Atualiza o contrato e sincroniza as faturas abertas no mesmo run (porte de NewContractDialog.tsx:300-345). */
  editarLocacao(claims: SupabaseClaims, id: string, dto: EditarLocacaoDto): Promise<{ contrato: Linha; faturas_emitidas: string[] }> {
    return this.rodar(claims, async (tx) => {
      const atual = await tx.$queryRaw<Linhas>(Prisma.sql`
        select to_jsonb(c) as linha from public.contratos c where c.id = ${id}::uuid for update`);
      if (atual.length === 0) throw naoEncontrado();
      const diaAntigo = Number(atual[0].linha.dia_vencimento);
      await exigirVinculos(tx, dto);
      const { json, alvo, origem } = montarCampos(dto, presentes(dto, COLUNAS_LOCACAO));
      const [{ linha: contrato }] = await tx.$queryRaw<Linhas>(Prisma.sql`
        update public.contratos t set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.contratos, ${json}::jsonb) r),
          status = 'ATIVO', updated_at = now()
        where t.id = ${id}::uuid returning to_jsonb(t) as linha`);
      const diaMudou = diaAntigo !== dto.dia_vencimento;
      const faturas = await tx.$queryRaw<Array<{ id: string; external_id: string | null }>>(Prisma.sql`
        update public.faturas_aluguel f set
          valor_aluguel = ${dto.valor}::numeric,
          data_vencimento = case when ${diaMudou}::boolean then
            (to_date(f.mes_referencia, 'MM/YYYY')
              + (least(${dto.dia_vencimento}::int, extract(day from to_date(f.mes_referencia, 'MM/YYYY') + interval '1 month - 1 day')::int) - 1))::date
            else f.data_vencimento end
        where f.contrato_id = ${id}::uuid and f.status in ('PENDENTE', 'ATRASADO')
        returning f.id::text as id, f.external_id`);
      return { contrato, faturas_emitidas: faturas.filter((f) => f.external_id !== null && f.external_id !== undefined).map((f) => f.id) };
    });
  }

  alterar(claims: SupabaseClaims, id: string, dto: AlterarContratoDto): Promise<Linha> {
    const cols = presentes(dto, COLUNAS_ALTERACAO);
    if (cols.length === 0) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
    const { json, alvo, origem } = montarCampos(dto, cols);
    return this.rodar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        update public.contratos t set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.contratos, ${json}::jsonb) r),
          updated_at = now()
        where t.id = ${id}::uuid returning to_jsonb(t) as linha`);
      if (linhas.length === 0) throw naoEncontrado();
      return linhas[0].linha;
    });
  }

  /** As faturas e renegociações vão junto por CASCADE, como hoje. */
  remover(claims: SupabaseClaims, id: string): Promise<void> {
    return this.rodar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        delete from public.contratos where id = ${id}::uuid returning id::text as id`);
      if (linhas.length === 0) throw naoEncontrado();
    });
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import {
  COLUNAS_NOVA_OPORTUNIDADE, COLUNAS_NOVA_TAREFA, ConcluirTarefaDto, CriarOportunidadeDto, CriarTarefaDto,
  ExcluirOportunidadesDto, LIMITE_LISTA, MoverOportunidadeDto, SalvarEtapasDto,
} from './crm-funil.dto';
import { erroApi, OpcoesErro, traduzirErroBanco } from './crm-funil.erros';

/** Linha de to_jsonb: chaves e tipos iguais aos que o PostgREST entrega hoje. */
export type Linha = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

const MSG_ETAPA_INVALIDA = 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.';

function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

/** Colunas vêm só das constantes do DTO; os valores vão num JSON convertido pelo próprio banco. */
function montarInsercao(dto: object, permitidas: readonly string[]) {
  const cols = presentes(dto, permitidas);
  const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dto as Record<string, unknown>)[c]])));
  const alvo = Prisma.raw(cols.join(', '));
  const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
  return { json, alvo, origem };
}

@Injectable()
export class CrmFunilService {
  constructor(private readonly db: TenantDb) {}

  listarEtapas(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, Prisma.sql`
      select to_jsonb(e) as linha from public.crm_etapas e
      where e.ativo = true
      order by e.ordem, e.nome, e.id
      limit ${LIMITE_LISTA}::int`);
  }

  salvarEtapas(claims: SupabaseClaims, dto: SalvarEtapasDto): Promise<{ atualizadas: number }> {
    return this.rodar(claims, async (tx) => {
      let atualizadas = 0;
      for (const e of dto.etapas) {
        const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          update public.crm_etapas set nome = ${e.nome}::text, cor = ${e.cor}::text, tipo = ${e.tipo}::text, ordem = ${e.ordem}::int
          where id = ${e.id}::uuid returning id`);
        // Etapa oculta pelo RLS ou inexistente só deixa de contar, como hoje.
        atualizadas += linhas.length;
      }
      return { atualizadas };
    }, { repetido: 'Já existe uma etapa com este nome.' });
  }

  listarOportunidades(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, Prisma.sql`
      select to_jsonb(o) || jsonb_build_object(
        'clientes', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone) from public.clientes c where c.id = o.cliente_id),
        'imoveis',  (select jsonb_build_object('titulo', i.titulo) from public.imoveis i where i.id = o.imovel_id)
      ) as linha
      from public.crm_oportunidades o
      order by o.ordem, o.id
      limit ${LIMITE_LISTA}::int`);
  }

  criarOportunidade(claims: SupabaseClaims, dto: CriarOportunidadeDto): Promise<{ id: string }> {
    return this.rodar(claims, async (tx) => {
      const corretor = await this.corretorId(tx);
      await this.exigirEtapa(tx, dto.etapa_id);
      if (dto.cliente_id) await this.exigirDaConta(tx, 'clientes', dto.cliente_id, corretor, 'cliente_invalido', 'Cliente não encontrado nesta conta.');
      if (dto.imovel_id) await this.exigirDaConta(tx, 'imoveis', dto.imovel_id, corretor, 'imovel_invalido', 'Imóvel não encontrado nesta conta.');
      const { json, alvo, origem } = montarInsercao(dto, COLUNAS_NOVA_OPORTUNIDADE);
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into public.crm_oportunidades as o (corretor_id, ${alvo})
        select ${corretor}::uuid, ${origem} from jsonb_populate_record(null::public.crm_oportunidades, ${json}::jsonb) r
        returning o.id`);
      return { id: linhas[0].id };
    });
  }

  excluirOportunidades(claims: SupabaseClaims, dto: ExcluirOportunidadesDto): Promise<{ excluidas: number }> {
    return this.rodar(claims, async (tx) => {
      // Zero linhas é sucesso, como hoje; as tarefas do negócio somem por cascata.
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        delete from public.crm_oportunidades where id = any(${dto.ids}::uuid[]) returning id`);
      return { excluidas: linhas.length };
    });
  }

  moverOportunidade(claims: SupabaseClaims, id: string, dto: MoverOportunidadeDto): Promise<{ id: string }> {
    return this.rodar(claims, async (tx) => {
      await this.exigirEtapa(tx, dto.etapa_id);
      // O token vai como texto para o banco comparar com microssegundos; um Date do JS perderia a precisão.
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.crm_oportunidades set etapa_id = ${dto.etapa_id}::uuid, ordem = ${dto.ordem}::int
        where id = ${id}::uuid and updated_at = ${dto.updated_at}::timestamptz
        returning id`);
      if (linhas.length === 0) throw erroApi(409, 'CONFLITO', 'Este negócio foi movido em outro lugar.');
      return { id: linhas[0].id };
    });
  }

  listarTarefas(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, Prisma.sql`
      select to_jsonb(t) || jsonb_build_object('clientes',
        (select jsonb_build_object('nome', c.nome) from public.clientes c where c.id = t.cliente_id)) as linha
      from public.crm_tarefas t
      order by t.data_prevista asc nulls last, t.id
      limit ${LIMITE_LISTA}::int`);
  }

  criarTarefa(claims: SupabaseClaims, dto: CriarTarefaDto): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const corretor = await this.corretorId(tx);
      if (dto.oportunidade_id) {
        await this.exigirDaConta(tx, 'crm_oportunidades', dto.oportunidade_id, corretor, 'oportunidade_invalida', 'Negócio não encontrado nesta conta.');
      }
      if (dto.cliente_id) await this.exigirDaConta(tx, 'clientes', dto.cliente_id, corretor, 'cliente_invalido', 'Cliente não encontrado nesta conta.');
      const { json, alvo, origem } = montarInsercao(dto, COLUNAS_NOVA_TAREFA);
      const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        insert into public.crm_tarefas as x (corretor_id, ${alvo})
        select ${corretor}::uuid, ${origem} from jsonb_populate_record(null::public.crm_tarefas, ${json}::jsonb) r
        returning to_jsonb(x) as linha`);
      return linhas[0].linha;
    });
  }

  concluirTarefa(claims: SupabaseClaims, id: string, dto: ConcluirTarefaDto): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.crm_tarefas t
        set concluida = ${dto.concluida}::boolean, concluida_em = case when ${dto.concluida}::boolean then now() else null end
        where t.id = ${id}::uuid
        returning to_jsonb(t) as linha`);
      if (linhas.length === 0) throw erroApi(404, 'tarefa_nao_encontrada', 'Tarefa não encontrada.');
      return linhas[0].linha;
    });
  }

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada (25P02). */
  private async rodar<T>(claims: SupabaseClaims, work: (tx: Tx) => Promise<T>, opcoes?: OpcoesErro): Promise<T> {
    try {
      return await this.db.run(claims, work);
    } catch (e) {
      traduzirErroBanco(e, opcoes);
    }
  }

  private async listar(claims: SupabaseClaims, consulta: Prisma.Sql): Promise<Linha[]> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ linha: Linha }>>(consulta));
    return linhas.map((l) => l.linha);
  }

  private async corretorId(tx: Tx): Promise<string> {
    const linhas = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select public.get_corretor_id()::text as id`);
    const id = linhas[0]?.id;
    if (!id) throw erroApi(403, 'corretor_nao_identificado', 'Não foi possível identificar o corretor.');
    return id;
  }

  private async exigirEtapa(tx: Tx, etapaId: string): Promise<void> {
    const linhas = await tx.$queryRaw<unknown[]>(Prisma.sql`select 1 from public.crm_etapas where id = ${etapaId}::uuid`);
    if (linhas.length === 0) throw erroApi(422, 'etapa_invalida', MSG_ETAPA_INVALIDA);
  }

  /** A policy só confere corretor_id da linha nova; a referência é conferida aqui, na mesma conta. */
  private async exigirDaConta(
    tx: Tx, tabela: 'clientes' | 'imoveis' | 'crm_oportunidades', id: string, corretor: string, codigo: string, message: string,
  ): Promise<void> {
    const linhas = await tx.$queryRaw<unknown[]>(Prisma.sql`
      select 1 from public.${Prisma.raw(tabela)} where id = ${id}::uuid and corretor_id = ${corretor}::uuid`);
    if (linhas.length === 0) throw erroApi(422, codigo, message);
  }
}

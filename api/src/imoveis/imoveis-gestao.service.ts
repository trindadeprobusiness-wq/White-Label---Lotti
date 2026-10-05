import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { erroApi, erroPg, traduzirErroBanco } from './imoveis.erros';
import {
  AtualizarImovelDto, COLUNAS_CRIACAO, COLUNAS_EDICAO, CriarImovelDto, LIMITE_LISTA, RegistrarVendaDto,
} from './imoveis-gestao.dto';

/** Linha de to_jsonb(public.imoveis): chaves e tipos iguais aos do PostgREST, inclusive proprietario_* (gestão do próprio corretor). */
export type LinhaImovel = Record<string, unknown>;

export interface ClienteInteressado {
  id: string;
  nome: string;
  telefone: string;
  status_funil: string;
}

export interface ResultadoVenda {
  imovel_id: string;
  status_venda: 'VENDIDO';
  cliente_atualizado: boolean;
}

type Linhas<T> = Array<{ linha: T }>;

function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

function paraJson(dados: object, cols: readonly string[]): string {
  return JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dados as Record<string, unknown>)[c]])));
}

const SEM_PERMISSAO_ALTERAR = 'Você não tem permissão para alterar este imóvel.';
const naoEncontrado = (message = 'Imóvel não encontrado.') => erroApi(404, 'imovel_nao_encontrado', message);

@Injectable()
export class ImoveisGestaoService {
  private readonly logger = new Logger(ImoveisGestaoService.name);

  constructor(private readonly db: TenantDb) {}

  async listar(claims: SupabaseClaims): Promise<LinhaImovel[]> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Linhas<LinhaImovel>>(Prisma.sql`
        select to_jsonb(i) as linha from public.imoveis i
        order by i.created_at desc nulls first, i.id
        limit ${LIMITE_LISTA}::int`));
      return linhas.map((l) => l.linha);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  async obter(claims: SupabaseClaims, id: string): Promise<LinhaImovel> {
    try {
      return await this.db.run(claims, async (tx) => {
        const linhas = await tx.$queryRaw<Linhas<LinhaImovel>>(Prisma.sql`
          select to_jsonb(i) as linha from public.imoveis i where i.id = ${id}::uuid`);
        if (linhas.length === 0) throw naoEncontrado();
        return linhas[0].linha;
      });
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  async listarClientesInteressados(claims: SupabaseClaims, id: string): Promise<ClienteInteressado[]> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Linhas<ClienteInteressado>>(Prisma.sql`
        select jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'status_funil', c.status_funil) as linha
        from public.cliente_imovel ci
        join public.clientes c on c.id = ci.cliente_id
        where ci.imovel_id = ${id}::uuid
        order by c.created_at desc nulls first, c.id
        limit ${LIMITE_LISTA}::int`));
      return linhas.map((l) => l.linha);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }

  async criar(claims: SupabaseClaims, dto: CriarImovelDto): Promise<LinhaImovel> {
    try {
      return await this.db.run(claims, async (tx) => {
        const corretor = await tx.$queryRaw<Array<{ id: string | null }>>(Prisma.sql`select public.get_corretor_id()::text as id`);
        const corretorId = corretor[0]?.id ?? null;
        if (!corretorId) throw erroApi(403, 'corretor_nao_identificado', 'Não foi possível identificar o corretor.');
        // Colunas omitidas ficam com o default do banco (finalidade, ativo, estado, status_venda, anunciado).
        const cols = presentes(dto, COLUNAS_CRIACAO);
        const json = paraJson(dto, cols);
        const alvo = Prisma.raw(cols.join(', '));
        const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
        const linhas = await tx.$queryRaw<Linhas<LinhaImovel>>(Prisma.sql`
          insert into public.imoveis as i (corretor_id, ${alvo})
          select ${corretorId}::uuid, ${origem} from jsonb_populate_record(null::public.imoveis, ${json}::jsonb) r
          returning to_jsonb(i) as linha`);
        return linhas[0].linha;
      });
    } catch (e) {
      traduzirErroBanco(e, { entidade: 'imovel', semPermissao: 'Você não tem permissão para cadastrar imóveis nesta conta.' });
    }
  }

  async atualizar(claims: SupabaseClaims, id: string, dto: AtualizarImovelDto): Promise<LinhaImovel> {
    try {
      return await this.db.run(claims, async (tx) => {
        const cols = presentes(dto, COLUNAS_EDICAO);
        if (cols.length === 0) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
        const json = paraJson(dto, cols);
        const alvo = Prisma.raw(cols.join(', '));
        const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
        const linhas = await tx.$queryRaw<Linhas<LinhaImovel>>(Prisma.sql`
          update public.imoveis t set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.imoveis, ${json}::jsonb) r)
          where t.id = ${id}::uuid returning to_jsonb(t) as linha`);
        if (linhas.length === 0) throw naoEncontrado();
        return linhas[0].linha;
      });
    } catch (e) {
      traduzirErroBanco(e, { entidade: 'imovel', semPermissao: SEM_PERMISSAO_ALTERAR });
    }
  }

  async remover(claims: SupabaseClaims, id: string): Promise<void> {
    try {
      await this.db.run(claims, async (tx) => {
        const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          delete from public.imoveis where id = ${id}::uuid returning id`);
        if (linhas.length === 0) throw naoEncontrado('Nada foi apagado: o imóvel não existe ou você não tem permissão.');
      });
    } catch (e) {
      traduzirErroBanco(e, { entidade: 'imovel' });
    }
  }

  /**
   * Duas transações de propósito: o imóvel é confirmado antes de o cliente ser tocado,
   * então uma falha no cliente (hoje o gatilho legado sempre falha) não aborta a venda.
   */
  async registrarVenda(claims: SupabaseClaims, id: string, dto: RegistrarVendaDto): Promise<ResultadoVenda> {
    try {
      await this.db.run(claims, async (tx) => {
        const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          update public.imoveis set status_venda = 'VENDIDO' where id = ${id}::uuid returning id`);
        if (linhas.length === 0) throw naoEncontrado();
      });
    } catch (e) {
      traduzirErroBanco(e, { entidade: 'imovel', semPermissao: SEM_PERMISSAO_ALTERAR });
    }

    let cliente_atualizado = false;
    if (dto.cliente_id) {
      const clienteId = dto.cliente_id;
      try {
        const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          update public.clientes set status_funil = 'FECHADO_GANHO' where id = ${clienteId}::uuid returning id`));
        cliente_atualizado = linhas.length === 1;
      } catch (e) {
        // O imóvel já foi gravado: falha do cliente não desfaz a venda (igual ao front de hoje).
        this.logger.warn(`venda sem cliente atualizado: ${erroPg(e)?.sqlstate ?? (e instanceof Error ? e.name : 'desconhecido')}`);
      }
    }
    return { imovel_id: id, status_venda: 'VENDIDO', cliente_atualizado };
  }
}

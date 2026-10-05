import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import {
  AtualizarClienteDto,
  BuscarCandidatosDto,
  COLUNAS_EDICAO_CLIENTE,
  CompletarCpfDto,
  ConverterLeadDto,
  CriarClienteDto,
  DefinirImovelInteresseDto,
  LIMITE_LISTA,
  MoverClienteDto,
  RegistrarHistoricoDto,
} from './crm-clientes.dto';
import { erroApi, OpcoesErro, traduzirErroBanco } from './crm-clientes.erros';

/** Linha de public.clientes como o PostgREST entrega (to_jsonb: snake_case, tipos do PostgREST). */
export type LinhaCliente = Record<string, unknown>;
export type LinhaHistorico = Record<string, unknown>;

type Tx = Prisma.TransactionClient;
type Linhas = Array<{ linha: Record<string, unknown> }>;

function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}

const naoEncontrado = () => erroApi(404, 'cliente_nao_encontrado', 'Cliente não encontrado.');

@Injectable()
export class CrmClientesService {
  constructor(private readonly db: TenantDb) {}

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada. */
  private async executar<T>(claims: SupabaseClaims, trabalho: (tx: Tx) => Promise<T>, opcoes: OpcoesErro = {}): Promise<T> {
    try {
      return await this.db.run(claims, trabalho);
    } catch (e) {
      traduzirErroBanco(e, opcoes);
    }
  }

  async listar(claims: SupabaseClaims): Promise<LinhaCliente[]> {
    const linhas = await this.executar(claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(c) || jsonb_build_object('cliente_imovel',
        coalesce((select jsonb_agg(jsonb_build_object('imovel_id', ci.imovel_id))
                  from public.cliente_imovel ci where ci.cliente_id = c.id), '[]'::jsonb)) as linha
      from public.clientes c
      order by c.created_at desc nulls first, c.id
      limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  async buscarCandidatos(claims: SupabaseClaims, q: BuscarCandidatosDto): Promise<unknown> {
    const linhas = await this.executar(claims, (tx) => tx.$queryRaw<Array<{ r: unknown }>>(Prisma.sql`
      select public.crm_clientes_por_telefone(${q.telefone ?? null}::text, ${q.email ?? null}::text, ${q.cpf ?? null}::text) as r`));
    return linhas[0]?.r ?? [];
  }

  /** Sempre pela RPC: ela guarda a trava 716 e a deduplicação por telefone. `duplicate` não é erro. */
  async criar(claims: SupabaseClaims, dto: CriarClienteDto): Promise<unknown> {
    const linhas = await this.executar(claims, (tx) => tx.$queryRaw<Array<{ r: unknown }>>(Prisma.sql`
      select public.crm_criar_cliente(${JSON.stringify(dto)}::jsonb) as r`));
    return linhas[0]?.r;
  }

  async converterLead(claims: SupabaseClaims, dto: ConverterLeadDto): Promise<unknown> {
    const dados = { nome: dto.nome, telefone: dto.telefone, email: dto.email };
    const linhas = await this.executar(
      claims,
      (tx) => tx.$queryRaw<Array<{ r: unknown }>>(Prisma.sql`
        select public.crm_converter_lead(${dto.lead_id}::uuid, ${dto.etapa_id ?? null}::uuid, ${JSON.stringify(dados)}::jsonb, ${dto.cliente_id ?? null}::uuid) as r`),
      { forbidden: 'Este lead não é de uma fachada sua, ou o cliente escolhido é de outra conta.' },
    );
    return linhas[0]?.r;
  }

  async obter(claims: SupabaseClaims, id: string): Promise<LinhaCliente> {
    return this.executar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
        select to_jsonb(c) as linha from public.clientes c where c.id = ${id}::uuid`);
      if (linhas.length === 0) throw naoEncontrado();
      return linhas[0].linha;
    });
  }

  async atualizar(claims: SupabaseClaims, id: string, dto: AtualizarClienteDto): Promise<LinhaCliente> {
    const cols = presentes(dto, COLUNAS_EDICAO_CLIENTE);
    if (cols.length === 0) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
    const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dto as Record<string, unknown>)[c]])));
    const alvo = Prisma.raw(cols.join(', '));
    const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
    return this.executar(
      claims,
      async (tx) => {
        const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
          update public.clientes t set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.clientes, ${json}::jsonb) r)
          where t.id = ${id}::uuid returning to_jsonb(t) as linha`);
        if (linhas.length === 0) throw naoEncontrado();
        return linhas[0].linha;
      },
      { semPermissao: 'Você não tem permissão para alterar este cliente.' },
    );
  }

  async moverNoFunil(claims: SupabaseClaims, id: string, dto: MoverClienteDto): Promise<{ id: string }> {
    return this.executar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.clientes set status_funil = ${dto.status_funil}::public.status_funil where id = ${id}::uuid returning id`);
      if (linhas.length === 0) throw naoEncontrado();
      return { id: linhas[0].id };
    });
  }

  async remover(claims: SupabaseClaims, id: string): Promise<void> {
    await this.executar(
      claims,
      async (tx) => {
        const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          delete from public.clientes where id = ${id}::uuid returning id`);
        if (linhas.length === 0) {
          throw erroApi(404, 'cliente_nao_encontrado', 'Nada foi apagado: o cliente não existe ou você não tem permissão.');
        }
      },
      { entidade: 'cliente' },
    );
  }

  /** Troca o vínculo de uma vez (apaga e insere no mesmo run). O imóvel precisa ser da conta do cliente. */
  async definirImovelInteresse(
    claims: SupabaseClaims,
    id: string,
    dto: DefinirImovelInteresseDto,
  ): Promise<{ cliente_id: string; imovel_id: string | null }> {
    const imovelId = dto.imovel_id ?? null;
    return this.executar(
      claims,
      async (tx) => {
        const cliente = await tx.$queryRaw<Array<{ corretor_id: string }>>(Prisma.sql`
          select corretor_id::text as corretor_id from public.clientes where id = ${id}::uuid`);
        if (cliente.length === 0) throw naoEncontrado();
        if (imovelId !== null) {
          // A policy de cliente_imovel não confere o imóvel: a conferência fica aqui.
          const imovel = await tx.$queryRaw<unknown[]>(Prisma.sql`
            select 1 from public.imoveis where id = ${imovelId}::uuid and corretor_id = ${cliente[0].corretor_id}::uuid`);
          if (imovel.length === 0) throw erroApi(404, 'imovel_nao_encontrado', 'Imóvel não encontrado.');
        }
        await tx.$queryRaw(Prisma.sql`delete from public.cliente_imovel where cliente_id = ${id}::uuid`);
        if (imovelId !== null) {
          await tx.$queryRaw(Prisma.sql`
            insert into public.cliente_imovel (cliente_id, imovel_id) values (${id}::uuid, ${imovelId}::uuid) on conflict (cliente_id, imovel_id) do nothing`);
        }
        return { cliente_id: id, imovel_id: imovelId };
      },
      { semPermissao: 'Você não tem permissão para alterar este cliente.' },
    );
  }

  /** Só preenche CPF nulo; zero linhas (já tinha CPF, outra conta, inexistente) não é erro. */
  async completarCpf(claims: SupabaseClaims, id: string, dto: CompletarCpfDto): Promise<{ atualizado: boolean }> {
    const linhas = await this.executar(claims, (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      update public.clientes set cpf = ${dto.cpf}::text where id = ${id}::uuid and cpf is null returning id`));
    return { atualizado: linhas.length > 0 };
  }

  async listarHistorico(claims: SupabaseClaims, id: string): Promise<LinhaHistorico[]> {
    const linhas = await this.executar(claims, (tx) => tx.$queryRaw<Linhas>(Prisma.sql`
      select to_jsonb(h) as linha from public.historico_contatos h where h.cliente_id = ${id}::uuid order by h.data_contato desc, h.id limit ${LIMITE_LISTA}::int`));
    return linhas.map((l) => l.linha);
  }

  /**
   * Sem RETURNING de propósito: RETURNING exigiria passar também na policy de SELECT (só o dono lê),
   * e um membro que pode gravar receberia 403. A resposta sai de now(), o mesmo instante dos defaults.
   */
  async registrarHistorico(claims: SupabaseClaims, clienteId: string, dto: RegistrarHistoricoDto): Promise<LinhaHistorico> {
    const id = randomUUID();
    const direcao = dto.direcao ?? 'OUT';
    const metadata = JSON.stringify(dto.metadata ?? {});
    return this.executar(
      claims,
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          insert into public.historico_contatos (id, cliente_id, tipo, direcao, conteudo, metadata)
          values (${id}::uuid, ${clienteId}::uuid, ${dto.tipo}::public.canal_contato, ${direcao}::public.direcao_contato,
                  ${dto.conteudo}::text, ${metadata}::jsonb)`);
        const linhas = await tx.$queryRaw<Linhas>(Prisma.sql`
          select jsonb_build_object('id', ${id}::uuid, 'cliente_id', ${clienteId}::uuid, 'tipo', ${dto.tipo}::text,
            'direcao', ${direcao}::text, 'conteudo', ${dto.conteudo}::text, 'metadata', ${metadata}::jsonb,
            'data_contato', now(), 'created_at', now()) as linha`);
        return linhas[0].linha;
      },
      { semPermissao: 'Sua conta não tem permissão para registrar contatos deste cliente.' },
    );
  }
}

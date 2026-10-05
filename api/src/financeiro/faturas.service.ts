import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { BaixaDto, CriarFaturaDto, LIMITE_LISTA, VencimentoDto } from './financeiro.dto';
import { erroApi, Linha, traduzirErroBanco, traduzirErroEstorno } from './financeiro.erros';

type Tx = Prisma.TransactionClient;

const faturaNaoEncontrada = () => erroApi(404, 'fatura_nao_encontrada', 'Fatura não encontrada.');

/** Leitura e escrita de faturas no banco (contrato §1.3.B). Tudo no TenantDb, sob a RLS do usuário. */
@Injectable()
export class FaturasService {
  constructor(private readonly db: TenantDb) {}

  async contratosAtivos(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, Prisma.sql`
      select to_jsonb(c)
          || jsonb_build_object(
               'imoveis', (select jsonb_build_object('titulo', i.titulo, 'endereco', i.endereco, 'proprietario_nome', i.proprietario_nome)
                             from public.imoveis i where i.id = c.imovel_id),
               'clientes', (select jsonb_build_object('nome', k.nome) from public.clientes k where k.id = c.cliente_id)
             ) as linha
        from public.contratos c
       where c.status = 'ATIVO'
       order by c.id
       limit ${LIMITE_LISTA}::int`);
  }

  async resumoLocacao(claims: SupabaseClaims): Promise<{ contratos_ativos: number; soma_valor: number }> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ contratos_ativos: number; soma_valor: number }>>(Prisma.sql`
      select count(*)::int as contratos_ativos, coalesce(sum(c.valor), 0)::float8 as soma_valor
        from public.contratos c where c.status = 'ATIVO'`));
    return { contratos_ativos: linhas[0].contratos_ativos, soma_valor: linhas[0].soma_valor };
  }

  async listarFaturas(claims: SupabaseClaims): Promise<Linha[]> {
    return this.listar(claims, Prisma.sql`
      select to_jsonb(f) as linha from public.faturas_aluguel f order by f.data_vencimento, f.id limit ${LIMITE_LISTA}::int`);
  }

  /** ensureFatura: o servidor deriva os valores do contrato; conflito devolve a fatura existente (D10b). */
  async garantirFatura(claims: SupabaseClaims, dto: CriarFaturaDto): Promise<{ id: string; criada: boolean }> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ novo_id: string | null; existente_id: string | null; tem_contrato: boolean }>>(Prisma.sql`
      with c as (
        select id, cliente_id, imovel_id, corretor_id, valor from public.contratos where id = ${dto.contrato_id}::uuid
      ), novo as (
        insert into public.faturas_aluguel
          (contrato_id, cliente_id, imovel_id, corretor_id, valor_aluguel, status, data_vencimento, mes_referencia, gerada_por)
        select c.id, c.cliente_id, c.imovel_id, c.corretor_id, c.valor, 'PENDENTE', ${dto.data_vencimento}::date, ${dto.mes_referencia}::text, 'manual'
          from c
        on conflict (contrato_id, mes_referencia) do nothing
        returning id
      )
      select (select id::text from novo) as novo_id,
             (select f.id::text from public.faturas_aluguel f, c where f.contrato_id = c.id and f.mes_referencia = ${dto.mes_referencia}::text) as existente_id,
             exists(select 1 from c) as tem_contrato`));
    const r = linhas[0];
    if (!r?.tem_contrato) throw erroApi(404, 'contrato_nao_encontrado', 'Contrato não encontrado.');
    if (r.novo_id) return { id: r.novo_id, criada: true };
    if (r.existente_id) return { id: r.existente_id, criada: false };
    throw erroApi(409, 'registro_repetido', 'Já existe uma fatura deste contrato neste mês.');
  }

  alterarVencimento(claims: SupabaseClaims, id: string, dto: VencimentoDto): Promise<Linha> {
    return this.umaLinha(claims, Prisma.sql`
      update public.faturas_aluguel f set data_vencimento = ${dto.data_vencimento}::date
       where f.id = ${id}::uuid returning to_jsonb(f) as linha`);
  }

  /** Baixa manual: o gatilho handle_bill_payment roda com o auth.uid() do usuário e cria repasse e comissão. */
  darBaixa(claims: SupabaseClaims, id: string, dto: BaixaDto): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(Prisma.sql`
        update public.faturas_aluguel f
           set status = 'PAGO', data_pagamento = ${dto.data_pagamento}::date, valor_pago = f.valor_total
         where f.id = ${id}::uuid and f.status <> 'CANCELADO'
        returning to_jsonb(f) as linha`);
      if (linhas[0]) return linhas[0].linha;
      const existe = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        select status from public.faturas_aluguel where id = ${id}::uuid`);
      if (existe.length === 0) throw faturaNaoEncontrada();
      throw erroApi(409, 'fatura_cancelada', 'Fatura cancelada.');
    });
  }

  async estornar(claims: SupabaseClaims, id: string): Promise<{ status: string }> {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        select public.estornar_pagamento_fatura(${id}::uuid) as status`));
      return { status: linhas[0].status };
    } catch (e) {
      traduzirErroEstorno(e);
    }
  }

  cancelar(claims: SupabaseClaims, id: string): Promise<Linha> {
    return this.umaLinha(claims, Prisma.sql`
      update public.faturas_aluguel f set status = 'CANCELADO'
       where f.id = ${id}::uuid returning to_jsonb(f) as linha`);
  }

  reativar(claims: SupabaseClaims, id: string): Promise<Linha> {
    return this.umaLinha(claims, Prisma.sql`
      update public.faturas_aluguel f
         set status = 'PENDENTE', external_id = null, boleto_url = null, boleto_url_asaas = null, pix_qrcode_text = null
       where f.id = ${id}::uuid returning to_jsonb(f) as linha`);
  }

  private umaLinha(claims: SupabaseClaims, consulta: Prisma.Sql): Promise<Linha> {
    return this.rodar(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ linha: Linha }>>(consulta);
      if (linhas.length === 0) throw faturaNaoEncontrada();
      return linhas[0].linha;
    });
  }

  private async listar(claims: SupabaseClaims, consulta: Prisma.Sql): Promise<Linha[]> {
    const linhas = await this.rodar(claims, (tx) => tx.$queryRaw<Array<{ linha: Linha }>>(consulta));
    return linhas.map((l) => l.linha);
  }

  /** Erro do banco é traduzido fora do run: dentro dele a transação já está abortada (25P02). */
  private async rodar<T>(claims: SupabaseClaims, work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.run(claims, work);
    } catch (e) {
      traduzirErroBanco(e);
    }
  }
}

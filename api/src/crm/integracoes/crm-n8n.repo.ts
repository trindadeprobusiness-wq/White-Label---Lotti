import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { FiltrosBusca } from './crm-n8n.regras';

/**
 * Caminho do dono para as integrações do n8n (as Edge Functions crm-* usavam service_role).
 * lotti_find_or_create_cliente tem EXECUTE só para service_role. O corretor de cada operação é o
 * corretor_id do payload (conferido) ou o único corretor da base: toda leitura e escrita é filtrada
 * por ele, nunca por telefone solto.
 */
export interface ClienteDoLead {
  cliente_id?: string | null;
  created?: boolean;
}

export interface CamposClienteDoLead {
  nome?: string;
  email?: string;
  tipoInteresse: string;
  statusFunil: string;
  observacoes?: string;
  tracking: Record<string, unknown>;
}

@Injectable()
export class CrmN8nRepo {
  constructor(private readonly prisma: PrismaService) {}

  async corretorExiste(id: string): Promise<boolean> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.corretores where id = ${id}::uuid`);
    return r.length > 0;
  }

  async corretores(): Promise<string[]> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.corretores limit 2`);
    return r.map((l) => l.id);
  }

  /** Cliente da conta pela chave do telefone (mesma trava do WhatsApp, da captura e do CRM). */
  async encontrarOuCriarCliente(corretorId: string, telefone: string, nome: string, dados: Record<string, unknown>): Promise<ClienteDoLead | null> {
    const r = await this.prisma.$queryRaw<Array<{ r: ClienteDoLead | null }>>(Prisma.sql`
      select public.lotti_find_or_create_cliente(${corretorId}::uuid, ${telefone}::text, ${nome}::text, ${JSON.stringify(dados)}::jsonb) as r`);
    return r[0]?.r ?? null;
  }

  /**
   * Cliente que já existia recebe a qualificação nova. Telefone não muda (o número do cadastro é o que o
   * corretor usa). nome/e-mail/observações só mudam quando vêm preenchidos; tracking_data soma por cima
   * numa instrução só (a Edge lia, juntava no JS e regravava).
   */
  atualizarClienteDoLead(clienteId: string, c: CamposClienteDoLead): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      update public.clientes set
        nome = coalesce(${c.nome ?? null}::text, nome),
        email = coalesce(${c.email ?? null}::text, email),
        tipo_interesse = ${c.tipoInteresse}::public.tipo_interesse,
        status_funil = ${c.statusFunil}::public.status_funil,
        observacoes = coalesce(${c.observacoes ?? null}::text, observacoes),
        ultimo_contato = now(),
        tracking_data = coalesce(tracking_data, '{}'::jsonb) || ${JSON.stringify(c.tracking)}::jsonb
      where id = ${clienteId}::uuid`);
  }

  /** Só vincula imóvel da mesma conta (a Edge vinculava qualquer id e ignorava o erro). */
  vincularImovel(clienteId: string, imovelId: string, corretorId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.cliente_imovel (cliente_id, imovel_id)
      select ${clienteId}::uuid, i.id from public.imoveis i where i.id = ${imovelId}::uuid and i.corretor_id = ${corretorId}::uuid
      on conflict (cliente_id, imovel_id) do nothing`);
  }

  /** FOLLOWUP (LEAD_QUENTE não descreve a ação esperada); prioridade não é coluna de alertas. */
  alertarLeadQuente(clienteId: string, corretorId: string, mensagem: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.alertas (cliente_id, corretor_id, tipo, mensagem, lido)
      values (${clienteId}::uuid, ${corretorId}::uuid, 'FOLLOWUP', ${mensagem}::text, false)`);
  }

  /** Allowlist de colunas: nada de proprietario_*. */
  async buscarImoveis(corretorId: string, f: FiltrosBusca): Promise<Array<Record<string, unknown>>> {
    const r = await this.prisma.$queryRaw<Array<{ imoveis: Array<Record<string, unknown>> }>>(Prisma.sql`
      select coalesce(jsonb_agg(l.linha order by l.created_at desc, l.id), '[]'::jsonb) as imoveis from (
        select jsonb_build_object(
                 'id', i.id, 'titulo', i.titulo,
                 'tipo', case i.finalidade when 'LOCACAO' then 'ALUGUEL' else i.finalidade::text end,
                 'categoria', i.tipo, 'valor', i.valor, 'dormitorios', i.dormitorios, 'bairro', i.bairro,
                 'cidade', i.cidade, 'url_website', null,
                 'fotos', coalesce((select jsonb_agg(p.arquivo_url order by coalesce(p.ordem, 0), p.created_at, p.id)
                                      from public.imovel_fotos p where p.imovel_id = i.id), '[]'::jsonb)) as linha,
               i.created_at, i.id
          from public.imoveis i
         where i.corretor_id = ${corretorId}::uuid and i.status_venda = 'DISPONIVEL' and i.ativo = true
           and (${f.finalidades}::text[] is null or i.finalidade::text = any(${f.finalidades}::text[]))
           and (${f.categoria}::text is null or i.tipo::text = ${f.categoria}::text)
           and (${f.valorMin}::numeric is null or i.valor >= ${f.valorMin}::numeric)
           and (${f.valorMax}::numeric is null or i.valor <= ${f.valorMax}::numeric)
           and (${f.dormitorios}::int is null or i.dormitorios >= ${f.dormitorios}::int)
           and (${f.cidade}::text is null or i.cidade ilike '%' || ${f.cidade}::text || '%')
         order by i.created_at desc, i.id
         limit ${f.limit}::int) l`);
    return r[0]?.imoveis ?? [];
  }

  /** maybeSingle da Edge: exatamente um cliente com esse telefone na conta, senão nenhum. */
  async clientePorTelefone(corretorId: string, telefone: string): Promise<string | null> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.clientes where corretor_id = ${corretorId}::uuid and telefone = ${telefone}::text limit 2`);
    return r.length === 1 ? r[0].id : null;
  }

  async clienteExiste(clienteId: string, corretorId: string | null): Promise<boolean> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.clientes
       where id = ${clienteId}::uuid and (${corretorId}::uuid is null or corretor_id = ${corretorId}::uuid)`);
    return r.length > 0;
  }

  async gravarHistorico(clienteId: string, direcao: string, conteudo: string, metadata: unknown): Promise<string> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      insert into public.historico_contatos (cliente_id, tipo, direcao, conteudo, metadata, data_contato)
      values (${clienteId}::uuid, 'WHATSAPP', ${direcao}::public.direcao_contato, ${conteudo}::text, ${JSON.stringify(metadata)}::jsonb, now())
      returning id::text as id`);
    return r[0].id;
  }

  tocarCliente(clienteId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      update public.clientes set ultimo_contato = now() where id = ${clienteId}::uuid`);
  }
}

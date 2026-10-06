import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { checarCota, ResultadoCota } from '../../ia/cotas';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Caminho do dono para a captura pública de lead (o que a Edge lead-capture fazia com service_role).
 * consume_public_lead_limit e lead_capture_upsert_cliente têm EXECUTE só para service_role (0_init),
 * então nada daqui roda pelo TenantDb. Cada comando é seu próprio $queryRaw/$executeRaw, fora de
 * transação, como as chamadas independentes da Edge: um passo de melhor esforço que falha (vínculo,
 * alerta) não desfaz o cliente já gravado.
 *
 * Nenhum corretor_id vem do visitante: ou é o dono do imóvel do link, ou o único corretor da base.
 */
export interface ResultadoUpsertCliente {
  cliente_id?: string;
  created?: boolean;
}

@Injectable()
export class CapturaLeadRepo {
  constructor(private readonly prisma: PrismaService) {}

  /** 300/min no total e 5 por telefone a cada 10 min (consume_public_lead_limit). */
  async consumirLimite(chave: string): Promise<boolean | null> {
    const r = await this.prisma.$queryRaw<Array<{ ok: boolean | null }>>(Prisma.sql`
      select public.consume_public_lead_limit(${chave}::text) as ok`);
    return typeof r[0]?.ok === 'boolean' ? r[0].ok : null;
  }

  async donoDoImovel(imovelId: string): Promise<string | null> {
    const r = await this.prisma.$queryRaw<Array<{ corretor_id: string }>>(Prisma.sql`
      select corretor_id::text as corretor_id from public.imoveis where id = ${imovelId}::uuid`);
    return r[0]?.corretor_id ?? null;
  }

  /** Até dois corretores: o padrão só vale quando existe exatamente um. */
  async corretores(): Promise<string[]> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.corretores limit 2`);
    return r.map((l) => l.id);
  }

  gravarLeadSemDestino(d: { nome: string; telefone: string; email: string | null; mensagem: string | null; tracking: Record<string, unknown> }): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.leads_sem_destino (nome, telefone, email, mensagem, tracking_data, motivo)
      values (${d.nome}::text, ${d.telefone}::text, ${d.email}::text, ${d.mensagem}::text, ${JSON.stringify(d.tracking)}::jsonb,
              'multiplos_corretores_sem_imovel_id')`);
  }

  /** Busca pela chave do telefone e cadastro numa transação só, no banco (mesma trava do WhatsApp e do CRM). */
  async upsertCliente(corretorId: string, nome: string, telefone: string, email: string | null, tracking: Record<string, unknown>): Promise<ResultadoUpsertCliente | null> {
    const r = await this.prisma.$queryRaw<Array<{ r: ResultadoUpsertCliente | null }>>(Prisma.sql`
      select public.lead_capture_upsert_cliente(${corretorId}::uuid, ${nome}::text, ${telefone}::text, ${email}::text,
                                                 ${JSON.stringify(tracking)}::jsonb) as r`);
    return r[0]?.r ?? null;
  }

  vincularImovel(clienteId: string, imovelId: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.cliente_imovel (cliente_id, imovel_id) values (${clienteId}::uuid, ${imovelId}::uuid)
      on conflict (cliente_id, imovel_id) do nothing`);
  }

  criarAlertaDoLead(d: { clienteId: string; corretorId: string; mensagem: string; metadata: Record<string, unknown> }): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.alertas (cliente_id, corretor_id, tipo, mensagem, lido, metadata)
      values (${d.clienteId}::uuid, ${d.corretorId}::uuid, 'GERAL', ${d.mensagem}::text, false, ${JSON.stringify(d.metadata)}::jsonb)`);
  }

  cota(corretorId: string, recurso: string): Promise<ResultadoCota> {
    return checarCota(this.prisma, corretorId, recurso);
  }

  async avisoDePlanoDesde(corretorId: string, desde: Date): Promise<boolean> {
    const r = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      select id::text as id from public.alertas
       where corretor_id = ${corretorId}::uuid and entidade_tipo = 'plano' and created_at >= ${desde}::timestamptz
       limit 1`);
    return r.length > 0;
  }

  /**
   * A Edge mandava também prioridade 'ALTA', coluna que public.alertas não tem: o insert falhava calado e
   * o aviso nunca aparecia. Aqui vai sem ela, para o corretor de fato ser avisado.
   */
  criarAvisoDePlano(corretorId: string, mensagem: string): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`
      insert into public.alertas (corretor_id, tipo, mensagem, lido, origem, entidade_tipo)
      values (${corretorId}::uuid, 'GERAL', ${mensagem}::text, false, 'sistema', 'plano')`);
  }
}

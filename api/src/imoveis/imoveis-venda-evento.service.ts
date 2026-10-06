import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { erroApi, traduzirErroBanco } from './imoveis.erros';
import { EventoVendaDto } from './imoveis-fotos.dto';

interface ImovelDoEvento {
  id: string;
  titulo: string | null;
  corretor_id: string | null;
  valor: number | null;
  status_venda: string | null;
  tracking_data: Record<string, unknown> | null;
}

interface ClienteDoEvento {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  tracking_data: Record<string, unknown> | null;
}

/** O mesmo payload que o VendaImovelDialog montava (UTMify), agora com os dados lidos do banco. */
export interface PayloadVenda {
  event_name: 'Purchase';
  event_time: number;
  event_id: string;
  value: number;
  currency: 'BRL';
  customer: { first_name: string; last_name: string; email: string; phone: string };
  tracking: Record<string, unknown>;
  metadata: { imovel_id: string; imovel_titulo: string | null; corretor_id: string | null };
}

export function montarPayloadVenda(imovel: ImovelDoEvento, cliente: ClienteDoEvento | null, valor: number | undefined, agora: number): PayloadVenda {
  const partes = (cliente?.nome ?? '').split(' ');
  return {
    event_name: 'Purchase',
    event_time: Math.floor(agora / 1000),
    event_id: `venda_${imovel.id}_${agora}`,
    value: valor || Number(imovel.valor) || 0,
    currency: 'BRL',
    customer: {
      first_name: partes[0] || 'Comprador',
      last_name: partes.slice(1).join(' ') || 'Desconhecido',
      email: cliente?.email || '',
      phone: (cliente?.telefone ?? '').replace(/\D/g, ''),
    },
    tracking: cliente?.tracking_data || imovel.tracking_data || {},
    metadata: { imovel_id: imovel.id, imovel_titulo: imovel.titulo, corretor_id: imovel.corretor_id },
  };
}

/**
 * Fila do evento de conversão da venda (webhook_logs, provider UTMIFY, status PENDING).
 *
 * Antes o front gravava direto e falhava sempre, sem ninguém ver: webhook_logs não tem policy para
 * authenticated (fechada no hotfix 20260707130000) e a coluna endpoint_url nunca existiu. Aqui a leitura
 * do imóvel e do cliente passa pelo TenantDb (só o que a conta enxerga) e a gravação na fila vai pelo
 * PrismaService, o papel da conexão da API, como a fila de um serviço interno.
 */
@Injectable()
export class ImoveisVendaEventoService {
  constructor(private readonly db: TenantDb, private readonly prisma: PrismaService) {}

  async enfileirar(claims: SupabaseClaims, imovelId: string, dto: EventoVendaDto): Promise<{ enfileirado: true; id: string }> {
    let imovel: ImovelDoEvento;
    let cliente: ClienteDoEvento | null = null;
    try {
      ({ imovel, cliente } = await this.db.run(claims, async (tx) => {
        const im = await tx.$queryRaw<Array<{ linha: ImovelDoEvento }>>(Prisma.sql`
          select jsonb_build_object('id', i.id, 'titulo', i.titulo, 'corretor_id', i.corretor_id, 'valor', i.valor,
            'status_venda', i.status_venda, 'tracking_data', i.tracking_data) as linha
          from public.imoveis i where i.id = ${imovelId}::uuid`);
        if (im.length === 0) throw erroApi(404, 'imovel_nao_encontrado', 'Imóvel não encontrado.');
        let cl: ClienteDoEvento | null = null;
        if (dto.cliente_id) {
          const linhas = await tx.$queryRaw<Array<{ linha: ClienteDoEvento }>>(Prisma.sql`
            select jsonb_build_object('nome', c.nome, 'email', c.email, 'telefone', c.telefone, 'tracking_data', c.tracking_data) as linha
            from public.clientes c where c.id = ${dto.cliente_id}::uuid`);
          cl = linhas[0]?.linha ?? null; // cliente que a conta não enxerga entra como comprador desconhecido
        }
        return { imovel: im[0].linha, cliente: cl };
      }));
    } catch (e) {
      traduzirErroBanco(e);
    }
    // Só imóvel vendido gera compra: o evento vem depois de POST /imoveis/:id/venda.
    if (imovel.status_venda !== 'VENDIDO') {
      throw erroApi(409, 'imovel_nao_vendido', 'Registre a venda do imóvel antes do evento de conversão.');
    }
    const payload = montarPayloadVenda(imovel, cliente, dto.valor, Date.now());
    const linhas = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      insert into public.webhook_logs (provider, event_type, payload, status)
      values ('UTMIFY', 'SALE_PURCHASE', ${JSON.stringify(payload)}::jsonb, 'PENDING')
      returning id::text as id`);
    return { enfileirado: true, id: linhas[0].id };
  }
}

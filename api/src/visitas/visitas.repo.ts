import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';

export interface NovoEvento {
  organizationId: string;
  assignedTo: string;
  createdBy: string;
  titulo: string;
  inicio: Date;
  fim: Date;
  clienteId: string | null;
  imovelId: string | null;
  status: 'pending_confirmation' | 'confirmed';
}

export interface NovoAlerta {
  corretorId: string;
  clienteId: string | null;
  mensagem: string;
  metadata: Record<string, unknown>;
}

const GESTORES = ['proprietario', 'administrador', 'gestor'];

/** Todo o SQL da visita. As consultas de usuário passam pelo TenantDb (RLS). */
@Injectable()
export class VisitasRepo {
  constructor(private readonly prisma: PrismaService, private readonly db: TenantDb) {}

  async conversa(conversationId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ corretor_id: string; cliente_id: string | null; contact_name: string | null }>>`
      select corretor_id, cliente_id, contact_name from public.lotti_agent_conversations where id = ${conversationId}::uuid`;
    return rows[0] ? { corretorId: rows[0].corretor_id, clienteId: rows[0].cliente_id, nome: rows[0].contact_name } : null;
  }

  async corretor(corretorId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string; nome: string }>>`
      select user_id, nome from public.corretores where id = ${corretorId}::uuid`;
    return rows[0] ? { userId: rows[0].user_id, nome: rows[0].nome } : null;
  }

  async organizacao(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ organization_id: string }>>`
      select organization_id from public.routine_memberships
      where user_id = ${userId}::uuid and status = 'active' order by created_at limit 1`;
    return rows[0]?.organization_id ?? null;
  }

  async gestores(organizationId: string, excetoUserId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      select co.id from public.routine_memberships m join public.corretores co on co.user_id = m.user_id
      where m.organization_id = ${organizationId}::uuid and m.status = 'active'
        and m.role = any(${GESTORES}::text[]) and m.user_id <> ${excetoUserId}::uuid`;
    return rows.map((r) => r.id);
  }

  async existente(userId: string, inicio: Date, clienteId: string | null) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      select id from public.routine_events
      where assigned_to = ${userId}::uuid and start_at = ${inicio} and source = 'ai'
        and client_id is not distinct from ${clienteId}::uuid and deleted_at is null and status <> 'cancelled'
      limit 1`;
    return rows[0]?.id ?? null;
  }

  conflitos(claims: SupabaseClaims, userId: string, inicio: Date, fim: Date) {
    return this.db.run(claims, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ event_id: string }>>`
        select event_id from public.routine_detect_conflicts(${userId}::uuid, ${inicio}, ${fim}, null)`;
      return rows.length;
    });
  }

  criarEvento(claims: SupabaseClaims, e: NovoEvento) {
    return this.db.run(claims, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        insert into public.routine_events
          (organization_id, assigned_to, created_by, title, activity_type, status, priority, start_at, end_at,
           timezone, visibility, source, client_id, property_id, sync_status)
        values (${e.organizationId}::uuid, ${e.assignedTo}::uuid, ${e.createdBy}::uuid, ${e.titulo}, 'visita', ${e.status}, 'urgent',
           ${e.inicio}, ${e.fim}, 'America/Sao_Paulo', 'team', 'ai', ${e.clienteId}::uuid, ${e.imovelId}::uuid, 'pending')
        returning id`;
      return rows[0].id;
    });
  }

  confirmarEvento(claims: SupabaseClaims, eventId: string) {
    return this.db.run(claims, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        update public.routine_events set status = 'confirmed', sync_status = 'pending'
        where id = ${eventId}::uuid and source = 'ai' and status = 'pending_confirmation' and deleted_at is null
        returning id`;
      return rows.length === 1;
    });
  }

  alertasDaVisita(claims: SupabaseClaims, visitaId: string) {
    return this.db.run(claims, (tx) =>
      tx.$queryRaw<Array<{ id: string; metadata: Record<string, unknown> }>>`
        select id, metadata from public.alertas where metadata->>'visita_id' = ${visitaId} order by created_at`,
    );
  }

  async criarAlertas(alertas: NovoAlerta[]) {
    for (const a of alertas) {
      await this.prisma.$executeRaw`
        insert into public.alertas (corretor_id, cliente_id, tipo, mensagem, metadata, lido, origem, entidade_tipo, entidade_id)
        values (${a.corretorId}::uuid, ${a.clienteId}::uuid, 'GERAL', ${a.mensagem}, ${JSON.stringify(a.metadata)}::jsonb,
                false, 'ia', 'cliente', ${a.clienteId}::uuid)`;
    }
  }

  async marcarLidos(visitaId: string) {
    await this.prisma.$executeRaw`
      update public.alertas set lido = true, read_at = now() where metadata->>'visita_id' = ${visitaId} and lido is not true`;
  }
}

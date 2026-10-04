import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseClaims } from '../prisma/tenant-db';
import { VisitasRepo } from './visitas.repo';

export interface PedidoVisita {
  conversationId: string;
  corretorId: string;
  data: string;
  hora: string;
  imovelId?: string | null;
}

const DURACAO_MS = 60 * 60 * 1000;
const SEM_NOME = 'Contato do WhatsApp';

/** Brasília não tem horário de verão desde 2019: o fuso é sempre -03:00. */
export function inicioEmBrasilia(data: string, hora: string): Date {
  return new Date(`${data}T${hora}:00-03:00`);
}

const quando = (inicio: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(inicio).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
};

const comoCorretor = (userId: string): SupabaseClaims => ({ sub: userId, role: 'authenticated' });

@Injectable()
export class VisitasService {
  constructor(private readonly repo: VisitasRepo) {}

  async solicitar(p: PedidoVisita, agora = new Date()) {
    const inicio = inicioEmBrasilia(p.data, p.hora);
    if (!(inicio.getTime() > agora.getTime())) throw new UnprocessableEntityException('visita_no_passado');
    const fim = new Date(inicio.getTime() + DURACAO_MS);

    const conversa = await this.repo.conversa(p.conversationId);
    if (!conversa) throw new NotFoundException('conversa_inexistente');
    if (conversa.corretorId !== p.corretorId) throw new ForbiddenException();
    const corretor = await this.repo.corretor(p.corretorId);
    if (!corretor) throw new NotFoundException('corretor_inexistente');
    const visitaId = randomUUID();

    const repetida = await this.repo.existente(corretor.userId, inicio, conversa.clienteId);
    if (repetida) return { visitaId, situacao: 'existente' as const, routineEventId: repetida };

    const organizationId = await this.repo.organizacao(corretor.userId);
    if (!organizationId) throw new UnprocessableEntityException('visita_sem_organizacao');
    const nome = conversa.nome?.trim() || SEM_NOME;
    const ocupado = (await this.repo.conflitos(comoCorretor(corretor.userId), corretor.userId, inicio, fim)) > 0;
    const routineEventId = ocupado ? null : await this.repo.criarEvento(comoCorretor(corretor.userId), {
      organizationId, assignedTo: corretor.userId, createdBy: corretor.userId, titulo: `Visita: ${nome}`,
      inicio, fim, clienteId: conversa.clienteId, imovelId: p.imovelId ?? null, status: 'pending_confirmation',
    });

    const metadata = {
      prioridade: 'ALTA', tipo: ocupado ? 'visita_conflito' : 'visita_confirmar', visita_id: visitaId,
      conversation_id: p.conversationId, inicio: inicio.toISOString(), fim: fim.toISOString(),
      imovel_id: p.imovelId ?? null, routine_event_id: routineEventId, corretor_user_id: corretor.userId,
    };
    const mensagem = ocupado
      ? `${nome} pediu visita em ${quando(inicio)}, mas a agenda de ${corretor.nome} está ocupada. Um gestor precisa confirmar ou remarcar.`
      : `${nome} pediu visita em ${quando(inicio)}. Confirme o agendamento.`;
    const destinos = ocupado ? [p.corretorId, ...(await this.repo.gestores(organizationId, corretor.userId))] : [p.corretorId];
    await this.repo.criarAlertas(destinos.map((corretorId) => ({
      corretorId, clienteId: conversa.clienteId, mensagem, metadata,
    })));
    return { visitaId, situacao: ocupado ? ('conflito' as const) : ('agendada' as const), routineEventId };
  }

  async confirmar(claims: SupabaseClaims, visitaId: string) {
    const alertas = await this.repo.alertasDaVisita(claims, visitaId);
    if (alertas.length === 0) throw new NotFoundException('visita_inexistente');
    const m = alertas[0].metadata as Record<string, string | null>;
    let routineEventId: string;
    if (m.routine_event_id) {
      if (!(await this.repo.confirmarEvento(claims, m.routine_event_id))) throw new NotFoundException('visita_ja_resolvida');
      routineEventId = m.routine_event_id;
    } else {
      const assignedTo = String(m.corretor_user_id);
      const organizationId = await this.repo.organizacao(assignedTo);
      if (!organizationId) throw new UnprocessableEntityException('visita_sem_organizacao');
      const conversa = m.conversation_id ? await this.repo.conversa(m.conversation_id) : null;
      routineEventId = await this.repo.criarEvento(claims, {
        organizationId, assignedTo, createdBy: claims.sub, titulo: `Visita: ${conversa?.nome?.trim() || SEM_NOME}`,
        inicio: new Date(String(m.inicio)), fim: new Date(String(m.fim)), clienteId: conversa?.clienteId ?? null,
        imovelId: m.imovel_id ?? null, status: 'confirmed',
      });
    }
    await this.repo.marcarLidos(visitaId);
    return { routineEventId };
  }
}

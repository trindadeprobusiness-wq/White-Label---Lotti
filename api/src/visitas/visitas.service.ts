import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseClaims } from '../prisma/tenant-db';
import { horarioPermitido, horariosLivres, regraDasConfiguracoes } from './horarios';
import { VisitasRepo } from './visitas.repo';

export interface PedidoVisita {
  conversationId: string;
  corretorId: string;
  data: string;
  hora: string;
  imovelId?: string | null;
}

const MIN_MS = 60 * 1000;
const DIA_MS = 24 * 60 * MIN_MS;
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

  /** Conversa e corretor do pedido, conferindo que a conversa é desse corretor. */
  private async contexto(conversationId: string, corretorId: string) {
    const conversa = await this.repo.conversa(conversationId);
    if (!conversa) throw new NotFoundException('conversa_inexistente');
    if (conversa.corretorId !== corretorId) throw new ForbiddenException();
    const corretor = await this.repo.corretor(corretorId);
    if (!corretor) throw new NotFoundException('corretor_inexistente');
    return { conversa, corretor, nome: conversa.nome?.trim() || SEM_NOME };
  }

  /**
   * Horários livres para a IA oferecer (como o consultar_horarios do Clix): expediente e regras da tela do
   * agente, menos a agenda do corretor. A visita que o cliente já tem não ocupa (para poder remarcar).
   */
  async horarios(p: { conversationId: string; corretorId: string }, agora = new Date()) {
    const { conversa, corretor } = await this.contexto(p.conversationId, p.corretorId);
    const regra = regraDasConfiguracoes(await this.repo.configuracao(p.corretorId));
    const visita = await this.repo.visitaFutura(corretor.userId, conversa.clienteId, agora);
    const ate = new Date(agora.getTime() + (regra.dias + 1) * DIA_MS);
    const ocupados = await this.repo.ocupados(comoCorretor(corretor.userId), corretor.userId, agora, ate, visita?.id ?? null);
    return {
      horarios: horariosLivres(regra, ocupados, agora, { porDia: 4, limite: 14 }).map(({ id, rotulo }) => ({ id, rotulo })),
      visitaMarcada: visita ? quando(visita.inicio) : null,
      duracaoMin: regra.duracaoMin,
    };
  }

  /**
   * Marca a visita no horário escolhido (ou remarca a que o cliente já tem). Só vale horário que a IA
   * poderia ter oferecido agora; a gravação confere de novo com trava, e ocupado no meio do caminho volta
   * 'indisponivel' para a IA oferecer outro. Nasce pendente: o corretor confirma.
   */
  async solicitar(p: PedidoVisita, agora = new Date()) {
    const inicio = inicioEmBrasilia(p.data, p.hora);
    if (!(inicio.getTime() > agora.getTime())) throw new UnprocessableEntityException('visita_no_passado');
    const { conversa, corretor, nome } = await this.contexto(p.conversationId, p.corretorId);
    const visitaId = randomUUID();

    const repetida = await this.repo.existente(corretor.userId, inicio, conversa.clienteId);
    if (repetida) return { visitaId, situacao: 'existente' as const, routineEventId: repetida };

    const organizationId = await this.repo.organizacao(corretor.userId);
    if (!organizationId) throw new UnprocessableEntityException('visita_sem_organizacao');
    const regra = regraDasConfiguracoes(await this.repo.configuracao(p.corretorId));
    const fim = new Date(inicio.getTime() + regra.duracaoMin * MIN_MS);
    const anterior = await this.repo.visitaFutura(corretor.userId, conversa.clienteId, agora);
    const ocupados = await this.repo.ocupados(comoCorretor(corretor.userId), corretor.userId,
      new Date(inicio.getTime() - DIA_MS), new Date(fim.getTime() + DIA_MS), anterior?.id ?? null);
    const indisponivel = { visitaId, situacao: 'indisponivel' as const, routineEventId: null };
    if (!horarioPermitido(regra, ocupados, agora, inicio)) return indisponivel;

    const routineEventId = await this.repo.reservar(comoCorretor(corretor.userId), {
      organizationId, assignedTo: corretor.userId, createdBy: corretor.userId, titulo: `Visita: ${nome}`,
      inicio, fim, clienteId: conversa.clienteId, imovelId: p.imovelId ?? null, status: 'pending_confirmation',
    }, anterior?.id ?? null);
    if (!routineEventId) return indisponivel;

    const remarcada = !!anterior;
    await this.repo.criarAlertas([{
      corretorId: p.corretorId, clienteId: conversa.clienteId,
      mensagem: remarcada
        ? `${nome} remarcou a visita de ${quando(anterior.inicio)} para ${quando(inicio)}. Confirme o agendamento.`
        : `${nome} pediu visita em ${quando(inicio)}. Confirme o agendamento.`,
      metadata: {
        prioridade: 'ALTA', tipo: 'visita_confirmar', visita_id: visitaId, conversation_id: p.conversationId,
        inicio: inicio.toISOString(), fim: fim.toISOString(), imovel_id: p.imovelId ?? null,
        routine_event_id: routineEventId, corretor_user_id: corretor.userId,
      },
    }]);
    return { visitaId, situacao: remarcada ? ('remarcada' as const) : ('agendada' as const), routineEventId };
  }

  /** Cliente desmarcou: cancela a visita futura que a IA marcou e libera o horário. */
  async cancelar(p: { conversationId: string; corretorId: string }, agora = new Date()) {
    const { conversa, corretor, nome } = await this.contexto(p.conversationId, p.corretorId);
    const visita = await this.repo.visitaFutura(corretor.userId, conversa.clienteId, agora);
    if (!visita) return { situacao: 'sem_visita' as const };
    if (!(await this.repo.cancelarEvento(comoCorretor(corretor.userId), visita.id))) return { situacao: 'sem_visita' as const };
    await this.repo.criarAlertas([{
      corretorId: p.corretorId, clienteId: conversa.clienteId,
      mensagem: `${nome} cancelou a visita de ${quando(visita.inicio)}.`,
      metadata: { prioridade: 'ALTA', tipo: 'visita_cancelada', conversation_id: p.conversationId, routine_event_id: visita.id },
    }]);
    return { situacao: 'cancelada' as const };
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

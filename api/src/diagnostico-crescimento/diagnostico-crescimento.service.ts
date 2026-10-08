import { Injectable, Logger } from '@nestjs/common';
import {
  buildSummary, getNextQuestion, getQuestions, hasRecoverableContact, parseContact, pruneAnswers, scoreLead, validateAnswer,
} from './motor/engine';
import type { Answers } from './motor/types';
import {
  credenciais, ErroPublico, hashDoIp, origem, registro, resposta, RespostaPublica, sha256, type Snapshot, snapshotPublico,
} from './contratos';
import { lerConfigDiagnostico } from './diagnostico-crescimento.config';
import { enriquecerResumo, type PedidoIa } from './diagnostico-crescimento.ia';
import { drenarNotificacoes, type FetchImpl } from './diagnostico-crescimento.notificacoes';
import { DiagnosticoCrescimentoRepo } from './diagnostico-crescimento.repo';

const ACOES = ['start', 'resume', 'answer', 'complete', 'cta'];

/** O que os testes trocam: o agendador da drenagem (waitUntil da Edge), o fetch do e-mail e o pedido à IA. */
export interface DependenciasDiagnostico {
  agendar?: (tarefa: Promise<unknown>) => void;
  fetchEmail?: FetchImpl;
  pedidoIa?: PedidoIa;
}

function campoDeContato(respostas: Answers, anterior: Record<string, string | null> | null) {
  const name = typeof respostas.name === 'string' ? respostas.name.trim() : anterior?.name ?? 'Contato por e-mail';
  const bruto = typeof respostas.contact === 'string' ? respostas.contact : null;
  if (!bruto) return { name, phone: anterior?.phone ?? null, email: anterior?.email ?? null };
  try {
    const c = parseContact(bruto);
    return { name, phone: c.phone, email: c.email };
  } catch {
    throw new ErroPublico(400, 'Informe um WhatsApp ou e-mail válido.');
  }
}

function payloadDaResposta(respostas: Answers, snapshot: Snapshot, perguntaId: string, editada: boolean) {
  const perguntas = getQuestions(respostas);
  const serializadas = perguntas.flatMap((pergunta, position) => {
    const valor = respostas[pergunta.id];
    if (valor === undefined) return [];
    return [{ question_id: pergunta.id, question: pergunta.prompt, answer: valor, position }];
  });
  const recuperavel = hasRecoverableContact(respostas) || Boolean(snapshot.lead?.email || (snapshot.lead?.phone && snapshot.lead?.name));
  const lead = campoDeContato(respostas, snapshot.lead);
  const score = scoreLead(respostas);
  return {
    question_id: perguntaId, edited: editada, answers: serializadas, recoverable: recuperavel,
    lead: {
      ...lead,
      company: typeof respostas.company === 'string' ? respostas.company : snapshot.lead?.company ?? null,
      segment: typeof respostas.segment === 'string' ? respostas.segment : snapshot.lead?.segment ?? null,
      city: typeof respostas.city === 'string' ? respostas.city : snapshot.lead?.city ?? null,
    },
    score: score.score,
    temperature: score.temperature,
  };
}

function honeypot(valor: unknown): boolean {
  if (valor == null || valor === '') return false;
  if (typeof valor !== 'string' || valor.length > 500) throw new ErroPublico(400, 'Requisição inválida.');
  return true;
}

/** handleError da Edge: mesmos status e textos; o resto vira 500 genérico. */
export function respostaDeErro(e: unknown): RespostaPublica {
  if (e instanceof ErroPublico) return resposta({ error: e.message }, e.status);
  const motivo = e instanceof Error ? e.message : '';
  if (motivo.includes('consent_required')) return resposta({ error: 'Confirme a política de privacidade para continuar.' }, 400);
  if (motivo.includes('invalid_action')) return resposta({ error: 'Ação inválida.' }, 400);
  if (motivo.includes('contact_required')) return resposta({ error: 'Informe um contato antes de concluir.' }, 400);
  if (motivo.includes('diagnostic_database_error')) return resposta({ error: 'Diagnóstico temporariamente indisponível. Tente novamente.' }, 503);
  if (e instanceof Error && (e.message.startsWith('Escolha') || /^(Confira|Informe|Preencha|Me conta|Use)/.test(e.message))) {
    return resposta({ error: e.message.slice(0, 250) }, 400);
  }
  return resposta({ error: 'Não foi possível salvar sua resposta. Tente novamente.' }, 500);
}

/**
 * Porte do handler da Edge Function `diagnostic` (supabase/functions/diagnostic/handler.ts):
 * start/resume/answer/complete/cta com o mesmo motor de regras, o mesmo limite por IP, sessão e
 * global (diagnostic_consume_limit), a mesma transação no banco (diagnostic_mutate) e o mesmo
 * snapshot público. A drenagem das notificações roda em segundo plano, como o waitUntil da Edge.
 */
@Injectable()
export class DiagnosticoCrescimentoService {
  private readonly logger = new Logger('DiagnosticoCrescimento');
  private dependencias: DependenciasDiagnostico = {};

  constructor(private readonly repo: DiagnosticoCrescimentoRepo) {}

  /** Só para testes. */
  usar(dependencias: DependenciasDiagnostico): this {
    this.dependencias = dependencias;
    return this;
  }

  async receber(corpo: unknown, ip: string | null): Promise<RespostaPublica> {
    try {
      const entrada = registro(corpo);
      const { id: sessao, token } = credenciais(entrada);
      const acao = entrada.action;
      if (!ACOES.includes(String(acao))) throw new ErroPublico(400, 'Ação inválida.');
      if (honeypot(entrada.honeypot)) throw new ErroPublico(400, 'Não foi possível iniciar este diagnóstico.');

      const config = lerConfigDiagnostico();
      const tokenHash = sha256(token.toLowerCase());
      const ipHash = hashDoIp(ip, config.segredoLimite);
      const permitido = await this.repo.consumirLimite(ipHash, sessao, acao === 'start');
      if (permitido !== true) throw new ErroPublico(429, 'Muitas tentativas. Aguarde um pouco e tente novamente.');

      let snapshot: Snapshot;
      if (acao === 'start') {
        if (entrada.consent !== true) throw new ErroPublico(400, 'Confirme a política de privacidade para começar.');
        const tracking = origem(entrada.tracking);
        snapshot = await this.repo.mutar(sessao, tokenHash, 'start', null, { consent: true, tracking });
        this.notificar(sessao);
        return resposta(snapshotPublico(snapshot));
      }

      snapshot = await this.repo.mutar(sessao, tokenHash, 'read', null);
      if (acao === 'resume') {
        snapshot = await this.repo.mutar(sessao, tokenHash, 'resume', null);
        return resposta(snapshotPublico(snapshot));
      }
      if (acao === 'cta') {
        snapshot = await this.repo.mutar(sessao, tokenHash, 'cta', null);
        return resposta(snapshotPublico(snapshot, null));
      }
      if (snapshot.session.status === 'completed') return resposta(snapshotPublico(snapshot, null), 409);

      const versao = entrada.version;
      if (typeof versao !== 'number' || !Number.isSafeInteger(versao) || versao !== snapshot.session.version) {
        throw new ErroPublico(409, 'Sua conversa foi atualizada em outra aba. Retome as respostas salvas.');
      }

      if (acao === 'answer') {
        if (typeof entrada.question_id !== 'string' || entrada.question_id.length > 100) throw new ErroPublico(400, 'Pergunta inválida.');
        const pergunta = getQuestions(snapshot.answers).find((q) => q.id === entrada.question_id);
        if (!pergunta) throw new ErroPublico(400, 'Esta etapa não pertence a esta conversa.');
        const proxima = getNextQuestion(snapshot.answers);
        const atual = proxima?.id === pergunta.id;
        const edicao = Object.hasOwn(snapshot.answers, pergunta.id);
        if (!atual && !edicao) throw new ErroPublico(409, 'Responda a etapa anterior antes de continuar.');
        const normalizada = validateAnswer(pergunta, entrada.answer);
        const atualizadas = pruneAnswers(snapshot.answers, pergunta.id, normalizada);
        const payload = payloadDaResposta(atualizadas, snapshot, pergunta.id, edicao);
        // A transação do banco é a fonte da verdade: a tela só avança depois do commit.
        snapshot = await this.repo.mutar(sessao, tokenHash, 'answer', versao, payload);
        if (snapshot.lead?.id || hasRecoverableContact(atualizadas)) this.notificar(sessao);
        return resposta(snapshotPublico(snapshot));
      }

      // complete
      if (getNextQuestion(snapshot.answers)) throw new ErroPublico(400, 'Conclua as perguntas antes de ver o diagnóstico.');
      if (!snapshot.lead?.id) throw new ErroPublico(400, 'Informe um contato antes de concluir.');
      const score = scoreLead(snapshot.answers);
      const regras = buildSummary(snapshot.answers);
      const enriquecido = await enriquecerResumo(this.repo, sessao, snapshot.answers, regras, {
        enabled: config.iaLigada,
        dailyLimit: config.limiteDiarioIa,
        request: this.dependencias.pedidoIa,
      });
      const resumo = { ...enriquecido, summary: enriquecido.summary.slice(0, 1400), user_message: regras.user_message };
      snapshot = await this.repo.mutar(sessao, tokenHash, 'complete', versao, {
        summary: resumo, score: score.score, temperature: score.temperature,
      });
      this.notificar(sessao);
      return resposta(snapshotPublico(snapshot, null));
    } catch (e) {
      return respostaDeErro(e);
    }
  }

  /** Manutenção do worker (diagnostic-notifications): abandono, limpeza dos limites e fila de e-mail. */
  async manutencao(): Promise<{ abandoned: number; notifications: { sent: number; failed: number } }> {
    const abandoned = await this.repo.manutencao();
    const notifications = await this.drenar().catch(() => ({ sent: 0, failed: 0 }));
    return { abandoned, notifications };
  }

  /** A fila inteira (até 10 por vez), para o agendamento 'manutencao-diagnostico'. Sem rede com o interruptor desligado. */
  drenarFila(): Promise<{ sent: number; failed: number }> {
    return this.drenar();
  }

  private drenar(sessao?: string): Promise<{ sent: number; failed: number }> {
    const config = lerConfigDiagnostico();
    return drenarNotificacoes(this.repo, { ...config.email, ligado: config.notificacoesLigadas, fetch: this.dependencias.fetchEmail }, sessao);
  }

  /** Em segundo plano: a resposta ao visitante não espera o e-mail (waitUntil da Edge). */
  private notificar(sessao: string): void {
    const tarefa = this.drenar(sessao).catch(() => {
      this.logger.warn('diagnóstico: drenagem das notificações falhou; fica para a próxima manutenção');
      return { sent: 0, failed: 0 };
    });
    if (this.dependencias.agendar) this.dependencias.agendar(tarefa);
  }
}

import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { lerConfigParceiros } from '../parceiros.config';
import { EventoDiagnosticoDto, SubmeterDiagnosticoDto } from '../parceiros.dto';
import { erroPg, ERROS } from '../parceiros.erros';
import { questions, scoreDiagnostic, validateAnswers } from './diagnostico';
import { DiagnosticoRepo } from './diagnostico.repo';

export type RespostaDiagnostico = { success: true; result?: ReturnType<typeof scoreDiagnostic> };

const CHAVES_ATRIBUICAO = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'landing_page', 'referrer'] as const;
const OPCOES_PIPE = { whitelist: true, forbidNonWhitelisted: true };
const TELEFONE_LOCAL = /^[1-9]\d{9,10}$/;

function hmac(secret: string, valor: string): string {
  return createHmac('sha256', secret).update(valor).digest('hex');
}

const texto = (valor: unknown, max: number): string => (
  typeof valor === 'string' && valor.trim().length <= max ? valor.trim() : ''
);

/**
 * Porte de commercial-diagnostic (D1), no caminho do dono.
 *
 * O `action` é lido antes da validação e o DTO correspondente é validado à mão (mesmo truque do
 * webhook do financeiro). Sem PUBLIC_RATE_LIMIT_SECRET a rota responde 503 claro: hoje o fallback era
 * a service key, que a API não lê (contrato §6.3).
 */
@Injectable()
export class DiagnosticoService {
  private readonly logger = new Logger('Diagnostico');

  constructor(private readonly repo: DiagnosticoRepo) {}

  async receber(corpo: Record<string, unknown>): Promise<RespostaDiagnostico> {
    const { action, ...resto } = corpo ?? {};
    if (action !== 'event' && action !== 'submit') throw ERROS.acaoInvalida();
    const secret = lerConfigParceiros().limitePublicoSecret;
    if (!secret) throw ERROS.diagnosticoNaoConfigurado();
    if (action === 'event') return this.evento(await this.validar(EventoDiagnosticoDto, resto), secret);
    return this.submeter(await this.validar(SubmeterDiagnosticoDto, resto), secret);
  }

  private async validar<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): Promise<T> {
    const instancia = plainToInstance(Classe, corpo, { enableImplicitConversion: false });
    const erros = await validate(instancia, OPCOES_PIPE);
    if (erros.length > 0) throw ERROS.dadosInvalidos();
    return instancia;
  }

  private async evento(dto: EventoDiagnosticoDto, secret: string): Promise<RespostaDiagnostico> {
    const step = dto.step ? dto.step : null;
    if (step && !questions.some((q) => q.id === step)) throw ERROS.eventoInvalido();
    const chave = hmac(secret, `diagnostic-event:${dto.session_id}`);
    if (!(await this.limite(() => this.repo.consumirLimite('commercial-diagnostic-event', chave, 50, 3600)))) {
      throw ERROS.muitasTentativas();
    }
    await this.repo.registrarEvento(dto.session_id, dto.event, step);
    if (dto.event === 'cta_clicked') {
      try {
        await this.repo.marcarCtaClicado(dto.session_id);
      } catch (e) {
        this.logger.warn(`diagnostico-comercial: cta não carimbado (${erroPg(e)?.sqlstate ?? 'erro'})`);
      }
    }
    return { success: true };
  }

  private async submeter(dto: SubmeterDiagnosticoDto, secret: string): Promise<RespostaDiagnostico> {
    if (dto.consent !== true) throw ERROS.consentimentoAusente();
    const name = texto(dto.name, 120);
    const digitos = texto(dto.phone, 32).replace(/\D/g, '');
    const local = digitos.startsWith('55') && [12, 13].includes(digitos.length) ? digitos.slice(2) : digitos;
    const email = texto(dto.email, 254);
    const city = texto(dto.city, 120);
    const company = texto(dto.company, 120);
    if (name.length < 2 || !TELEFONE_LOCAL.test(local)) throw ERROS.contatoInvalido();

    let answers;
    try {
      answers = validateAnswers(dto.answers);
    } catch (e) {
      // Texto nosso, em português, vindo da função portada — não é texto do Postgres.
      throw ERROS.respostasInvalidas(e instanceof Error ? e.message : 'Respostas inválidas.');
    }

    const phone = `55${local}`;
    if (!(await this.limite(() => this.repo.consumirLimiteDeLead(hmac(secret, `lead:${phone}`))))) {
      throw ERROS.muitasTentativas();
    }

    const attribution: Record<string, string> = {};
    if (dto.attribution && typeof dto.attribution === 'object' && !Array.isArray(dto.attribution)) {
      const bruto = dto.attribution as Record<string, unknown>;
      for (const chave of CHAVES_ATRIBUICAO) {
        const valor = texto(bruto[chave], 300);
        if (valor) attribution[chave] = valor;
      }
    }

    const scored = scoreDiagnostic(answers);
    let gravou = true;
    try {
      await this.repo.gravar({
        sessionId: dto.session_id,
        name,
        phone,
        email: email || null,
        city: city || null,
        company: company || null,
        answers,
        attribution,
        scores: scored,
        dominantProblem: scored.dominant_problem,
        secondaryProblems: scored.secondary_problems,
        urgencyLabel: scored.urgency_label,
        profileLabel: scored.profile_label,
        recommendedNextStep: scored.recommended_next_step,
      });
    } catch (e) {
      // 23505 em commercial_diagnostics_session_id_key é reenvio da mesma sessão: engolido, como hoje.
      if (erroPg(e)?.sqlstate !== '23505') throw e;
      gravou = false;
    }

    if (gravou) {
      await this.repo.registrarEvento(dto.session_id, 'diagnostic_completed', null);
      if (scored.commercial_fit_score >= 60) await this.repo.registrarEvento(dto.session_id, 'qualified_lead', null);
    }
    return { success: true, result: scored };
  }

  /** Limite negado → false; erro do limite → 503 claro (a tabela de limite não pode estar quebrada). */
  private async limite(consumir: () => Promise<boolean>): Promise<boolean> {
    try {
      return await consumir();
    } catch {
      throw ERROS.diagnosticoNaoConfigurado();
    }
  }
}

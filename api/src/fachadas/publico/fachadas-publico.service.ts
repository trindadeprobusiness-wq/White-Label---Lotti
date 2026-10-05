import { Injectable } from '@nestjs/common';
import { ERROS, OpcoesErro, traduzirErroBanco } from '../fachadas.erros';
import { EnviarLeadDto } from './fachadas-publico.dto';
import { FachadaPublica, FachadasPublicoRepo } from './fachadas-publico.repo';

/** 42501 nas rotas públicas vira 404: a resposta não revela se a fachada existe (contrato §0.4). */
const OPCOES: OpcoesErro = { publico: true };

@Injectable()
export class FachadasPublicoService {
  constructor(private readonly repo: FachadasPublicoRepo) {}

  private async rodar<T>(trabalho: () => Promise<T>): Promise<T> {
    try {
      return await trabalho();
    } catch (e) {
      traduzirErroBanco(e, OPCOES);
    }
  }

  /** P1. Fachada inexistente, inativa ou barrada por RLS dão o MESMO 404 — é o 404 da Edge Function. */
  async verFachada(id: string): Promise<FachadaPublica> {
    const r = await this.rodar(() => this.repo.verFachada(id));
    if (!r) throw ERROS.fachadaIndisponivel();
    return r;
  }

  /** P2. O user_agent vem do cabeçalho da requisição, não do corpo (contrato §2.2, §6.4). */
  async registrarEscaneamento(id: string, userAgent: string | null): Promise<void> {
    await this.rodar(() => this.repo.registrarEscaneamento(id, userAgent));
  }

  /** P3. Não devolve a linha: anon não pode ler fachada_leads e o front só olha se houve erro. */
  async enviarLead(id: string, dto: EnviarLeadDto): Promise<{ registrado: true }> {
    await this.rodar(() => this.repo.criarLead(id, dto));
    return { registrado: true };
  }
}

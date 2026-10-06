import { Injectable, Logger } from '@nestjs/common';
import {
  chaveLimiteLead, ErroLead, erroLeadHttp, integracaoConfiavel, lerLead, MSG_INDISPONIVEL, respostaLead,
} from './captura-lead.regras';
import { CapturaLeadRepo } from './captura-lead.repo';
import { segredoN8nConfigurado } from './segredo-n8n';

export const COTA_LEADS = 'leads_qualificados_monthly';
const AVISO_COTA = 'O contato foi salvo. A qualificação automática está indisponível no plano ou a cota acabou.';

export interface EntradaCaptura {
  /** Valor cru do cabeçalho x-n8n-secret (null quando ausente). */
  segredo: string | null;
  /** ?imovel_id= da URL do webhook. */
  imovelIdDaQuery: string | null;
  /** Lê o corpo só depois de conferir o segredo, como a Edge. */
  lerCorpo: () => Promise<unknown>;
}

/**
 * Porte da Edge Function lead-capture (handler.ts), passo a passo e com as mesmas respostas:
 *  1. integração autenticada (x-n8n-secret) ou visitante; segredo errado → 401 antes do banco;
 *  2. corpo (16 KiB) e validação; 3. limite por telefone (HMAC com PUBLIC_RATE_LIMIT_SECRET);
 *  4. dono = corretor do imóvel do link, ou o único corretor; havendo mais de um sem imóvel, o lead
 *     vai para leads_sem_destino e a resposta segue 200;
 *  5. cliente por telefone (lead_capture_upsert_cliente: quem já existe não tem nome/e-mail trocados);
 *  6. vínculo com o imóvel e alerta (melhor esforço); 7. cota só para a integração, sem debitar.
 * O visitante recebe sempre a mesma confirmação genérica; os detalhes só vão para a integração.
 */
@Injectable()
export class CapturaLeadService {
  private readonly logger = new Logger('CapturaLead');

  constructor(private readonly repo: CapturaLeadRepo) {}

  async capturar(entrada: EntradaCaptura): Promise<Record<string, unknown>> {
    try {
      return await this.executar(entrada);
    } catch (e) {
      const http = erroLeadHttp(e);
      if (http.getStatus() === 500) this.logger.error('lead-capture: falha interna ao receber contato');
      throw http;
    }
  }

  private async executar(entrada: EntradaCaptura): Promise<Record<string, unknown>> {
    const confiavel = integracaoConfiavel(entrada.segredo, segredoN8nConfigurado());
    const lead = lerLead(await entrada.lerCorpo(), entrada.imovelIdDaQuery);
    await this.consumirLimite(lead.telefone);

    const { nome, telefone, email, mensagem, origem, assunto } = lead;
    const tracking: Record<string, unknown> = {
      ...lead.tracking, origem: origem || 'landing_page', assunto, mensagem, captured_at: new Date().toISOString(),
    };

    let corretorId: string | undefined;
    if (lead.imovelId) {
      const dono = await this.repo.donoDoImovel(lead.imovelId);
      if (!dono) throw new ErroLead(400, 'Imóvel inválido.');
      corretorId = dono;
    }

    if (!corretorId) {
      const corretores = await this.repo.corretores();
      if (!corretores.length) throw new Error('nenhum corretor para atribuir');
      if (corretores.length > 1) {
        // Fail-closed: atribuir ao corretor errado seria pior. O lead fica guardado para triagem e o
        // formulário recebe 200 (quem preencheu não tem culpa nem conserto).
        this.logger.error('lead-capture: lead sem destinatário (mais de um corretor e sem imovel_id)');
        await this.repo.gravarLeadSemDestino({ nome, telefone, email: email ?? null, mensagem: mensagem ?? null, tracking });
        return respostaLead(confiavel, { pendente_triagem: true });
      }
      corretorId = corretores[0];
    }

    const cliente = await this.repo.upsertCliente(corretorId, nome, telefone, email ?? null, tracking);
    if (!cliente?.cliente_id) throw new Error('lead_capture_upsert_cliente sem cliente');
    const clienteId = cliente.cliente_id;
    const novo = cliente.created === true;

    if (lead.imovelId) {
      try {
        await this.repo.vincularImovel(clienteId, lead.imovelId);
      } catch {
        this.logger.warn('lead-capture: vínculo com o imóvel não gravado');
      }
    }

    try {
      await this.repo.criarAlertaDoLead({
        clienteId,
        corretorId,
        mensagem: `${novo ? 'NOVO lead' : 'Retorno de lead'} do site: ${nome} (${telefone}) — ${origem || assunto || 'direto'}`,
        metadata: { lead_type: novo ? 'new' : 'returning', source: origem || 'landing_page', tracking },
      });
    } catch {
      this.logger.warn('lead-capture: alerta do lead não gravado');
    }

    // Captura não executa IA e não debita cota. A integração recebe a indicação; visitante nem consulta.
    const cota = confiavel ? await this.repo.cota(corretorId, COTA_LEADS) : null;
    if (cota && !cota.permitido) await this.avisarCota(corretorId);

    return respostaLead(confiavel, { cliente_id: clienteId, is_new: novo, qualificar_com_ia: cota?.permitido ?? false });
  }

  /** consumeLeadLimit: sem segredo ou com o limitador quebrado → 503 sem gravar; excedido → 429. */
  private async consumirLimite(telefone: string): Promise<void> {
    const segredo = process.env.PUBLIC_RATE_LIMIT_SECRET?.trim();
    if (!segredo) throw new ErroLead(503, MSG_INDISPONIVEL);
    let ok: boolean | null;
    try {
      ok = await this.repo.consumirLimite(chaveLimiteLead(segredo, telefone));
    } catch {
      throw new ErroLead(503, MSG_INDISPONIVEL);
    }
    if (ok === null) throw new ErroLead(503, MSG_INDISPONIVEL);
    if (!ok) throw new ErroLead(429, 'Muitas tentativas. Aguarde alguns minutos.');
  }

  /** Um aviso de plano por mês (início do mês em UTC, o relógio da Edge). Falha aqui nunca derruba o lead. */
  private async avisarCota(corretorId: string): Promise<void> {
    try {
      const agora = new Date();
      const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
      if (!(await this.repo.avisoDePlanoDesde(corretorId, inicioMes))) await this.repo.criarAvisoDePlano(corretorId, AVISO_COTA);
    } catch {
      this.logger.warn('lead-capture: aviso de cota não gravado (lead segue gravado)');
    }
  }
}

import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  Corpo, corpoObjeto, erroN8n, erroSimples, interesseDoLead, lerFiltrosBusca, MSG_FALHA_INTERNA, statusDoLead, textoN8n,
  trackingDoLead, UUID_PATTERN,
} from './crm-n8n.regras';
import { CrmN8nRepo } from './crm-n8n.repo';

type FormatoErro = (status: number, error: string) => HttpException;

/**
 * Porte das Edge Functions do n8n (crm-upsert-lead, crm-buscar-imoveis, crm-anexar-historico), com
 * as mesmas entradas e respostas. O segredo é conferido antes, pelo N8nSegredoGuard.
 *
 * Diferença deliberada: erro inesperado (banco) responde 500 com texto genérico; a Edge devolvia 400
 * com a mensagem crua do Postgres.
 */
@Injectable()
export class CrmN8nService {
  private readonly logger = new Logger('CrmN8n');

  constructor(private readonly repo: CrmN8nRepo) {}

  private async rodar<T>(nome: string, trabalho: () => Promise<T>): Promise<T> {
    try {
      return await trabalho();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`${nome}: falha interna`);
      throw erroN8n(500, MSG_FALHA_INTERNA);
    }
  }

  /**
   * corretor_id explícito (precisa existir) ou o único corretor da base. Com mais de um e sem
   * corretor_id, falha alto em vez de adivinhar (o lead cairia no tenant errado).
   */
  private async resolverCorretor(informado: unknown, erro: FormatoErro, ondeInformar: 'payload' | 'query'): Promise<string> {
    const id = textoN8n(informado);
    if (id) {
      if (!UUID_PATTERN.test(id) || !(await this.repo.corretorExiste(id))) throw erro(400, 'corretor_id informado não existe');
      return id.toLowerCase();
    }
    const corretores = await this.repo.corretores();
    if (!corretores.length) throw erro(500, 'nenhum corretor cadastrado');
    if (corretores.length > 1) {
      throw erro(400, `Há mais de um corretor cadastrado: informe corretor_id ${ondeInformar === 'payload' ? 'no payload' : 'na query'}.`);
    }
    return corretores[0];
  }

  /** POST crm-upsert-lead: um cliente por telefone na conta; vínculo com imóvel e alerta do lead quente. */
  upsertLead(corpo: unknown) {
    return this.rodar('crm-upsert-lead', async () => {
      const p: Corpo = corpoObjeto(corpo);
      const telefone = textoN8n(p.telefone);
      if (!telefone) throw erroSimples(400, 'telefone é obrigatório');
      const corretorId = await this.resolverCorretor(p.corretor_id, erroSimples, 'payload');

      const nome = textoN8n(p.nome) || undefined;
      const email = textoN8n(p.email);
      const observacoes = textoN8n(p.observacoes);
      const tipoInteresse = interesseDoLead(p.tipo_interesse);
      const statusFunil = statusDoLead(p.classificacao);
      const tracking = trackingDoLead(p);

      const r = await this.repo.encontrarOuCriarCliente(corretorId, telefone, nome ?? 'Lead WhatsApp', {
        email, tipo_interesse: tipoInteresse, status_funil: statusFunil, observacoes, tracking_data: tracking,
        ultimo_contato: new Date().toISOString(),
      });
      if (!r?.cliente_id) throw erroN8n(400, 'Não foi possível salvar o cliente do lead.');
      const clienteId = r.cliente_id;
      if (!r.created) {
        // Nome só é trocado quando o n8n manda um, nunca pelo genérico "Lead WhatsApp".
        await this.repo.atualizarClienteDoLead(clienteId, { nome, email, tipoInteresse, statusFunil, observacoes, tracking });
      }

      const imovel = textoN8n(p.imovel_interesse);
      if (imovel && UUID_PATTERN.test(imovel)) {
        try {
          await this.repo.vincularImovel(clienteId, imovel, corretorId);
        } catch {
          this.logger.warn('crm-upsert-lead: vínculo com o imóvel não gravado');
        }
      }

      if (p.classificacao === 'quente') {
        try {
          await this.repo.alertarLeadQuente(clienteId, corretorId, `Lead quente via WhatsApp: ${nome ?? 'Lead WhatsApp'} (${telefone})`);
        } catch {
          this.logger.warn('crm-upsert-lead: alerta do lead quente não gravado');
        }
      }

      return { success: true, cliente_id: clienteId, classificacao: p.classificacao };
    });
  }

  /** GET crm-buscar-imoveis: imóveis DISPONIVEL e ativos da conta, com os filtros da query. */
  buscarImoveis(consulta: Record<string, unknown>) {
    return this.rodar('crm-buscar-imoveis', async () => {
      const filtros = lerFiltrosBusca(consulta ?? {});
      const corretorId = await this.resolverCorretor(filtros.corretorId, erroN8n, 'query');
      const imoveis = await this.repo.buscarImoveis(corretorId, filtros);
      return { success: true, total: imoveis.length, imoveis };
    });
  }

  /** POST crm-anexar-historico: grava a mensagem do WhatsApp na timeline do cliente. */
  anexarHistorico(corpo: unknown) {
    return this.rodar('crm-anexar-historico', async () => {
      const p: Corpo = corpoObjeto(corpo);
      const mensagem = textoN8n(p.mensagem);
      if (!mensagem) throw erroSimples(400, 'mensagem é obrigatória');

      const corretorId = textoN8n(p.corretor_id) || null;
      if (corretorId && !UUID_PATTERN.test(corretorId)) throw erroSimples(404, 'cliente não encontrado; chame crm-upsert-lead antes');
      let clienteId = textoN8n(p.cliente_id) || null;
      const telefone = textoN8n(p.telefone);
      if (!clienteId && telefone) {
        // Busca por telefone só dentro da conta: sem corretor_id, a conversa de um cliente podia cair na
        // timeline de outro corretor com o mesmo número. Fail-closed.
        if (!corretorId) {
          throw erroSimples(400, 'corretor_id é obrigatório quando o cliente é buscado por telefone. '
            + 'Envie corretor_id (o mesmo usado no crm-upsert-lead) ou envie cliente_id direto.');
        }
        clienteId = await this.repo.clientePorTelefone(corretorId, telefone);
      }
      const naoEncontrado = () => erroSimples(404, 'cliente não encontrado; chame crm-upsert-lead antes');
      if (!clienteId) throw naoEncontrado();
      if (!UUID_PATTERN.test(clienteId) || !(await this.repo.clienteExiste(clienteId, corretorId))) throw naoEncontrado();

      const direcao = p.direcao;
      if (direcao !== 'IN' && direcao !== 'OUT') throw erroN8n(400, 'direcao deve ser IN ou OUT');

      const historicoId = await this.repo.gravarHistorico(clienteId, direcao, mensagem, p.metadata ?? {});
      await this.repo.tocarCliente(clienteId);
      return { success: true, historico_id: historicoId, cliente_id: clienteId };
    });
  }
}

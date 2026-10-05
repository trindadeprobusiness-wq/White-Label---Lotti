import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FORMATO_UUID } from '../financeiro.dto';
import { erroApi, erroPg } from '../financeiro.erros';
import { ServicoDb } from '../servico-db';
import { chaveCifra } from './asaas.config';
import { decifrar } from './asaas-crypto';
import { chaveDestino, idDoEvento, moedaBR, tokensIguais } from './asaas-regras';

/** Porte de supabase/functions/asaas-webhook (contrato §2.4). Tudo pelo ServicoDb (service_role, auth.uid() NULL). */

type Tx = Prisma.TransactionClient;
type Registro = Record<string, any>;

interface Desfecho {
  status: 'PROCESSED' | 'IGNORED' | 'FAILED';
  last_error?: string;
  /** Alerta de recebimento "sem bloquear", gravado num run separado depois do principal. */
  alertaPagamento?: { fatura: Registro; payment: Registro };
  /** Alertas de transferência: também fora do run principal (na Edge o erro do rpc era ignorado). */
  alertas?: Alerta[];
}

interface Alerta {
  corretorId: string;
  tipo: 'PAGAMENTO' | 'TRANSFERENCIA';
  mensagem: string;
  entidadeTipo: string;
  entidadeId: string;
  metadata: Record<string, unknown>;
  prioridade: 'MEDIA' | 'ALTA';
}

/** Escrita que precisava afetar linha e não afetou: aborta o run (D4). */
class EscritaSemEfeito extends Error {
  constructor(readonly codigo: string) {
    super(codigo);
  }
}

const recusado = () => erroApi(401, 'webhook_recusado', 'Não autorizado.');

@Injectable()
export class AsaasWebhookService {
  private readonly logger = new Logger(AsaasWebhookService.name);

  constructor(private readonly servico: ServicoDb) {}

  /** Agenda o processamento fora da resposta (no lugar do EdgeRuntime.waitUntil). Substituível nos testes. */
  agendar = (eventRowId: string): void => {
    setImmediate(() => { void this.processar(eventRowId); });
  };

  async receber(
    slug: string | null | undefined, cabecalhos: Record<string, unknown>, corpo: unknown,
  ): Promise<{ received: true; duplicate?: true }> {
    const chave = chaveCifra();
    const dono = await this.origem(slug, cabecalhos, chave);

    const payload = (corpo && typeof corpo === 'object' ? corpo : {}) as Registro;
    const tipo = typeof payload.event === 'string' ? payload.event : 'UNKNOWN';
    const paymentId = payload.payment?.id != null ? String(payload.payment.id) : null;
    const eventId = idDoEvento(payload);

    let id: string;
    try {
      const linhas = await this.servico.run((tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        insert into public.asaas_webhook_events (event_id, event_type, payment_id, payload, status, corretor_id)
        values (${eventId}::text, ${tipo}::text, ${paymentId}::text, ${JSON.stringify(payload)}::jsonb, 'RECEIVED', ${dono}::uuid)
        returning id::text as id`));
      id = linhas[0].id;
    } catch (e) {
      if (erroPg(e)?.sqlstate === '23505') return { received: true, duplicate: true };
      this.logger.error({ codigo: 'webhook_gravacao_falhou', event_type: tipo, sqlstate: erroPg(e)?.sqlstate ?? null });
      throw e;
    }
    this.agendar(id);
    return { received: true };
  }

  /** Slug + token da conexão (D5: sem slug não existe mais o webhook global). Devolve o corretor dono. */
  private async origem(slug: string | null | undefined, cabecalhos: Record<string, unknown>, chave: string): Promise<string> {
    if (!slug) throw recusado();
    const cab = (n: string) => (typeof cabecalhos[n] === 'string' ? (cabecalhos[n] as string) : null);
    const fornecido = cab('asaas-access-token') ?? cab('x-hook-token');
    const linhas = await this.servico.run((tx) => tx.$queryRaw<Array<{ corretor_id: string; webhook_token_ciphertext: string | null }>>(Prisma.sql`
      select c.corretor_id::text as corretor_id, s.webhook_token_ciphertext from public.asaas_conexoes c
        join public.asaas_conexao_segredos s on s.conexao_id = c.id where c.webhook_slug = ${slug}::text`));
    const conexao = linhas[0];
    if (!conexao?.webhook_token_ciphertext) throw recusado();
    let esperado: string;
    try {
      esperado = decifrar(conexao.webhook_token_ciphertext, chave);
    } catch {
      throw recusado();
    }
    if (!tokensIguais(fornecido, esperado)) throw recusado();
    return conexao.corretor_id;
  }

  /** Porte de processEvent: reserva condicional, lógica num run e o desfecho num terceiro run. Nunca lança. */
  async processar(eventRowId: string): Promise<void> {
    let tipo = 'UNKNOWN';
    try {
      const reservados = await this.servico.run((tx) => tx.$queryRaw<Array<{ event_type: string; payload: Registro; corretor_id: string | null }>>(Prisma.sql`
        update public.asaas_webhook_events set status = 'PROCESSING', attempts = attempts + 1
         where id = ${eventRowId}::uuid and status in ('RECEIVED', 'FAILED')
        returning event_type, payload, corretor_id::text as corretor_id`));
      const evento = reservados[0];
      if (!evento) return; // outro processador já pegou
      tipo = evento.event_type;

      let desfecho: Desfecho;
      try {
        desfecho = await this.servico.run((tx) => this.logica(tx, eventRowId, evento.event_type, evento.payload ?? {}, evento.corretor_id));
      } catch (e) {
        const codigo = e instanceof EscritaSemEfeito ? e.codigo : `erro_processamento:${erroPg(e)?.sqlstate ?? 'interno'}`;
        this.logger.error({ codigo, event_type: tipo });
        desfecho = { status: 'FAILED', last_error: codigo };
      }

      // Notificação é conveniência: falha aqui não muda o desfecho do evento.
      if (desfecho.alertaPagamento) {
        const { fatura, payment } = desfecho.alertaPagamento;
        try {
          await this.servico.run((tx) => this.alertarRecebimento(tx, fatura, payment));
        } catch (e) {
          this.logger.warn({ codigo: 'alerta_recebimento_falhou', event_type: tipo, sqlstate: erroPg(e)?.sqlstate ?? null });
        }
      }
      for (const alerta of desfecho.alertas ?? []) {
        try {
          await this.servico.run((tx) => this.registrarAlerta(tx, alerta));
        } catch (e) {
          this.logger.warn({ codigo: 'alerta_transferencia_falhou', event_type: tipo, sqlstate: erroPg(e)?.sqlstate ?? null });
        }
      }

      const ultimoErro = desfecho.last_error ?? null;
      await this.servico.run((tx) => tx.$executeRaw(Prisma.sql`
        update public.asaas_webhook_events
           set status = ${desfecho.status}::text, processed_at = now(),
               last_error = case when ${ultimoErro}::text is null then last_error else ${ultimoErro}::text end
         where id = ${eventRowId}::uuid`));
    } catch (e) {
      this.logger.error({ codigo: e instanceof HttpException ? 'webhook_http' : 'webhook_processar_falhou', event_type: tipo });
    }
  }

  private async logica(tx: Tx, eventRowId: string, evento: string, payload: Registro, dono: string | null): Promise<Desfecho> {
    if (evento.startsWith('TRANSFER_')) return this.transferencia(tx, eventRowId, evento, payload, dono);

    const payment = payload.payment as Registro | undefined;
    if (!payment?.id) return { status: 'IGNORED' };
    const paymentId = String(payment.id);

    // O filtro do dono entra NA consulta, não só na checagem posterior.
    let fatura = (await tx.$queryRaw<Array<{ f: Registro }>>(Prisma.sql`
      select to_jsonb(f) as f from public.faturas_aluguel f
       where f.external_id = ${paymentId}::text and (${dono}::uuid is null or f.corretor_id = ${dono}::uuid)`))[0]?.f ?? null;
    const referencia = typeof payment.externalReference === 'string' ? payment.externalReference : null;
    if (!fatura && referencia && FORMATO_UUID.test(referencia)) {
      fatura = (await tx.$queryRaw<Array<{ f: Registro }>>(Prisma.sql`
        select to_jsonb(f) as f from public.faturas_aluguel f
         where f.id = ${referencia}::uuid and (${dono}::uuid is null or f.corretor_id = ${dono}::uuid)`))[0]?.f ?? null;
    }
    if (!fatura) return { status: 'FAILED', last_error: 'fatura_nao_encontrada' };
    if (dono && fatura.corretor_id !== dono) return { status: 'FAILED', last_error: 'fatura_de_outra_conta' };

    await this.exigir(tx.$executeRaw(Prisma.sql`
      update public.asaas_webhook_events set corretor_id = ${fatura.corretor_id}::uuid, payment_id = ${paymentId}::text
       where id = ${eventRowId}::uuid`), 'evento_sumiu');

    const status = payment.status != null ? String(payment.status) : null;
    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED' || evento === 'PAYMENT_RECEIVED_IN_CASH') {
      if (fatura.status === 'PAGO') return { status: 'IGNORED' };
      // O gatilho handle_bill_payment cria repasse, comissão e auditoria (ator 'system': auth.uid() é NULL).
      await this.exigir(tx.$executeRaw(Prisma.sql`
        update public.faturas_aluguel
           set status = 'PAGO', valor_pago = ${payment.value ?? null}::numeric, data_pagamento = ${payment.paymentDate ?? null}::date,
               data_credito = ${payment.creditDate ?? null}::date, asaas_status = ${status}::text,
               recibo_url = ${payment.transactionReceiptUrl ?? null}::text, raw_payload = ${JSON.stringify(payload)}::jsonb
         where id = ${fatura.id}::uuid`), 'fatura_nao_atualizada');
      return { status: 'PROCESSED', alertaPagamento: { fatura, payment } };
    }
    if (evento === 'PAYMENT_OVERDUE') {
      if (fatura.status === 'PENDENTE') {
        await this.exigir(tx.$executeRaw(Prisma.sql`
          update public.faturas_aluguel set status = 'ATRASADO', asaas_status = ${status}::text where id = ${fatura.id}::uuid`), 'fatura_nao_atualizada');
      }
      return { status: 'PROCESSED' };
    }
    if (evento === 'PAYMENT_DELETED') {
      if (fatura.status !== 'PAGO') {
        await this.exigir(tx.$executeRaw(Prisma.sql`
          update public.faturas_aluguel set status = 'CANCELADO', motivo_cancelamento = 'Removido no Asaas', asaas_status = ${status}::text
           where id = ${fatura.id}::uuid`), 'fatura_nao_atualizada');
      }
      return { status: 'PROCESSED' };
    }
    if (evento === 'PAYMENT_REFUNDED') {
      await this.exigir(tx.$executeRaw(Prisma.sql`
        update public.faturas_aluguel set status = 'CANCELADO', motivo_cancelamento = 'Estorno', asaas_status = ${status}::text
         where id = ${fatura.id}::uuid`), 'fatura_nao_atualizada');
      await this.exigir(tx.$executeRaw(Prisma.sql`
        insert into public.auditoria_financeira (corretor_id, entidade, entidade_id, acao, dados_depois, origem, ator)
        values (${fatura.corretor_id}::uuid, 'faturas_aluguel', ${fatura.id}::uuid, 'ESTORNO',
                ${JSON.stringify({ asaas_status: status })}::jsonb, 'webhook', 'system')`), 'auditoria_nao_gravada');
      return { status: 'PROCESSED' };
    }
    return { status: 'IGNORED' };
  }

  /** Transferência do Asaas → baixa do repasse. Só DONE dá baixa; FAILED/CANCELLED/BLOCKED marcam ERRO. */
  private async transferencia(tx: Tx, eventRowId: string, evento: string, payload: Registro, dono: string | null): Promise<Desfecho> {
    const transfer = payload.transfer as Registro | undefined;
    if (!transfer?.id) return { status: 'IGNORED' };
    const transferId = String(transfer.id);
    const situacao = String(transfer.status ?? '').toUpperCase();
    const concluida = evento === 'TRANSFER_DONE' || situacao === 'DONE';
    const falhou = evento === 'TRANSFER_FAILED' || evento === 'TRANSFER_CANCELLED' || ['FAILED', 'CANCELLED', 'BLOCKED'].includes(situacao);
    const json = JSON.stringify(payload);

    if (!concluida && !falhou) {
      // Em trânsito: registra o estado e espera (pode não ser repasse nosso: zero linhas não é erro).
      await tx.$executeRaw(Prisma.sql`
        update public.repasses_proprietario set transferencia_status = ${situacao}::text, transferencia_payload = ${json}::jsonb
         where external_id = ${transferId}::text and (${dono}::uuid is null or corretor_id = ${dono}::uuid)`);
      return { status: 'PROCESSED' };
    }

    const valor = transfer.value ?? transfer.netValue ?? null;
    const achados = await tx.$queryRaw<Array<{ repasse_id: string | null; criterio: string | null }>>(Prisma.sql`
      select repasse_id::text as repasse_id, criterio from public.conciliar_transferencia_repasse(
        ${dono}::uuid, ${transferId}::text, ${transfer.externalReference ?? null}::text, ${valor}::numeric, ${chaveDestino(transfer)}::text)`);
    const repasseId = achados[0]?.repasse_id ?? null;
    const criterio = achados[0]?.criterio ?? 'sem_correspondencia';
    if (!repasseId) return { status: 'IGNORED', last_error: `transferencia_nao_conciliada:${criterio}` };

    const repasse = (await tx.$queryRaw<Array<{ r: Registro }>>(Prisma.sql`
      select jsonb_build_object('id', id, 'corretor_id', corretor_id, 'proprietario_nome', proprietario_nome,
        'valor_liquido_repasse', valor_liquido_repasse, 'status', status) as r
        from public.repasses_proprietario where id = ${repasseId}::uuid`))[0]?.r;
    if (!repasse) return { status: 'FAILED', last_error: 'repasse_sumiu' };

    await this.exigir(tx.$executeRaw(Prisma.sql`
      update public.asaas_webhook_events set corretor_id = ${repasse.corretor_id}::uuid where id = ${eventRowId}::uuid`), 'evento_sumiu');

    const nome = repasse.proprietario_nome ?? 'proprietário';
    const valorTexto = moedaBR(repasse.valor_liquido_repasse ?? transfer.value);

    if (concluida) {
      if (repasse.status === 'CONFIRMADO') return { status: 'IGNORED' };
      const agora = new Date().toISOString();
      await this.exigir(tx.$executeRaw(Prisma.sql`
        update public.repasses_proprietario
           set status = 'CONFIRMADO', external_id = ${transferId}::text, transferencia_status = ${situacao || 'DONE'}::text,
               transferencia_efetivada_em = now(), data_transferencia = ${transfer.effectiveDate ?? transfer.dateCreated ?? agora}::date,
               transferencia_payload = ${json}::jsonb, conciliacao_pendente = null
         where id = ${repasse.id}::uuid`), 'repasse_nao_atualizado');
      await this.exigir(tx.$executeRaw(Prisma.sql`
        insert into public.auditoria_financeira (corretor_id, entidade, entidade_id, acao, dados_antes, dados_depois, calculo, origem, ator)
        values (${repasse.corretor_id}::uuid, 'repasses_proprietario', ${repasse.id}::uuid, 'TRANSFERENCIA_CONFIRMADA',
                ${JSON.stringify({ status: repasse.status })}::jsonb, ${JSON.stringify({ status: 'CONFIRMADO', transfer_id: transferId })}::jsonb,
                ${JSON.stringify({ criterio_conciliacao: criterio })}::jsonb, 'webhook', 'asaas')`), 'auditoria_nao_gravada');
      return {
        status: 'PROCESSED',
        alertas: [{
          corretorId: repasse.corretor_id, tipo: 'TRANSFERENCIA', mensagem: `Repasse de ${valorTexto} confirmado para ${nome}`,
          entidadeTipo: 'repasse', entidadeId: repasse.id, prioridade: 'MEDIA',
          metadata: { valor: repasse.valor_liquido_repasse, proprietario: nome, transfer_id: transferId, criterio_conciliacao: criterio },
        }],
      };
    }

    await this.exigir(tx.$executeRaw(Prisma.sql`
      update public.repasses_proprietario
         set status = 'ERRO', transferencia_status = ${situacao || 'FAILED'}::text, transferencia_payload = ${json}::jsonb,
             conciliacao_pendente = ${`Transferência ${situacao || 'falhou'} no Asaas`}::text
       where id = ${repasse.id}::uuid`), 'repasse_nao_atualizado');
    return {
      status: 'PROCESSED',
      alertas: [{
        corretorId: repasse.corretor_id, tipo: 'TRANSFERENCIA', mensagem: `Repasse de ${valorTexto} para ${nome} NÃO foi concluído`,
        entidadeTipo: 'repasse', entidadeId: repasse.id, prioridade: 'ALTA',
        metadata: { valor: repasse.valor_liquido_repasse, proprietario: nome, transfer_id: transferId, status_asaas: situacao },
      }],
    };
  }

  private async alertarRecebimento(tx: Tx, fatura: Registro, payment: Registro): Promise<void> {
    const nome = (await tx.$queryRaw<Array<{ nome: string | null }>>(Prisma.sql`
      select k.nome from public.contratos c join public.clientes k on k.id = c.cliente_id where c.id = ${fatura.contrato_id}::uuid`))[0]?.nome ?? null;
    const ref = fatura.mes_referencia ? ` (${fatura.mes_referencia})` : '';
    const mensagem = nome ? `Recebimento de ${moedaBR(payment.value)} de ${nome}${ref}` : `Recebimento de ${moedaBR(payment.value)}${ref}`;
    await this.registrarAlerta(tx, {
      corretorId: fatura.corretor_id, tipo: 'PAGAMENTO', mensagem, entidadeTipo: 'fatura', entidadeId: fatura.id, prioridade: 'MEDIA',
      metadata: {
        valor: payment.value ?? null, inquilino: nome, mes_referencia: fatura.mes_referencia ?? null,
        payment_id: payment.id, recibo_url: payment.transactionReceiptUrl ?? null,
      },
    });
  }

  /** registrar_alerta_financeiro devolve uuid: o cast para texto deixa o Prisma ler a coluna. */
  private async registrarAlerta(tx: Tx, a: Alerta): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      select public.registrar_alerta_financeiro(${a.corretorId}::uuid, ${a.tipo}::text, ${a.mensagem}::text, ${a.entidadeTipo}::text,
        ${a.entidadeId}::uuid, ${JSON.stringify(a.metadata)}::jsonb, ${a.prioridade}::text)::text as id`);
  }

  private async exigir(escrita: Promise<number>, codigo: string): Promise<void> {
    if ((await escrita) === 0) throw new EscritaSemEfeito(codigo);
  }
}

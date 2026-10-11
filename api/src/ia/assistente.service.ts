import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { FORMATO_UUID } from './acoes';
import { contextoCrm } from './contexto-crm';
import {
  conversaVisivel, corretorDaSessao, criarConversa, historicoRecente, inserirMensagem, LinhaHistorico, NovaMensagem,
} from './conversas.service';
import { checarCota, ClienteSql, consumirLimiteIa, COTA_ASSISTENTE, registrarUso } from './cotas';
import { FERRAMENTAS_ASSISTENTE } from './ferramentas';
import { FerramentasIaService, RegistroCitado, registrosCitados } from './ferramentas.service';
import { juntarSinais, modeloReserva } from '../contratos/ia/gemini';
import { chatIa, chaveGemini, estimarUso, FetchImpl, modeloRapido } from './gemini';
import { AssistenteDto } from './ia.dto';
import { codigoDe, erroApi, IA_INDISPONIVEL, SEM_CORRETOR, traduzirErroBanco } from './ia.erros';
import { MAX_RODADAS_FERRAMENTA, normalizarPedidoIa, PedidoIa, PedidoIaInvalido } from './pedido';
import { fusoValido } from './periodo';
import { ModoAssistente, modoDoPedido, promptSistemaAssistente, VERSOES_PROMPT_IA } from './prompts';
import { finalizarExecucao, FimExecucao, iniciarExecucao, registrarFerramenta } from './telemetria';

export const MENSAGENS_POR_MINUTO = 30;
export const MAX_MENSAGENS_CONTEXTO = 20;
export const TIMEOUT_ASSISTENTE_MS = 60_000;
/** Sem texto nem ferramenta nesse tempo, o modelo travou: a rodada é refeita com o reserva. */
export const PRIMEIRO_PEDACO_MS = 12_000;
export const ERRO_DEMOROU = 'A IA demorou demais para responder. Tente de novo.';
export const ERRO_INTERNO = 'Erro interno. Tente de novo.';
/**
 * Texto de uma rodada fica retido até este tamanho: se a rodada terminar chamando ferramenta, era preâmbulo
 * ("vou consultar...") e não vai para a tela nem fica gravado. Passou disso, é resposta e segue em stream.
 */
export const LIMITE_PREAMBULO = 280;
/** Registros citados que voltam no prompt do turno seguinte. */
export const MAX_REGISTROS_CITADOS = 20;

/** Eventos do stream, no formato exato da Edge Function: data: {"type":...}. */
export type EventoAssistente =
  | { type: 'text'; content: string }
  | { type: 'action'; action: Record<string, unknown> }
  | { type: 'error'; error: string }
  | { type: 'done'; conversation_id: string; trace_id: string; prompt_version: string; consultas?: number; duracao_ms?: number };

interface MensagemChat {
  role: string;
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
}

interface ChamadaFerramenta {
  id: string;
  type: string;
  function: { name: string; arguments: string };
  /** Gemini 3: a thought_signature vem aqui e tem de voltar na rodada seguinte (sem ela, 400). */
  extra_content?: unknown;
}

export interface SessaoAssistente {
  claims: SupabaseClaims;
  corretorId: string;
  chave: string;
  modelo: string;
  pedido: PedidoIa;
  conversationId: string;
  novaConversa: boolean;
  mensagens: MensagemChat[];
  runId: string | null;
  inicio: number;
  /** chat (Assistente), estruturado (extração de documento) ou onboarding: muda prompt, ferramentas e título. */
  modo: ModoAssistente;
  agora: Date;
  fuso: string;
}

/** Ferramentas que cada modo oferece: a extração responde só o JSON e o onboarding só orienta. */
export function ferramentasDoModo(modo: ModoAssistente): typeof FERRAMENTAS_ASSISTENTE {
  return modo === 'chat' ? FERRAMENTAS_ASSISTENTE : [];
}

/** Título da conversa nova: a pergunta da pessoa (a resposta começa por "Leitura" ou é o JSON de um contrato). */
export function tituloDaConversa(modo: ModoAssistente, intent: string, mensagem: string): string {
  if (modo === 'estruturado') return intent === 'contracts.extraction' ? 'Extração de contrato' : 'Extração de dados';
  if (modo === 'onboarding') return 'Ajuda da configuração';
  const linha = mensagem.split('\n').map((l) => l.replace(/[#*_|`>]/g, '').replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return linha.slice(0, 80) || 'Nova conversa';
}

/** Registros citados nas últimas respostas (a mais nova primeiro), sem repetir. */
export function registrosDoHistorico(historico: LinhaHistorico[]): RegistroCitado[] {
  const vistos = new Map<string, RegistroCitado>();
  for (const linha of historico) {
    if (linha.role !== 'assistant') continue;
    const lista = (linha.metadata as { registros?: unknown } | null | undefined)?.registros;
    if (!Array.isArray(lista)) continue;
    for (const r of lista as RegistroCitado[]) {
      if (r && typeof r.id === 'string' && !vistos.has(r.id)) vistos.set(r.id, r);
    }
  }
  return [...vistos.values()].slice(0, MAX_REGISTROS_CITADOS);
}

const CONVERSA_NAO_ENCONTRADA = () => erroApi(404, 'conversa_nao_encontrada', 'Conversa não encontrada.');

/** Reconstrói o histórico para o provedor (mais antigo primeiro), como a função. */
export function mensagensDoHistorico(sistema: string, historico: LinhaHistorico[]): MensagemChat[] {
  const mensagens: MensagemChat[] = [{ role: 'system', content: sistema }];
  for (const linha of [...historico].reverse()) {
    // Consultas de turnos anteriores ficam de fora: as gravadas antes do Gemini 3 não têm
    // thought_signature e o provedor recusaria a conversa inteira (400). A resposta final de
    // cada turno, que resume o que foi consultado, continua no contexto.
    if (linha.role === 'tool') continue;
    if (linha.role === 'assistant' && linha.tool_calls) {
      if (linha.content) mensagens.push({ role: 'assistant', content: linha.content });
    } else {
      mensagens.push({ role: linha.role, content: linha.content });
    }
  }
  return mensagens;
}

/**
 * Porte do ai-assistant. preparar() faz tudo o que pode falhar com status HTTP (sessão, limite por
 * minuto, cota do plano, corpo, conversa) ANTES de abrir o stream; transmitir() roda o laço de
 * ferramentas e emite os mesmos eventos SSE da função. Logs: só status do provedor, código e tempo.
 */
@Injectable()
export class AssistenteService {
  private readonly log = new Logger('IaAssistente');
  /** Injetável para teste; nunca chamado de verdade nos testes. */
  fetchImpl: FetchImpl = (...a) => globalThis.fetch(...a);
  /** Trocável nos testes. */
  primeiroPedacoMs = PRIMEIRO_PEDACO_MS;

  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly ferramentas: FerramentasIaService,
  ) {}

  private get sql(): ClienteSql {
    return this.prisma as unknown as ClienteSql;
  }

  async preparar(claims: SupabaseClaims, dto: AssistenteDto): Promise<SessaoAssistente> {
    const chave = chaveGemini();
    if (!chave) throw IA_INDISPONIVEL();

    let corretorId: string | null;
    try {
      corretorId = await this.db.run(claims, corretorDaSessao);
    } catch (e) {
      traduzirErroBanco(e);
    }
    if (!corretorId) throw SEM_CORRETOR();

    // Banco fora do ar no limitador: segue, como o limitador antigo da função.
    if ((await consumirLimiteIa(this.sql, corretorId, MENSAGENS_POR_MINUTO)) === 'negado') {
      throw erroApi(429, 'limite_de_mensagens', 'Limite de mensagens excedido. Tente novamente em um minuto.');
    }

    const cota = await checarCota(this.sql, corretorId, COTA_ASSISTENTE);
    if (!cota.permitido) {
      const message = cota.habilitado && cota.limite !== null
        ? `Você atingiu o limite de ${cota.limite} interações de IA deste mês.`
        : 'Seu plano atual não inclui o Assistente Lotti.';
      throw erroApi(402, 'PLAN_LIMIT_REACHED', message, { recurso: COTA_ASSISTENTE, usado: cota.usado, limite: cota.limite });
    }

    let pedido: PedidoIa;
    try {
      pedido = normalizarPedidoIa(dto, { organizationId: corretorId, userId: claims.sub });
    } catch (e) {
      if (e instanceof PedidoIaInvalido) throw erroApi(400, 'pedido_invalido', e.message);
      throw e;
    }
    const conversaPedida = typeof dto.conversation_id === 'string' ? dto.conversation_id : null;
    if (conversaPedida !== null && !FORMATO_UUID.test(conversaPedida)) throw CONVERSA_NAO_ENCONTRADA();
    const fileContext = typeof dto.file_context === 'string' ? dto.file_context : undefined;
    const modelo = modeloRapido();
    const inicio = Date.now();
    const agora = new Date(inicio);
    const fuso = fusoValido(pedido.timezone);
    const modo = modoDoPedido(pedido);

    const runId = await iniciarExecucao(this.sql, {
      traceId: pedido.traceId,
      organizationId: pedido.organizationId,
      userId: pedido.userId,
      module: pedido.module,
      intent: pedido.intent,
      model: modelo,
      promptVersion: VERSOES_PROMPT_IA.assistant,
      outputMode: pedido.outputMode,
      inputChars: pedido.message.length + (fileContext?.length ?? 0),
      confirmationRequired: pedido.requiresConfirmation,
      metadata: { entity_count: pedido.entityRefs.length, modo },
    });

    let preparo: { conversationId: string; historico: LinhaHistorico[]; crm: string };
    try {
      preparo = await this.db.run(claims, async (tx) => {
        let conversationId = conversaPedida;
        if (conversationId) {
          if (!(await conversaVisivel(tx, conversationId))) throw CONVERSA_NAO_ENCONTRADA();
        } else {
          conversationId = await criarConversa(tx, corretorId, modelo);
        }
        await inserirMensagem(tx, {
          conversationId,
          role: 'user',
          content: pedido.message,
          metadata: {
            trace_id: pedido.traceId,
            module: pedido.module,
            intent: pedido.intent,
            entity_refs: pedido.entityRefs,
            output_mode: pedido.outputMode,
          },
        });
        const historico = await historicoRecente(tx, conversationId, MAX_MENSAGENS_CONTEXTO);
        // Extração e onboarding não usam o resumo da conta.
        const crm = modo === 'chat' ? await contextoCrm(tx, agora, fuso) : '';
        return { conversationId, historico, crm };
      });
    } catch (e) {
      await finalizarExecucao(this.sql, runId, { status: 'failed', latencyMs: Date.now() - inicio, errorCode: 'setup_failed' });
      traduzirErroBanco(e);
    }

    const sistema = promptSistemaAssistente({
      module: pedido.module, crmContext: preparo.crm, fileContext, intent: pedido.intent, outputMode: pedido.outputMode,
      agora, timezone: fuso, registros: registrosDoHistorico(preparo.historico),
    });
    return {
      claims,
      corretorId,
      chave,
      modelo,
      pedido,
      conversationId: preparo.conversationId,
      novaConversa: conversaPedida === null,
      mensagens: mensagensDoHistorico(sistema, preparo.historico),
      runId,
      inicio,
      modo,
      agora,
      fuso,
    };
  }

  /** Gravação de mensagem dentro do laço: a função não conferia o erro, então aqui ele só vira log. */
  private async gravar(claims: SupabaseClaims, mensagem: NovaMensagem): Promise<void> {
    try {
      await this.db.run(claims, (tx) => inserirMensagem(tx, mensagem));
    } catch (e) {
      this.log.warn(`mensagem do assistente não gravada ${codigoDe(e)}`);
    }
  }

  private async tocarConversa(s: SessaoAssistente): Promise<void> {
    const titulo = s.novaConversa ? tituloDaConversa(s.modo, s.pedido.intent, s.pedido.message) : null;
    try {
      await this.db.run(s.claims, (tx) => tx.$executeRaw(Prisma.sql`
        update public.ai_conversations set title = coalesce(${titulo}::text, title), updated_at = now()
        where id = ${s.conversationId}::uuid`));
    } catch (e) {
      this.log.warn(`conversa não atualizada ${codigoDe(e)}`);
    }
  }

  async transmitir(s: SessaoAssistente, emitir: (e: EventoAssistente) => void, sinal?: AbortSignal): Promise<void> {
    let falhou = false;
    let rodada = 0;
    let outputChars = 0;
    let providerInputChars = 0;
    /** Consultas de leitura feitas no turno e a duração: o rodapé "N consultas · X s" da resposta. */
    let consultas = 0;
    let duracaoMs = 0;
    /** Já saiu texto para a tela em alguma rodada: o texto da rodada seguinte entra num parágrafo novo. */
    let emitiuTexto = false;
    const registros = new Map<string, RegistroCitado>();
    const ferramentas = ferramentasDoModo(s.modo);
    const permitidas = ferramentas.map((f) => f.function.name);
    const atuais = [...s.mensagens];
    const uso = () => estimarUso(providerInputChars, outputChars);
    const fim = (f: Omit<FimExecucao, 'latencyMs'>) => finalizarExecucao(this.sql, s.runId, { ...f, latencyMs: Date.now() - s.inicio });
    let modelo = s.modelo;
    let usouReserva = false;

    try {
      for (;;) {
        rodada += 1;
        if (rodada > MAX_RODADAS_FERRAMENTA) {
          falhou = true;
          await fim({ status: 'blocked', outputChars, ...uso(), errorCode: 'tool_round_limit' });
          emitir({ type: 'error', error: 'A solicitação exigiu ações demais. Reformule o pedido em uma etapa por vez.' });
          break;
        }

        providerInputChars += JSON.stringify({ messages: atuais, tools: ferramentas }).length;
        let conteudo = '';
        let chamadas: ChamadaFerramenta[] = [];
        let temChamadas = false;
        let segurado = '';
        let soltou = false;
        const soltar = (texto: string) => {
          if (!texto) return;
          if (emitiuTexto && !soltou) emitir({ type: 'text', content: '\n\n' });
          soltou = true;
          emitiuTexto = true;
          emitir({ type: 'text', content: texto });
        };
        // O 3.8-flash chegou a ficar 60 s sem mandar nada (08/10/2026). Vigia o primeiro texto ou
        // ferramenta: sem nada em primeiroPedacoMs, corta e o catch abaixo refaz com o reserva.
        const parado = new AbortController();
        const vigia = setTimeout(() => parado.abort(new DOMException('modelo sem resposta', 'TimeoutError')), this.primeiroPedacoMs);
        const inicioRodada = Date.now();
        let primeiroMs: number | null = null;
        const chegou = () => {
          if (primeiroMs !== null) return;
          primeiroMs = Date.now() - inicioRodada;
          clearTimeout(vigia);
        };
        try {
          const resposta = await chatIa({
            chave: s.chave,
            modelo,
            corpo: { messages: atuais, ...(ferramentas.length ? { tools: ferramentas } : {}), stream: true },
            politica: { timeoutMs: TIMEOUT_ASSISTENTE_MS, sinal: juntarSinais(sinal, parado.signal) },
            fetchImpl: this.fetchImpl,
          });

          if (!resposta.ok || !resposta.body) {
            this.log.error(`IA_ASSISTENTE status=${resposta.status}`);
            falhou = true;
            await resposta.body?.cancel().catch(() => undefined);
            await fim({ status: 'failed', outputChars, ...uso(), errorCode: `provider_${resposta.status}` });
            emitir({ type: 'error', error: 'Erro ao comunicar com IA' });
            break;
          }

          const leitor = resposta.body.getReader();
          const decodificador = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;
            buffer += decodificador.decode(value, { stream: true });
            const linhas = buffer.split('\n');
            buffer = linhas.pop() || '';
            for (const linha of linhas) {
              if (!linha.startsWith('data: ')) continue;
              const dado = linha.slice(6).trim();
              if (dado === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dado);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content || delta?.tool_calls) chegou();
                if (delta?.content) {
                  conteudo += delta.content;
                  outputChars += delta.content.length;
                  // Texto que chega depois de uma chamada de ferramenta é preâmbulo: fica fora da tela.
                  if (!temChamadas && soltou) {
                    soltar(delta.content);
                  } else if (!temChamadas) {
                    segurado += delta.content;
                    if (segurado.length >= LIMITE_PREAMBULO) {
                      const texto = segurado;
                      segurado = '';
                      soltar(texto);
                    }
                  }
                }
                if (delta?.tool_calls) {
                  temChamadas = true;
                  for (const tc of delta.tool_calls) {
                    // OpenAI/xAI fragmentam a chamada em pedaços com 'index'; o endpoint OpenAI-compat do
                    // Gemini manda cada chamada inteira e sem 'index' — aí cada entrada é uma chamada nova.
                    const idx = typeof tc.index === 'number' ? tc.index : chamadas.length;
                    if (!chamadas[idx]) chamadas[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
                    if (tc.id) chamadas[idx].id = tc.id;
                    if (tc.function?.name) chamadas[idx].function.name += tc.function.name;
                    if (tc.function?.arguments) chamadas[idx].function.arguments += tc.function.arguments;
                    if (tc.extra_content) chamadas[idx].extra_content = tc.extra_content;
                  }
                }
              } catch {
                // pedaço SSE malformado: ignora
              }
            }
          }
        } catch (e) {
          // Gemini parado (timeout ou rede) sem ter mostrado nada nesta rodada: refaz a rodada uma vez com o
          // modelo reserva (o texto ainda retido é descartado). Se já saiu texto para a tela ou pediu
          // ferramenta, refazer duplicaria a resposta.
          const reserva = modeloReserva(modelo);
          if (sinal?.aborted || usouReserva || soltou || temChamadas || !reserva || reserva === modelo) throw e;
          this.log.warn(`IA_ASSISTENTE_RESERVA modelo=${modelo} ${codigoDe(e)} ms=${Date.now() - inicioRodada}`);
          usouReserva = true;
          modelo = reserva;
          rodada -= 1;
          continue;
        } finally {
          clearTimeout(vigia);
        }
        // Sem prompt nem resposta: só o tempo, para saber qual modelo está lento.
        this.log.log(`IA_ASSISTENTE rodada=${rodada} modelo=${modelo} primeiro_ms=${primeiroMs ?? '-'} ms=${Date.now() - inicioRodada}`);

        if (temChamadas && chamadas.length > 0) {
          // Última rodada permitida pedindo mais consultas: não roda nada (gastaria a consulta e a resposta não viria).
          if (rodada >= MAX_RODADAS_FERRAMENTA) {
            falhou = true;
            await fim({ status: 'blocked', outputChars, ...uso(), errorCode: 'tool_round_limit' });
            emitir({ type: 'error', error: 'A solicitação exigiu ações demais. Reformule o pedido em uma etapa por vez.' });
            break;
          }
          // Preâmbulo retido não foi mostrado: não fica gravado (reaberta, a conversa não ganha bolha fantasma).
          const preambulo = soltou ? conteudo : '';
          await this.gravar(s.claims, { conversationId: s.conversationId, role: 'assistant', content: preambulo, toolCalls: chamadas });
          atuais.push({ role: 'assistant', content: preambulo, tool_calls: chamadas });

          for (const tc of chamadas) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = {};
            }
            const inicioFerramenta = Date.now();
            const resultado = await this.ferramentas.executar(tc.function.name, args ?? {}, {
              claims: s.claims,
              runId: s.runId,
              corretorId: s.corretorId,
              userId: s.pedido.userId,
              entityRefs: s.pedido.entityRefs,
              agora: s.agora,
              fuso: s.fuso,
            }, permitidas);
            if (tc.function.name !== 'suggest_action' && permitidas.includes(tc.function.name)) consultas += 1;
            try {
              for (const r of registrosCitados(tc.function.name, JSON.parse(resultado))) registros.set(r.id, r);
            } catch {
              // resultado sem JSON: nada a lembrar
            }
            await registrarFerramenta(this.sql, s.runId, {
              toolName: tc.function.name,
              toolKind: tc.function.name === 'suggest_action' ? 'proposal' : 'read',
              status: resultado.includes('"error"') ? 'failed' : 'completed',
              durationMs: Date.now() - inicioFerramenta,
              entityRefs: s.pedido.entityRefs,
            });

            if (tc.function.name === 'suggest_action') {
              try {
                const parsed = JSON.parse(resultado);
                if (parsed.type === 'action') emitir({ type: 'action', action: parsed.action });
              } catch {
                // resultado sem JSON: nada a mostrar
              }
            }

            await this.gravar(s.claims, { conversationId: s.conversationId, role: 'tool', content: resultado, toolName: tc.id });
            atuais.push({ role: 'tool', content: resultado, tool_call_id: tc.id });
          }
        } else {
          soltar(segurado);
          duracaoMs = Date.now() - s.inicio;
          await this.gravar(s.claims, {
            conversationId: s.conversationId,
            role: 'assistant',
            content: conteudo,
            metadata: {
              prompt_version: VERSOES_PROMPT_IA.assistant,
              consultas,
              duracao_ms: duracaoMs,
              ...(registros.size ? { registros: [...registros.values()].slice(0, MAX_REGISTROS_CITADOS) } : {}),
            },
          });
          await this.tocarConversa(s);
          break;
        }
      }

      if (!falhou) {
        await registrarUso(this.sql, s.corretorId, COTA_ASSISTENTE);
        await fim({ status: 'completed', outputChars, ...uso() });
        emitir({
          type: 'done',
          conversation_id: s.conversationId,
          trace_id: s.pedido.traceId,
          prompt_version: VERSOES_PROMPT_IA.assistant,
          consultas,
          duracao_ms: duracaoMs,
        });
      }
    } catch (e) {
      if (sinal?.aborted) {
        await fim({ status: 'failed', errorCode: 'client_closed' });
        return;
      }
      this.log.error(`IA_ASSISTENTE_STREAM ${codigoDe(e)}`);
      await fim({ status: 'failed', errorCode: 'stream_error' });
      emitir({ type: 'error', error: (e as { name?: unknown })?.name === 'TimeoutError' ? ERRO_DEMOROU : ERRO_INTERNO });
    }
  }
}

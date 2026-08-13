/**
 * Histórico de contatos — tradução entre o que o app fala e o que a tabela tem.
 *
 * O código do projeto usa o enum `tipo_contato` (LIGACAO, EMAIL, WHATSAPP,
 * VISITA, PROPOSTA, NOTA), herdado da migration original. A tabela que está em
 * produção usa `canal_contato` (WHATSAPP, EMAIL, TELEFONE, PRESENCIAL, OUTRO) e
 * as colunas `conteudo`, `data_contato` e `direcao` — sem `corretor_id`,
 * `descricao` nem `data`.
 *
 * Resultado: todo insert de contato era recusado e a timeline nunca preenchia.
 * Este módulo é a única fronteira entre os dois vocabulários.
 */

export type CanalContato = 'WHATSAPP' | 'EMAIL' | 'TELEFONE' | 'PRESENCIAL' | 'OUTRO';
export type TipoContatoUI = 'LIGACAO' | 'EMAIL' | 'WHATSAPP' | 'VISITA' | 'PROPOSTA' | 'NOTA';
export type Direcao = 'IN' | 'OUT';

const UI_PARA_CANAL: Record<string, CanalContato> = {
  LIGACAO: 'TELEFONE',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
  VISITA: 'PRESENCIAL',
  // Proposta e nota não são canais de comunicação — o banco não tem equivalente.
  // O tipo real fica preservado em metadata.tipo_ui.
  PROPOSTA: 'OUTRO',
  NOTA: 'OUTRO',
};

const CANAL_PARA_UI: Record<string, TipoContatoUI> = {
  TELEFONE: 'LIGACAO',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
  PRESENCIAL: 'VISITA',
  OUTRO: 'NOTA',
};

const TIPOS_UI = Object.keys(UI_PARA_CANAL);

/** UI → coluna `tipo` da tabela. Desconhecido vira OUTRO em vez de quebrar. */
export const paraCanal = (tipoUI: string): CanalContato =>
  UI_PARA_CANAL[String(tipoUI).toUpperCase()] ?? 'OUTRO';

/** Banco → UI. O tipo original guardado em metadata tem prioridade. */
export function paraTipoUI(canal: string, metadata: Record<string, unknown> | null | undefined): TipoContatoUI {
  const guardado = String(metadata?.tipo_ui ?? '').toUpperCase();
  if (TIPOS_UI.includes(guardado)) return guardado as TipoContatoUI;
  return CANAL_PARA_UI[String(canal).toUpperCase()] ?? 'NOTA';
}

export interface RegistroHistorico {
  cliente_id: string;
  tipo: CanalContato;
  direcao: Direcao;
  conteudo: string;
  data_contato: string;
  metadata: Record<string, unknown>;
}

/** Monta a linha exatamente com as colunas que existem na tabela. */
export function paraRegistro(args: {
  clienteId: string;
  tipo: string;
  texto: string;
  direcao?: Direcao;
  metadata?: Record<string, unknown>;
}): RegistroHistorico {
  return {
    cliente_id: args.clienteId,
    tipo: paraCanal(args.tipo),
    // O que o corretor registra saiu dele; mensagem recebida passa 'IN'.
    direcao: args.direcao ?? 'OUT',
    conteudo: args.texto,
    data_contato: new Date().toISOString(),
    metadata: { tipo_ui: String(args.tipo).toUpperCase(), ...(args.metadata ?? {}) },
  };
}

export interface MensagemThread {
  id: string;
  conteudo: string;
  data_contato: string;
  tipo: string;
  tipoUI: TipoContatoUI;
  /** true = saiu do corretor (bolha à direita). */
  meu: boolean;
}

/**
 * Ordena o histórico como conversa: mais antigo em cima.
 * Registro sem `direcao` é do formato antigo e conta como enviado — foi o
 * corretor que digitou.
 */
export function montarThread(
  registros: { id: string; conteudo: string; data_contato: string; tipo: string; direcao?: string; metadata?: Record<string, unknown> | null }[],
): MensagemThread[] {
  return [...registros]
    .sort((a, b) => String(a.data_contato).localeCompare(String(b.data_contato)))
    .map((r) => ({
      id: r.id,
      conteudo: r.conteudo,
      data_contato: r.data_contato,
      tipo: r.tipo,
      tipoUI: paraTipoUI(r.tipo, r.metadata),
      meu: r.direcao !== 'IN',
    }));
}

/**
 * "Sem contato há X" — o badge da lista de conversas.
 *
 * Enquanto não recebemos mensagem de entrada não dá para saber "aguardando
 * resposta"; o que dá para afirmar é há quanto tempo ninguém fala com o lead,
 * e isso já é o sinal útil.
 */
export function semContatoHa(ultimoContato: string | null | undefined, agora: Date = new Date()): string | null {
  if (!ultimoContato) return null;
  const then = new Date(ultimoContato);
  if (Number.isNaN(then.getTime())) return null;

  const minutos = Math.floor((agora.getTime() - then.getTime()) / 60000);
  if (minutos <= 0) return 'agora';
  if (minutos < 60) return `${minutos}min`;
  if (minutos < 60 * 24) return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;
  return `${Math.floor(minutos / (60 * 24))}d`;
}

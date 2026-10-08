import { createHash, timingSafeEqual } from 'node:crypto';
import type { AmbienteAsaas } from './asaas-http';

/**
 * Funções puras portadas das Edge Functions (_shared/asaas-conexao.ts, _shared/telefone.ts,
 * _shared/asaas-origem.ts, asaas-sync e asaas-webhook) e a recorrência do useFinanceiro.
 */

/** Erro de validação da conexão: vira 400 chave_invalida com a própria mensagem (D10). */
export class ErroValidacaoAsaas extends Error {}

export const EVENTOS_WEBHOOK_ASAAS = [
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  // PAYMENT_RECEIVED_IN_CASH não existe na lista do Asaas (400 "evento inválido" ao criar o
  // webhook): o recebimento em dinheiro chega como PAYMENT_RECEIVED. O tratamento no webhook
  // continua aceitando o nome, sem efeito.
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'TRANSFER_CREATED',
  'TRANSFER_PENDING',
  'TRANSFER_IN_BANK_PROCESSING',
  'TRANSFER_BLOCKED',
  'TRANSFER_DONE',
  'TRANSFER_FAILED',
  'TRANSFER_CANCELLED',
] as const;

export interface DadosContaAsaas {
  nome: string | null;
  email: string;
  cpfCnpj: string | null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

export function normalizarAmbiente(valor: unknown): AmbienteAsaas {
  return valor === 'sandbox' ? 'sandbox' : 'producao';
}

/** Tamanho plausível e sem espaços; a autenticação no Asaas é a prova definitiva. */
export function normalizarApiKey(valor: unknown): string {
  if (typeof valor !== 'string') throw new ErroValidacaoAsaas('Informe a chave de API da sua conta Asaas.');
  const chave = valor.trim();
  if (chave.length < 20 || chave.length > 512 || /\s/.test(chave)) {
    throw new ErroValidacaoAsaas('A chave informada não tem um formato válido.');
  }
  return chave;
}

export function extrairDadosConta(bruto: unknown, emailDaSessao: string | null | undefined): DadosContaAsaas {
  const info = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  const email = texto(info.email) ?? texto(emailDaSessao);
  if (!email) throw new ErroValidacaoAsaas('Sua conta precisa ter um e-mail válido para configurar o webhook Asaas.');
  return {
    nome: texto(info.companyName) ?? texto(info.tradingName) ?? texto(info.commercialName) ?? texto(info.name),
    email,
    cpfCnpj: texto(info.cpfCnpj),
  };
}

export function montarWebhookAsaas(url: string, email: string, authToken: string) {
  return {
    name: 'Lotti - Gestão de Aluguéis',
    url,
    email,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken,
    sendType: 'NON_SEQUENTIALLY',
    events: [...EVENTOS_WEBHOOK_ASAAS],
  };
}

// ---------------------------------------------------------------- telefone (_shared/telefone.ts)

export interface TelefoneAsaas {
  mobilePhone?: string;
  phone?: string;
}

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Objeto vazio = não dá para enviar; quem chama omite o telefone. */
export function telefoneParaAsaas(bruto: string | null | undefined): TelefoneAsaas {
  let d = (bruto ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (!DDDS_VALIDOS.has(Number(d.slice(0, 2)))) return {};
  if (d.length === 11 && d[2] === '9') return { mobilePhone: d };
  if (d.length === 10) return { phone: d };
  return {};
}

// ---------------------------------------------------------------- cobrança (asaas-sync)

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje no fuso de São Paulo, 'YYYY-MM-DD' (a data que o front manda). */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
}

/** Dia do contrato no mês de referência ('MM/YYYY'), limitado ao fim do mês e nunca antes de hoje. */
function vencimentoPorMes(mesRef: unknown, diaVenc: number, hoje: string): string {
  const [mmStr, yyyyStr] = String(mesRef ?? '').split('/');
  const mm = Number(mmStr);
  const yyyy = Number(yyyyStr);
  if (!mm || !yyyy) return hoje;
  const ultimo = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  const dia = Math.min(diaVenc > 0 ? diaVenc : 10, ultimo);
  const iso = new Date(Date.UTC(yyyy, mm - 1, dia)).toISOString().slice(0, 10);
  return iso < hoje ? hoje : iso;
}

/** data_vencimento gravada (por fatura) vence; senão deriva do contrato (padrão dia 10). Sempre >= hoje. */
export function vencimentoDaCobranca(
  fatura: { data_vencimento?: unknown; mes_referencia?: unknown },
  contrato: { dia_vencimento?: unknown } | null,
  hoje: string,
): string {
  const gravada = typeof fatura.data_vencimento === 'string' ? fatura.data_vencimento.slice(0, 10) : '';
  if (DATA_ISO.test(gravada)) return gravada < hoje ? hoje : gravada;
  return vencimentoPorMes(fatura.mes_referencia, Number(contrato?.dia_vencimento) || 10, hoje);
}

/** Multa e juros sempre explícitos (inclusive 0); a coluna guarda juros ao dia, o Asaas usa ao mês (×30). */
export function encargosDaCobranca(contrato: Record<string, unknown> | null) {
  const multaPct = Math.max(0, Number(contrato?.multa_atraso_percentual ?? 0) || 0);
  const jurosDiaPct = Math.max(0, Number(contrato?.juros_mora_diario_percentual ?? 0) || 0);
  const jurosMensalPct = Number((jurosDiaPct * 30).toFixed(2));
  return {
    multaPct,
    jurosMensalPct,
    fine: { value: multaPct, type: 'PERCENTAGE' },
    interest: { value: jurosMensalPct },
  };
}

// ---------------------------------------------------------------- webhook

export function sha256Hex(entrada: string): string {
  return createHash('sha256').update(entrada, 'utf8').digest('hex');
}

/** payload.id do Asaas, ou hash determinístico que inclui a transferência (asaas-webhook:515-521). */
export function idDoEvento(payload: unknown): string {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    id?: unknown;
    event?: unknown;
    payment?: { id?: unknown; dateCreated?: unknown } | null;
    transfer?: { id?: unknown; dateCreated?: unknown } | null;
  };
  if (p.id !== undefined && p.id !== null) return String(p.id);
  const evento = typeof p.event === 'string' ? p.event : 'UNKNOWN';
  const entidadeId = p.payment?.id ?? p.transfer?.id ?? '';
  const criadaEm = p.payment?.dateCreated ?? p.transfer?.dateCreated ?? '';
  return sha256Hex(`${evento}:${String(entidadeId)}:${String(criadaEm)}`);
}

/** Comparação em tempo constante sobre os digests SHA-256 (iguala o tamanho também). */
export function tokensIguais(fornecido: string | null | undefined, esperado: string): boolean {
  if (!fornecido) return false;
  const a = createHash('sha256').update(fornecido, 'utf8').digest();
  const b = createHash('sha256').update(esperado, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Valor em reais → "R$ 1.840,00", para o texto do alerta. */
export function moedaBR(v: unknown): string {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return 'R$ —';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface TransferenciaDestino {
  pixAddressKey?: string | null;
  cpfCnpj?: string | null;
  bankAccount?: { pixAddressKey?: string | null; cpfCnpj?: string | null } | null;
}

/** Chave PIX de destino da transferência (PIX manda pixAddressKey; conta bancária, bankAccount). */
export function chaveDestino(transfer: TransferenciaDestino | null | undefined): string | null {
  return transfer?.pixAddressKey ?? transfer?.bankAccount?.pixAddressKey ?? transfer?.bankAccount?.cpfCnpj ?? transfer?.cpfCnpj ?? null;
}

// ---------------------------------------------------------------- lançamentos

/**
 * date-fns addMonths sobre 'YYYY-MM-DD': soma meses e, se o dia não existe no mês de destino,
 * usa o último dia (31/01 + 1 → 28/02 ou 29/02). Sem fuso.
 */
export function somarMeses(data: string, n: number): string {
  const [y, m, d] = data.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = total - ano * 12; // 0..11
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${String(ano).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

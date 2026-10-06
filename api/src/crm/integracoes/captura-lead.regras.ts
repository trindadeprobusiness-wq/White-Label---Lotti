import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpException } from '@nestjs/common';
import { segredoConfere } from './segredo-n8n';

/**
 * Porte fiel de supabase/functions/_shared/public-request.ts (o que a Edge lead-capture usava).
 * Mesmos textos, mesmos status e a mesma ordem de validação. Nada aqui toca o banco.
 */

/** PublicRequestError da Edge: status + texto que pode ir ao visitante. */
export class ErroLead extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Teto do corpo (readPublicJson): 16 KiB. */
export const LIMITE_CORPO_LEAD = 16_384;
export const MSG_LEAD_FALHA = 'Não foi possível receber seu contato. Tente novamente.';
export const MSG_LEAD_OK = 'Recebemos seu contato! Em breve alguém falará com você.';
export const MSG_INDISPONIVEL = 'Serviço temporariamente indisponível.';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corpo de erro da Edge (`{ success: false, error }`) com o status dela. */
export function erroLeadHttp(e: unknown): HttpException {
  if (e instanceof HttpException) return e;
  const status = e instanceof ErroLead ? e.status : 500;
  const error = e instanceof ErroLead ? e.message : MSG_LEAD_FALHA;
  return new HttpException({ success: false, error }, status);
}

function objeto(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new ErroLead(400, 'Dados inválidos.');
  return valor as Record<string, unknown>;
}

function texto(valor: unknown, max: number): string | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (typeof valor !== 'string' || valor.length > max
    || Array.from(valor).some((c) => c.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(c))) {
    throw new ErroLead(400, 'Campo inválido ou muito longo.');
  }
  return valor.trim() || undefined;
}

export interface LeadLido {
  nome: string;
  /** Sempre 55 + DDD + número. */
  telefone: string;
  email?: string;
  imovelId?: string;
  mensagem?: string;
  origem?: string;
  assunto?: string;
  tracking: Record<string, string>;
}

const CHAVES_TRACKING = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'interesse', 'faixa_preco', 'bairro_interesse'];

/** parseLead da Edge. `idDaQuery` é o ?imovel_id= da URL do webhook. */
export function lerLead(entrada: unknown, idDaQuery?: string | null): LeadLido {
  const p = objeto(entrada);
  // Valida inclusive os apelidos antigos, para não aceitar tipos inesperados.
  const nomes = ['nome', 'first_name', 'last_name'].map((k) => texto(p[k], 120));
  const nome = nomes[0] || [nomes[1], nomes[2]].filter(Boolean).join(' ') || 'Lead de Campanha';
  if (nome.length < 2 || nome.length > 120) throw new ErroLead(400, 'Nome inválido.');
  const telefones = ['telefone', 'celular', 'phone'].map((k) => texto(p[k], 32));
  const digitos = (telefones.find(Boolean) || '').replace(/\D/g, '');
  const local = (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55') ? digitos.slice(2) : digitos;
  if (!/^[1-9]\d{9,10}$/.test(local)) throw new ErroLead(400, 'Telefone inválido.');
  const email = texto(p.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroLead(400, 'E-mail inválido.');
  const ids = [idDaQuery, p.imovel_id, p.imovel_interesse_id].map((v) => texto(v, 36)).filter((v): v is string => !!v);
  if (ids.some((id) => !UUID_PATTERN.test(id)) || new Set(ids.map((id) => id.toLowerCase())).size > 1) {
    throw new ErroLead(400, 'Imóvel inválido.');
  }
  const recebido = p.tracking_data == null ? {} : objeto(p.tracking_data);
  const tracking: Record<string, string> = {};
  for (const chave of CHAVES_TRACKING) {
    const valor = texto(recebido[chave] ?? p[chave], 300);
    if (valor) tracking[chave] = valor;
  }
  return {
    nome,
    telefone: `55${local}`,
    email,
    imovelId: ids[0]?.toLowerCase(),
    mensagem: texto(p.mensagem, 2000),
    origem: texto(p.origem, 100),
    assunto: texto(p.assunto, 200),
    tracking,
  };
}

/**
 * isTrustedIntegration da Edge: sem cabeçalho → visitante; com cabeçalho, ele TEM de conferir com
 * N8N_SHARED_SECRET (ou a resposta é 401 antes de qualquer leitura do banco).
 */
export function integracaoConfiavel(recebido: string | null, esperado: string | null): boolean {
  if (recebido === null) return false;
  if (!esperado || recebido.length > 1024 || !segredoConfere(recebido, esperado)) {
    throw new ErroLead(401, 'Integração não autorizada.');
  }
  return true;
}

/** Chave do limite por telefone: HMAC-SHA256 hex de `lead:<telefone>`, igual à Edge (contadores seguem valendo). */
export function chaveLimiteLead(segredo: string, telefone: string): string {
  return createHmac('sha256', segredo).update(`lead:${telefone}`).digest('hex');
}

/** publicLeadResponse: o visitante só recebe a confirmação genérica; os detalhes são da integração. */
export function respostaLead(confiavel: boolean, detalhes: Record<string, unknown> = {}): Record<string, unknown> {
  return { success: true, message: MSG_LEAD_OK, ...(confiavel ? detalhes : {}) };
}

type RequisicaoCorpo = IncomingMessage & { body?: unknown; _body?: boolean };

/**
 * readPublicJson. O Express já leu o corpo quando o Content-Type é JSON (ou formulário): então só
 * confere o tamanho. Em text/plain (o fetch sem cabeçalho de uma landing page manda assim, e a Edge
 * aceitava) ninguém leu o corpo ainda: lê aqui, com o teto de 16 KiB, e decodifica UTF-8 estrito.
 */
export async function lerCorpoLead(req: RequisicaoCorpo, max = LIMITE_CORPO_LEAD): Promise<unknown> {
  if (Number(req.headers['content-length']) > max) throw new ErroLead(413, 'Requisição muito grande.');
  if (req._body) {
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > max) throw new ErroLead(413, 'Requisição muito grande.');
    return req.body;
  }
  if (req.readableEnded) throw new ErroLead(400, 'Corpo inválido.');
  const bruto = await new Promise<Buffer>((resolve, reject) => {
    const pedacos: Buffer[] = [];
    let tamanho = 0;
    const parar = () => {
      req.off('data', aoLer);
      req.off('end', aoFim);
      req.off('error', aoErro);
    };
    const aoLer = (pedaco: Buffer) => {
      tamanho += pedaco.length;
      if (tamanho > max) {
        parar();
        reject(new ErroLead(413, 'Requisição muito grande.'));
        return;
      }
      pedacos.push(pedaco);
    };
    const aoFim = () => { parar(); resolve(Buffer.concat(pedacos)); };
    const aoErro = () => { parar(); reject(new ErroLead(400, 'Corpo inválido.')); };
    req.on('data', aoLer);
    req.on('end', aoFim);
    req.on('error', aoErro);
  });
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bruto));
  } catch {
    throw new ErroLead(400, 'Corpo inválido.');
  }
}

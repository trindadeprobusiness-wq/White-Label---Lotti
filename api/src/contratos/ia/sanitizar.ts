// Copiado literalmente de supabase/functions/analisar-contrato/index.ts e gerar-contrato/index.ts (porte fiel).
// TIPOS_CONTRATO aqui aceita 'OUTRO' de propósito (como a função); o gravador barra no DTO.

export interface DadosContrato {
  inquilino: { nome: string | null; cpf: string | null; telefone: string | null; email: string | null };
  proprietario_nome: string | null;
  imovel: { endereco: string | null; bairro: string | null; cidade: string | null; tipo: string | null };
  valor_aluguel: number | null;
  data_inicio: string | null;
  prazo_meses: number | null;
  dia_vencimento: number | null;
  taxa_administracao: number | null;
  observacoes: string | null;
}

const TIPOS_IMOVEL = ["APARTAMENTO", "CASA", "COMERCIAL", "TERRENO"];

export function asString(v: unknown, max = 300): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function asNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (typeof n !== "number" || !isFinite(n)) return null;
  return n >= min && n <= max ? n : null;
}

export function sanitizeExtraction(raw: Record<string, unknown>): DadosContrato {
  const inq = (raw.inquilino ?? {}) as Record<string, unknown>;
  const imo = (raw.imovel ?? {}) as Record<string, unknown>;
  const tipoImovel = asString(imo.tipo)?.toUpperCase() ?? null;

  return {
    inquilino: {
      nome: asString(inq.nome),
      cpf: asString(inq.cpf, 20),
      telefone: asString(inq.telefone, 30),
      email: asString(inq.email, 120),
    },
    proprietario_nome: asString(raw.proprietario_nome),
    imovel: {
      endereco: asString(imo.endereco),
      bairro: asString(imo.bairro, 120),
      cidade: asString(imo.cidade, 120),
      tipo: tipoImovel && TIPOS_IMOVEL.includes(tipoImovel) ? tipoImovel : null,
    },
    valor_aluguel: asMoney(raw.valor_aluguel, 1, 10_000_000),
    data_inicio: toIsoDate(raw.data_inicio),
    prazo_meses: asNumber(raw.prazo_meses, 1, 120),
    dia_vencimento: asNumber(raw.dia_vencimento, 1, 31),
    taxa_administracao: asNumber(raw.taxa_administracao, 0, 100),
    observacoes: asString(raw.observacoes, 500),
  };
}

const TIPOS_CONTRATO = [
  "COMPRA_VENDA", "LOCACAO_RESIDENCIAL", "LOCACAO_COMERCIAL",
  "EXCLUSIVIDADE_VENDA", "EXCLUSIVIDADE_LOCACAO", "DISTRATO", "PROCURACAO", "OUTRO",
];

export interface ParteContrato {
  nome: string | null;
  cpf_cnpj: string | null;
  telefone: string | null;
  email: string | null;
}

export interface DadosContratoCentral {
  tipo: string | null;
  partes: {
    vendedor_proprietario: ParteContrato;
    comprador_cliente: ParteContrato;
    corretor: string | null;
  };
  imovel: { endereco: string | null; bairro: string | null; cidade: string | null; tipo: string | null };
  valor: number | null;
  comissao_percentual: number | null;
  data_inicio: string | null;
  data_fim: string | null;
  prazo_dias: number | null;
  observacoes: string | null;
}

const MESES_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** Monta a data só se ela existir de verdade no calendário (rejeita 31/02). */
export function montarIso(ano: number, mes: number, dia: number): string | null {
  if (ano < 1900 || ano > 2200) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Normaliza a data para ISO. O modelo devolve YYYY-MM-DD na maioria das vezes, mas
 * em contrato escaneado escapa "21/08/2026" e "21 de agosto de 2026" — antes essas
 * formas eram descartadas em silêncio e o campo chegava vazio na tela.
 */
export function toIsoDate(v: unknown): string | null {
  const s = asString(v, 60);
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return montarIso(+iso[1], +iso[2], +iso[3]);

  const br = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (br) return montarIso(+br[3], +br[2], +br[1]);

  const extenso = s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if (extenso) {
    const mes = MESES_PT[extenso[2]];
    if (mes) return montarIso(+extenso[3], mes, +extenso[1]);
  }
  return null;
}

/**
 * Dinheiro em formato brasileiro. asNumber() usa parseFloat, que lê "350.000,00"
 * como 350 — o valor chegava errado ou era cortado pela faixa e virava null.
 */
export function asMoney(v: unknown, min: number, max: number): number | null {
  if (typeof v === "number") return isFinite(v) && v >= min && v <= max ? v : null;
  const s = asString(v, 40);
  if (!s) return null;

  let limpo = s.replace(/[^\d.,-]/g, "");
  const temVirgula = limpo.includes(",");
  const temPonto = limpo.includes(".");
  if (temVirgula && temPonto) limpo = limpo.replace(/\./g, "").replace(",", ".");
  else if (temVirgula) limpo = limpo.replace(",", ".");
  else if (temPonto && /^\d{1,3}(\.\d{3})+$/.test(limpo)) limpo = limpo.replace(/\./g, "");

  const n = parseFloat(limpo);
  return isFinite(n) && n >= min && n <= max ? n : null;
}

/** Aceita o objeto novo {nome, cpf_cnpj, ...} ou a string solta do formato antigo. */
export function asParte(v: unknown): ParteContrato {
  if (typeof v === "string") {
    return { nome: asString(v), cpf_cnpj: null, telefone: null, email: null };
  }
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    nome: asString(o.nome),
    cpf_cnpj: asString(o.cpf_cnpj ?? o.cpf ?? o.cnpj, 25),
    telefone: asString(o.telefone, 30),
    email: asString(o.email, 120),
  };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sanitizeCentral(raw: Record<string, unknown>): DadosContratoCentral {
  const partes = (raw.partes ?? {}) as Record<string, unknown>;
  const imo = (raw.imovel ?? {}) as Record<string, unknown>;
  const tipo = asString(raw.tipo)?.toUpperCase() ?? null;
  const tipoImovel = asString(imo.tipo)?.toUpperCase() ?? null;

  let dataInicio = toIsoDate(raw.data_inicio);
  let dataFim = toIsoDate(raw.data_fim);
  const prazoDias = asNumber(raw.prazo_dias, 1, 3650);
  // Um dos extremos + o prazo já fecham a janela do contrato.
  if (!dataFim && dataInicio && prazoDias) dataFim = addDays(dataInicio, prazoDias);
  if (!dataInicio && dataFim && prazoDias) dataInicio = addDays(dataFim, -prazoDias);

  return {
    tipo: tipo && TIPOS_CONTRATO.includes(tipo) ? tipo : null,
    partes: {
      vendedor_proprietario: asParte(partes.vendedor_proprietario),
      comprador_cliente: asParte(partes.comprador_cliente),
      corretor: asString(partes.corretor),
    },
    imovel: {
      endereco: asString(imo.endereco),
      bairro: asString(imo.bairro, 120),
      cidade: asString(imo.cidade, 120),
      tipo: tipoImovel && TIPOS_IMOVEL.includes(tipoImovel) ? tipoImovel : null,
    },
    valor: asMoney(raw.valor, 1, 1_000_000_000),
    comissao_percentual: asNumber(raw.comissao_percentual, 0, 100),
    data_inicio: dataInicio,
    data_fim: dataFim,
    prazo_dias: prazoDias,
    observacoes: asString(raw.observacoes, 600),
  };
}

/** Remove `<>`, apara e corta (o `sanitize` de gerar-contrato). */
export const sanitize = (text: unknown, max = 2000): string => {
  if (typeof text !== "string") return "";
  return text.replace(/[<>]/g, "").slice(0, max).trim();
};

export class PedidoInvalido extends Error {}

/**
 * Checagens e sanitização de gerar-contrato, com as mesmas mensagens. Devolve uma cópia (o corpo não é alterado).
 * Correção D14: proprietario e corretor ausentes viram {}.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizarPedidoGeracao(entrada: Record<string, any>): Record<string, any> {
  const body = JSON.parse(JSON.stringify(entrada));
  body.proprietario = body.proprietario ?? {};
  body.corretor = body.corretor ?? {};
  const { cliente, imovel, proprietario, detalhes } = body;
  if (!cliente?.nome || typeof cliente.nome !== "string" || cliente.nome.length > 200) throw new PedidoInvalido("Nome do cliente inválido");
  if (!imovel?.endereco || typeof imovel.endereco !== "string" || imovel.endereco.length > 500) throw new PedidoInvalido("Endereço do imóvel inválido");
  if (typeof detalhes?.valor !== "number" || detalhes.valor < 0 || detalhes.valor > 1_000_000_000) throw new PedidoInvalido("Valor inválido");

  cliente.nome = sanitize(cliente.nome, 200);
  imovel.endereco = sanitize(imovel.endereco, 500);
  if (detalhes.clausulas_adicionais) {
    detalhes.clausulas_adicionais = sanitize(detalhes.clausulas_adicionais, 3000);
  }
  if (cliente.profissao) cliente.profissao = sanitize(cliente.profissao, 100);
  if (cliente.estado_civil) cliente.estado_civil = sanitize(cliente.estado_civil, 50);
  if (proprietario?.nome) proprietario.nome = sanitize(proprietario.nome, 200);
  return body;
}

// Porte de supabase/functions/_shared/ai/actions.ts (validateActionProposal) sem zod: mesmas regras
// (strings com trim antes de min/max, objetos estritos, opcional recusa null, default do telefone "").
// Diferença: as categorias de lançamento são as que a tela Financeiro oferece para cada tipo.
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA } from './rotulos';

export class AcaoInvalida extends Error {
  constructor(readonly campo: string) {
    super(`invalid_action_schema:${campo}`);
    this.name = 'AcaoInvalida';
  }
}

type Validador = (v: unknown, campo: string) => unknown;

/** Mesma regra larga do z.string().uuid() do zod 3 e do FORMATO_UUID da API. */
export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (min: number, max: number): Validador => (v, campo) => {
  if (typeof v !== 'string') throw new AcaoInvalida(campo);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new AcaoInvalida(campo);
  return t;
};
const opcional = (f: Validador): Validador => (v, campo) => (v === undefined ? undefined : f(v, campo));
const comPadrao = (f: Validador, padrao: unknown): Validador => (v, campo) => (v === undefined ? padrao : f(v, campo));
const umDe = (valores: readonly string[]): Validador => (v, campo) => {
  if (typeof v !== 'string' || !valores.includes(v)) throw new AcaoInvalida(campo);
  return v;
};
const uuid: Validador = (v, campo) => {
  if (typeof v !== 'string' || !FORMATO_UUID.test(v)) throw new AcaoInvalida(campo);
  return v;
};
const dataIso: Validador = (v, campo) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AcaoInvalida(campo);
  return v;
};
const numero = (o: { max: number; positivo?: boolean; inteiro?: boolean }): Validador => (v, campo) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new AcaoInvalida(campo);
  if (o.inteiro && !Number.isInteger(v)) throw new AcaoInvalida(campo);
  if (o.positivo ? v <= 0 : v < 0) throw new AcaoInvalida(campo);
  if (v > o.max) throw new AcaoInvalida(campo);
  return v;
};
const booleano: Validador = (v, campo) => {
  if (typeof v !== 'boolean') throw new AcaoInvalida(campo);
  return v;
};

function objetoEstrito(forma: Record<string, Validador>) {
  return (v: unknown): Record<string, unknown> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AcaoInvalida('params');
    const entrada = v as Record<string, unknown>;
    for (const k of Object.keys(entrada)) if (!(k in forma)) throw new AcaoInvalida(k);
    const saida: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(forma)) {
      const r = f(entrada[k], k);
      if (r !== undefined) saida[k] = r;
    }
    return saida;
  };
}

const textoCurto = texto(1, 240);

/** As categorias que a tela Financeiro oferece (src/types/financeiro.ts); cada tipo só aceita as suas. */
export const CATEGORIAS_FINANCEIRAS = [...new Set([...CATEGORIAS_DESPESA, ...CATEGORIAS_RECEITA])];

const ESQUEMAS = {
  create_client: objetoEstrito({
    nome: textoCurto,
    telefone: comPadrao(texto(0, 30), ''),
    tipo_interesse: opcional(umDe(['COMPRA', 'LOCACAO', 'AMBOS'])),
  }),
  update_client_status: objetoEstrito({
    client_id: uuid,
    status: umDe(['QUALIFICACAO', 'VISITA_PROPOSTA', 'DOCUMENTACAO', 'FECHADO_GANHO', 'FECHADO_PERDIDO']),
  }),
  schedule_followup: objetoEstrito({ client_id: uuid, date: dataIso }),
  create_alert: objetoEstrito({
    mensagem: texto(1, 1000),
    tipo: opcional(umDe(['FOLLOWUP', 'DOCUMENTO', 'EXCLUSIVIDADE', 'GERAL'])),
    prioridade: opcional(umDe(['ALTA', 'MEDIA', 'BAIXA'])),
  }),
  register_contact: objetoEstrito({
    client_id: uuid,
    tipo: texto(1, 40),
    descricao: texto(1, 4000),
  }),
  create_property: objetoEstrito({
    titulo: textoCurto,
    tipo: opcional(umDe(['APARTAMENTO', 'CASA', 'COMERCIAL', 'TERRENO'])),
    valor: opcional(numero({ max: 1_000_000_000 })),
    area_m2: opcional(numero({ max: 1_000_000 })),
    dormitorios: opcional(numero({ max: 100, inteiro: true })),
    garagem: opcional(numero({ max: 100, inteiro: true })),
    endereco: opcional(texto(0, 500)),
    bairro: opcional(texto(0, 160)),
    cidade: opcional(texto(0, 160)),
    proprietario_nome: opcional(texto(0, 240)),
  }),
  create_financial_entry: objetoEstrito({
    tipo: umDe(['RECEITA', 'DESPESA']),
    categoria: umDe(CATEGORIAS_FINANCEIRAS),
    descricao: texto(1, 1000),
    valor: numero({ max: 1_000_000_000, positivo: true }),
    data: opcional(dataIso),
    recorrente: opcional(booleano),
  }),
} as const;

export type TipoAcaoIa = keyof typeof ESQUEMAS;
export const TIPOS_ACAO_IA = Object.keys(ESQUEMAS) as TipoAcaoIa[];

export interface PropostaValidada {
  action_type: TipoAcaoIa;
  params: Record<string, unknown>;
  description: string;
}

/** Lança AcaoInvalida quando a proposta não passa no esquema (a ferramenta responde invalid_action_schema). */
export function validarProposta(valor: Record<string, unknown>): PropostaValidada {
  const tipo = umDe(TIPOS_ACAO_IA)(valor?.action_type, 'action_type') as TipoAcaoIa;
  const params = ESQUEMAS[tipo](valor.params);
  if (tipo === 'create_financial_entry') {
    const doTipo: readonly string[] = params.tipo === 'RECEITA' ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
    if (!doTipo.includes(String(params.categoria))) throw new AcaoInvalida('categoria');
  }
  const description = texto(1, 1000)(valor.description, 'description') as string;
  return { action_type: tipo, params, description };
}

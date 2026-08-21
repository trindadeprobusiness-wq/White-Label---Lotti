import { z } from "npm:zod@3.25.76";

const shortText = z.string().trim().min(1).max(240);
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const financialCategory = z.enum([
  "ANUNCIO_PORTAL", "ANUNCIO_SOCIAL", "ANUNCIO_TRADICIONAL",
  "OPERACIONAL_ESCRITORIO", "OPERACIONAL_TRANSPORTE", "OPERACIONAL_SISTEMA",
  "IMPOSTO_ISS", "IMPOSTO_IR", "TAXA_BANCARIA", "COMISSAO_PARCEIRO",
  "COMISSAO_VENDA", "COMISSAO_LOCACAO", "TAXA_INTERMEDIACAO",
  "HONORARIO_AVALIACAO", "CONSULTORIA", "OUTROS",
]);

const actionSchemas = {
  create_client: z.object({
    nome: shortText,
    telefone: z.string().trim().max(30).default(""),
    tipo_interesse: z.enum(["COMPRA", "LOCACAO", "AMBOS"]).optional(),
  }).strict(),
  update_client_status: z.object({
    client_id: uuid,
    status: z.enum(["QUALIFICACAO", "VISITA_PROPOSTA", "DOCUMENTACAO", "FECHADO_GANHO", "FECHADO_PERDIDO"]),
  }).strict(),
  schedule_followup: z.object({ client_id: uuid, date: isoDate }).strict(),
  create_alert: z.object({
    mensagem: z.string().trim().min(1).max(1000),
    tipo: z.enum(["FOLLOWUP", "DOCUMENTO", "EXCLUSIVIDADE", "GERAL"]).optional(),
    prioridade: z.enum(["ALTA", "MEDIA", "BAIXA"]).optional(),
  }).strict(),
  register_contact: z.object({
    client_id: uuid,
    tipo: z.string().trim().min(1).max(40),
    descricao: z.string().trim().min(1).max(4000),
  }).strict(),
  create_property: z.object({
    titulo: shortText,
    tipo: z.enum(["APARTAMENTO", "CASA", "COMERCIAL", "TERRENO"]).optional(),
    valor: z.number().finite().nonnegative().max(1_000_000_000).optional(),
    area_m2: z.number().finite().nonnegative().max(1_000_000).optional(),
    dormitorios: z.number().int().nonnegative().max(100).optional(),
    garagem: z.number().int().nonnegative().max(100).optional(),
    endereco: z.string().trim().max(500).optional(),
    bairro: z.string().trim().max(160).optional(),
    cidade: z.string().trim().max(160).optional(),
    proprietario_nome: z.string().trim().max(240).optional(),
  }).strict(),
  create_financial_entry: z.object({
    tipo: z.enum(["RECEITA", "DESPESA"]),
    categoria: financialCategory,
    descricao: z.string().trim().min(1).max(1000),
    valor: z.number().finite().positive().max(1_000_000_000),
    data: isoDate.optional(),
    recorrente: z.boolean().optional(),
  }).strict(),
} as const;

export type LottiAIActionType = keyof typeof actionSchemas;

export type ValidatedActionProposal = {
  [ActionType in LottiAIActionType]: {
    action_type: ActionType;
    params: z.infer<(typeof actionSchemas)[ActionType]>;
    description: string;
  };
}[LottiAIActionType];

export function validateActionProposal(value: Record<string, unknown>): ValidatedActionProposal {
  const actionType = z.enum(Object.keys(actionSchemas) as [LottiAIActionType, ...LottiAIActionType[]])
    .parse(value.action_type);
  const params = actionSchemas[actionType].parse(value.params);
  const description = z.string().trim().min(1).max(1000).parse(value.description);
  return { action_type: actionType, params, description } as ValidatedActionProposal;
}

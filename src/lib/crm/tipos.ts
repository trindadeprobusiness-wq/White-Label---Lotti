/** Modelo do CRM. Espelha as tabelas criadas em 20260811150000_crm_module.sql. */

export type TipoEtapa = 'ABERTA' | 'GANHO' | 'PERDIDO';

export type TipoTarefa =
  | 'LIGACAO' | 'WHATSAPP' | 'EMAIL' | 'REUNIAO' | 'VISITA' | 'PROPOSTA' | 'OUTRO';

export interface CrmEtapa {
  id: string;
  corretor_id: string;
  nome: string;
  ordem: number;
  cor: string;
  tipo: TipoEtapa;
  ativo: boolean;
}

export interface CrmOportunidade {
  id: string;
  corretor_id: string;
  cliente_id: string | null;
  imovel_id: string | null;
  etapa_id: string;
  titulo: string;
  valor_estimado: number;
  probabilidade: number;
  data_prevista_fechamento: string | null;
  motivo_perda: string | null;
  origem: string | null;
  ordem: number;
  observacoes: string | null;
  fechada_em: string | null;
  created_at: string;
  /** Token de concorrência otimista ao mover o card. */
  updated_at: string;
}

export interface CrmTarefa {
  id: string;
  corretor_id: string;
  oportunidade_id: string | null;
  cliente_id: string | null;
  titulo: string;
  descricao: string | null;
  tipo: TipoTarefa;
  data_prevista: string | null;
  concluida: boolean;
  concluida_em: string | null;
  created_at: string;
}

/** Uma coluna do Kanban. */
export interface ColunaPipeline {
  etapa: CrmEtapa;
  oportunidades: CrmOportunidade[];
  total: number;
}

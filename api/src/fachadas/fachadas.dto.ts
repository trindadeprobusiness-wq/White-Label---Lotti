import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Teto que o PostgREST aplica hoje (max-rows): o front não perde nem ganha linha. */
export const LIMITE_LISTA = 1000;

/**
 * Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. Nenhum DTO do módulo usa o
 * validador de uuid com versão do class-validator: a paridade com a URL tem de ser exata (contrato §0.2).
 */
export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** check fachadas_tipo_negocio_check. */
export const TIPOS_NEGOCIO = ['VENDA', 'ALUGUEL', 'TEMPORADA', 'LANCAMENTO'] as const;
/** check fachadas_cta_principal_check. */
export const CTAS = ['AGENDAR_VISITA', 'WHATSAPP', 'SOLICITAR_INFO', 'FAZER_PROPOSTA'] as const;
/** check fachada_templates_categoria_check. */
export const CATEGORIAS_TEMPLATE = ['VENDA', 'ALUGUEL', 'ALTO_PADRAO', 'COMERCIAL', 'RURAL', 'LANCAMENTO'] as const;
export const ESCOPOS_TEMPLATE = ['meus', 'todos'] as const;

/** foto_principal_url sai do alvo em F2: o passo 2 do service decide o valor. */
export const COLUNAS_CRIACAO = [
  'imovel_id', 'tipo_negocio', 'template_id', 'cta_principal', 'modo_conversao',
  'mensagem_whatsapp', 'mensagem_contato', 'logo_url', 'ativo',
] as const;
/** Sem imovel_id: trocar o imóvel de uma placa impressa mudaria o que o QR mostra sem mudar o QR. */
export const COLUNAS_EDICAO = [
  'tipo_negocio', 'template_id', 'cta_principal', 'modo_conversao',
  'mensagem_whatsapp', 'mensagem_contato', 'logo_url', 'foto_principal_url', 'ativo',
] as const;
export const COLUNAS_TEMPLATE = ['nome', 'categoria', 'config', 'padrao'] as const;

const M = {
  imovel: { message: 'Imóvel inválido.' },
  fachada: { message: 'Fachada inválida.' },
  tipoNegocio: { message: 'Tipo de negócio inválido.' },
  cta: { message: 'Ação principal inválida.' },
  template: { message: 'Template inválido.' },
  conversao: { message: 'Modo de conversão inválido.' },
  ativo: { message: 'Situação inválida.' },
  convertido: { message: 'Filtro de conversão inválido.' },
  mensagem: { message: 'Mensagem inválida.' },
  mensagemLonga: { message: 'Mensagem muito longa.' },
  url: { message: 'Endereço de imagem inválido.' },
  urlLonga: { message: 'Endereço de imagem muito longo.' },
  periodo: { message: 'Período inválido.' },
  escopo: { message: 'Escopo inválido.' },
  nome: { message: 'Informe o nome do template.' },
  nomeLongo: { message: 'Nome muito longo.' },
  categoria: { message: 'Categoria inválida.' },
  config: { message: 'Configuração inválida.' },
  padrao: { message: 'Valor inválido para padrão.' },
  imagem: { message: 'Informe o endereço da imagem.' },
} as const;

export class CriarFachadaDto {
  @Matches(FORMATO_UUID, M.imovel) imovel_id!: string;
  @IsIn(TIPOS_NEGOCIO, M.tipoNegocio) tipo_negocio!: string;
  @IsString(M.template) @IsNotEmpty(M.template) @MaxLength(2048, M.template) template_id!: string;
  @IsIn(CTAS, M.cta) cta_principal!: string;
  @IsBoolean(M.conversao) modo_conversao!: boolean;
  @IsOptional() @IsString(M.mensagem) @MaxLength(600, M.mensagemLonga) mensagem_whatsapp?: string;
  @IsOptional() @IsString(M.mensagem) @MaxLength(600, M.mensagemLonga) mensagem_contato?: string;
  @IsOptional() @IsString(M.url) @MaxLength(2048, M.urlLonga) logo_url?: string;
  @IsOptional() @IsString(M.url) @MaxLength(2048, M.urlLonga) foto_principal_url?: string;
  @IsOptional() @IsBoolean(M.ativo) ativo?: boolean;
}

export class EditarFachadaDto {
  @IsOptional() @IsIn(TIPOS_NEGOCIO, M.tipoNegocio) tipo_negocio?: string;
  @IsOptional() @IsString(M.template) @IsNotEmpty(M.template) @MaxLength(2048, M.template) template_id?: string;
  @IsOptional() @IsIn(CTAS, M.cta) cta_principal?: string;
  @IsOptional() @IsBoolean(M.conversao) modo_conversao?: boolean;
  @IsOptional() @IsString(M.mensagem) @MaxLength(600, M.mensagemLonga) mensagem_whatsapp?: string;
  @IsOptional() @IsString(M.mensagem) @MaxLength(600, M.mensagemLonga) mensagem_contato?: string;
  @IsOptional() @IsString(M.url) @MaxLength(2048, M.urlLonga) logo_url?: string;
  @IsOptional() @IsString(M.url) @MaxLength(2048, M.urlLonga) foto_principal_url?: string;
  @IsOptional() @IsBoolean(M.ativo) ativo?: boolean;
}

/** `@Type(() => Boolean)` não serve: Boolean('false') é true e o filtro chegaria invertido. */
const booleanoDaQuery = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class ListarLeadsDto {
  @IsOptional() @Matches(FORMATO_UUID, M.fachada) fachada_id?: string;
  /** false = só os pendentes (useLeadsPendentes); ausente = todos, como antes. */
  @IsOptional() @Transform(booleanoDaQuery) @IsBoolean(M.convertido) convertido?: boolean;
}

export class MetricasDto {
  @IsOptional() @Type(() => Number) @IsInt(M.periodo) @Min(1, M.periodo) @Max(365, M.periodo) dias?: number;
}

export class ListarTemplatesDto {
  @IsOptional() @IsIn(ESCOPOS_TEMPLATE, M.escopo) escopo?: string;
}

export class CriarTemplateDto {
  @IsString(M.nome) @IsNotEmpty(M.nome) @MaxLength(120, M.nomeLongo) nome!: string;
  @IsIn(CATEGORIAS_TEMPLATE, M.categoria) categoria!: string;
  @IsObject(M.config) config!: Record<string, unknown>;
  @IsOptional() @IsBoolean(M.padrao) padrao?: boolean;
}

export class PorImagemDto {
  @IsString(M.imagem) @IsNotEmpty(M.imagem) @MaxLength(2048, M.urlLonga) imagem_url!: string;
}

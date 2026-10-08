import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDefined, IsEmail, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsString,
  Length, Matches, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { FORMATO_SLUG, FORMATO_VISITANTE } from './publico/utilitarios';

/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** FORMATO_VISITANTE e FORMATO_SLUG vivem no porte das Edge Functions e são reexportados daqui. */
export { FORMATO_SLUG, FORMATO_VISITANTE } from './publico/utilitarios';
/** Igual ao max-rows do PostgREST que o front recebe hoje. */
export const LIMITE_LISTA = 1000;
/** O mesmo ITENS_POR_PAGINA do painel. */
export const POR_PAGINA = 25;
/** Padrão da auditoria, como hoje. */
export const POR_PAGINA_AUDITORIA = 50;
/** Padrão dos diagnósticos: o mesmo .limit(200) de hoje. */
export const POR_PAGINA_DIAGNOSTICOS = 200;
/** Formato aceito na chave de configuração (vai por parâmetro, nunca por Prisma.raw). */
export const FORMATO_CHAVE_CONFIG = /^[a-z0-9_]{1,80}$/;

export const STATUS_PARCEIRO = ['ativo', 'inativo', 'suspenso', 'encerrado'] as const;
export const TIPOS_PARCEIRO = ['afiliado', 'influenciador', 'consultor', 'comercial'] as const;
export const TIPOS_CHAVE_PIX = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'] as const;
export const BASES_CALCULO = ['receita_bruta', 'receita_liquida', 'primeiro_pagamento', 'valor_fixo'] as const;
export const STATUS_COMISSAO = ['pendente', 'em_validacao', 'aprovada', 'paga', 'cancelada', 'estornada'] as const;
export const STATUS_LOTE = ['rascunho', 'exportado', 'pago', 'falhou', 'cancelado'] as const;
export const STATUS_RECEITA = ['confirmado', 'estornado', 'cancelado'] as const;
export const TIPOS_RECEITA = ['assinatura', 'addon', 'avulso'] as const;
export const STATUS_DIAGNOSTICO = ['novo', 'em_contato', 'concluido'] as const;
export const EVENTOS_DIAGNOSTICO = [
  'diagnostic_started', 'profile_selected', 'diagnostic_step_completed', 'diagnostic_abandoned', 'cta_clicked',
] as const;
export const DIRECOES = ['asc', 'desc'] as const;
export const ORDENACOES_USUARIOS = ['criado_em', 'nome', 'ultimo_acesso_em'] as const;

const definido = (_o: unknown, v: unknown) => v !== undefined;
const preenchido = (_o: unknown, v: unknown) => v !== null && v !== undefined;
const aparar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/**
 * Booleano vindo da query string.
 *
 * `@Type(() => Boolean)` não serve aqui: `Boolean('false')` é `true`, então um filtro desligado
 * explicitamente (`?origem_direta=false`) chegaria ligado e a lista mostraria o conjunto oposto.
 */
const booleano = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

// ------------------------------------------------------------------ público

export class CliqueDto {
  @Matches(FORMATO_SLUG, { message: 'Identificador de link inválido.' }) slug!: string;
  @Matches(FORMATO_VISITANTE, { message: 'Identificador de visitante inválido.' }) visitante_id!: string;
  @ValidateIf(preenchido) @IsObject({ message: 'UTM inválido.' }) utm?: Record<string, unknown> | null;
  @ValidateIf(preenchido) @IsString({ message: 'Referência inválida.' }) @MaxLength(400, { message: 'Referência inválida.' })
  referer?: string | null;
}

export class AtribuirDto {
  @Matches(FORMATO_VISITANTE, { message: 'Identificador de visitante inválido.' }) visitante_id!: string;
}

// ------------------------------------------------------------------ portal e convite

export class SalvarRepasseDto {
  @IsString({ message: 'Informe o CPF ou CNPJ do titular.' }) @Length(11, 18, { message: 'Informe o CPF ou CNPJ do titular.' })
  documento!: string;
  @IsIn(TIPOS_CHAVE_PIX, { message: 'Tipo de chave PIX inválido.' }) tipo_chave!: string;
  @IsString({ message: 'Informe a chave PIX.' }) @Length(3, 140, { message: 'Informe a chave PIX.' }) chave!: string;
}

export class ConviteDto {
  @ValidateIf(definido) @IsIn(['criar'], { message: 'Ação inválida.' }) acao?: string;
  @ValidateIf((o: ConviteDto, v: unknown) => o.acao !== 'criar' || v !== undefined)
  @Matches(FORMATO_UUID, { message: 'Informe o parceiro.' }) parceiro_id?: string;
  @ValidateIf((o: ConviteDto, v: unknown) => o.acao === 'criar' || v !== undefined)
  @IsObject({ message: 'Informe os dados do parceiro.' }) dados?: Record<string, unknown>;
}

// ------------------------------------------------------------------ paginação e listas

export class PaginaDto {
  @ValidateIf(definido) @Type(() => Number) @IsInt({ message: 'Página inválida.' }) @Min(1, { message: 'Página inválida.' })
  @Max(10000, { message: 'Página inválida.' }) pagina?: number;
  @ValidateIf(definido) @Type(() => Number) @IsInt({ message: 'Tamanho de página inválido.' })
  @Min(1, { message: 'Tamanho de página inválido.' }) @Max(LIMITE_LISTA, { message: 'Tamanho de página inválido.' })
  por_pagina?: number;
}

export class ListarParceirosDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Busca inválida.' }) @MaxLength(200, { message: 'Busca inválida.' }) busca?: string;
  @ValidateIf(definido) @IsIn(STATUS_PARCEIRO, { message: 'Status inválido.' }) status?: string;
}

export class CriarParceiroDto {
  @Transform(aparar) @IsString({ message: 'Informe o nome.' }) @Length(2, 200, { message: 'Informe o nome.' }) nome!: string;
  @IsEmail({}, { message: 'Informe um e-mail válido.' }) email!: string;
  @IsIn(STATUS_PARCEIRO, { message: 'Status inválido.' }) status!: string;
  @ValidateIf(preenchido) @IsString({ message: 'Empresa inválida.' }) @MaxLength(300, { message: 'Empresa inválida.' }) empresa?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Documento inválido.' }) @MaxLength(300, { message: 'Documento inválido.' }) documento?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Telefone inválido.' }) @MaxLength(300, { message: 'Telefone inválido.' }) telefone?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Responsável inválido.' }) @MaxLength(300, { message: 'Responsável inválido.' })
  responsavel?: string | null;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Data de início inválida.' }) data_inicio?: string | null;
  @ValidateIf(definido) @Type(() => Number) @IsInt({ message: 'Janela de atribuição inválida.' })
  @Min(1, { message: 'Janela de atribuição inválida.' }) @Max(730, { message: 'Janela de atribuição inválida.' })
  janela_atribuicao_dias?: number;
  @ValidateIf(preenchido) @IsString({ message: 'Observações inválidas.' }) @MaxLength(300, { message: 'Observações inválidas.' })
  observacoes?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Chave PIX inválida.' }) @MaxLength(300, { message: 'Chave PIX inválida.' }) chave_pix?: string | null;
  @ValidateIf(preenchido) @IsIn(TIPOS_CHAVE_PIX, { message: 'Tipo de chave PIX inválido.' }) tipo_chave_pix?: string | null;
  @ValidateIf(preenchido) @Type(() => Number) @IsInt({ message: 'Cortesia inválida.' }) @Min(1, { message: 'Cortesia inválida.' })
  @Max(365, { message: 'Cortesia inválida.' }) cortesia_dias?: number | null;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Validade da cortesia inválida.' }) cortesia_expira_em?: string | null;
  @ValidateIf(preenchido) @IsIn(TIPOS_PARCEIRO, { message: 'Tipo de parceiro inválido.' }) tipo?: string | null;
}

/** Todos opcionais; corpo vazio dá 400 nada_para_atualizar no service. */
export class EditarParceiroDto {
  @ValidateIf(definido) @Transform(aparar) @IsString({ message: 'Informe o nome.' }) @Length(2, 200, { message: 'Informe o nome.' })
  nome?: string;
  @ValidateIf(definido) @IsEmail({}, { message: 'Informe um e-mail válido.' }) email?: string;
  @ValidateIf(definido) @IsIn(STATUS_PARCEIRO, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(preenchido) @IsString({ message: 'Empresa inválida.' }) @MaxLength(300, { message: 'Empresa inválida.' }) empresa?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Documento inválido.' }) @MaxLength(300, { message: 'Documento inválido.' }) documento?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Telefone inválido.' }) @MaxLength(300, { message: 'Telefone inválido.' }) telefone?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Responsável inválido.' }) @MaxLength(300, { message: 'Responsável inválido.' })
  responsavel?: string | null;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Data de início inválida.' }) data_inicio?: string | null;
  @ValidateIf(definido) @Type(() => Number) @IsInt({ message: 'Janela de atribuição inválida.' })
  @Min(1, { message: 'Janela de atribuição inválida.' }) @Max(730, { message: 'Janela de atribuição inválida.' })
  janela_atribuicao_dias?: number;
  @ValidateIf(preenchido) @IsString({ message: 'Observações inválidas.' }) @MaxLength(300, { message: 'Observações inválidas.' })
  observacoes?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Chave PIX inválida.' }) @MaxLength(300, { message: 'Chave PIX inválida.' }) chave_pix?: string | null;
  @ValidateIf(preenchido) @IsIn(TIPOS_CHAVE_PIX, { message: 'Tipo de chave PIX inválido.' }) tipo_chave_pix?: string | null;
  @ValidateIf(preenchido) @Type(() => Number) @IsInt({ message: 'Cortesia inválida.' }) @Min(1, { message: 'Cortesia inválida.' })
  @Max(365, { message: 'Cortesia inválida.' }) cortesia_dias?: number | null;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Validade da cortesia inválida.' }) cortesia_expira_em?: string | null;
  @ValidateIf(preenchido) @IsIn(TIPOS_PARCEIRO, { message: 'Tipo de parceiro inválido.' }) tipo?: string | null;
}

export class DefinirPercentualDto {
  @Type(() => Number) @IsNumber({}, { message: 'Percentual inválido.' }) @Min(0, { message: 'Percentual inválido.' })
  @Max(100, { message: 'Percentual inválido.' }) percentual!: number;
  @IsIn(BASES_CALCULO, { message: 'Base de cálculo inválida.' }) base_calculo!: string;
  @ValidateIf(preenchido) @Type(() => Number) @IsNumber({}, { message: 'Valor fixo inválido.' }) @Min(0, { message: 'Valor fixo inválido.' })
  valor_fixo?: number | null;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Início de vigência inválido.' }) vigencia_inicio?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Motivo inválido.' }) @MaxLength(500, { message: 'Motivo inválido.' }) motivo?: string | null;
}

export class CriarLinkDto {
  @Matches(FORMATO_SLUG, { message: 'Identificador de link inválido.' }) slug!: string;
  @ValidateIf(preenchido) @IsString({ message: 'Campanha inválida.' }) @MaxLength(120, { message: 'Campanha inválida.' }) campanha?: string | null;
  @ValidateIf(definido) @IsBoolean({ message: 'Informe se o link é o principal.' }) principal?: boolean;
}

export class ListarComissoesDto extends PaginaDto {
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Parceiro inválido.' }) parceiro_id?: string;
  @ValidateIf(definido) @IsIn(STATUS_COMISSAO, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) de?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) ate?: string;
}

export class TransicionarComissaoDto {
  @IsIn(STATUS_COMISSAO, { message: 'Status inválido.' }) novo_status!: string;
  @ValidateIf(preenchido) @IsString({ message: 'Motivo inválido.' }) @MaxLength(500, { message: 'Motivo inválido.' }) motivo?: string | null;
}

export class RegistrarPagamentoDto {
  @Matches(FORMATO_UUID, { message: 'Parceiro inválido.' }) parceiro_id!: string;
  @IsArray({ message: 'Selecione ao menos uma comissão.' }) @ArrayMinSize(1, { message: 'Selecione ao menos uma comissão.' })
  @ArrayMaxSize(LIMITE_LISTA, { message: 'Seleção grande demais.' }) @Matches(FORMATO_UUID, { each: true, message: 'Comissão inválida.' })
  comissao_ids!: string[];
  @ValidateIf(preenchido) @IsString({ message: 'Método inválido.' }) @MaxLength(200, { message: 'Método inválido.' }) metodo?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Referência inválida.' }) @MaxLength(200, { message: 'Referência inválida.' })
  referencia?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Observações inválidas.' }) @MaxLength(500, { message: 'Observações inválidas.' })
  observacoes?: string | null;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Data de pagamento inválida.' }) pago_em?: string | null;
}

export class ListarReceitaDto extends PaginaDto {
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Conta inválida.' }) corretor_id?: string;
  @ValidateIf(definido) @IsIn(STATUS_RECEITA, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) de?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) ate?: string;
}

export class RegistrarReceitaDto {
  @Matches(FORMATO_UUID, { message: 'Conta inválida.' }) corretor_id!: string;
  @Type(() => Number) @IsNumber({}, { message: 'O valor precisa ser maior que zero.' })
  @Min(0.01, { message: 'O valor precisa ser maior que zero.' }) valor_bruto!: number;
  @IsISO8601({}, { message: 'Data de confirmação inválida.' }) confirmado_em!: string;
  @ValidateIf(definido) @IsIn(TIPOS_RECEITA, { message: 'Tipo de receita inválido.' }) tipo?: string;
  @ValidateIf(preenchido) @Type(() => Number) @IsNumber({}, { message: 'Valor líquido inválido.' }) @Min(0, { message: 'Valor líquido inválido.' })
  valor_liquido?: number | null;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Competência inválida.' }) competencia?: string | null;
  @IsString({ message: 'Informe uma justificativa com ao menos 10 caracteres.' })
  @Length(10, 500, { message: 'Informe uma justificativa com ao menos 10 caracteres.' }) motivo!: string;
}

export class EstornarReceitaDto {
  @IsString({ message: 'Informe uma justificativa com ao menos 10 caracteres.' })
  @Length(10, 500, { message: 'Informe uma justificativa com ao menos 10 caracteres.' }) motivo!: string;
}

export class GerarLoteDto {
  @IsArray({ message: 'Selecione ao menos um parceiro.' }) @ArrayMinSize(1, { message: 'Selecione ao menos um parceiro.' })
  @ArrayMaxSize(LIMITE_LISTA, { message: 'Seleção grande demais.' }) @Matches(FORMATO_UUID, { each: true, message: 'Parceiro inválido.' })
  parceiro_ids!: string[];
  @ValidateIf(preenchido) @Type(() => Number) @IsNumber({}, { message: 'Saldo mínimo inválido.' }) @Min(0, { message: 'Saldo mínimo inválido.' })
  saldo_minimo?: number | null;
  @ValidateIf(preenchido) @IsString({ message: 'Observações inválidas.' }) @MaxLength(500, { message: 'Observações inválidas.' })
  observacoes?: string | null;
}

export class MarcarLotePagoDto {
  @IsISO8601({}, { message: 'Data de pagamento inválida.' }) pago_em!: string;
  @IsString({ message: 'Informe a referência do pagamento.' }) @Length(1, 200, { message: 'Informe a referência do pagamento.' })
  referencia!: string;
  @ValidateIf(preenchido) @IsString({ message: 'Comprovante inválido.' }) @MaxLength(500, { message: 'Comprovante inválido.' })
  comprovante_url?: string | null;
}

export class CancelarLoteDto {
  @IsString({ message: 'Informe uma justificativa com ao menos 10 caracteres.' })
  @Length(10, 500, { message: 'Informe uma justificativa com ao menos 10 caracteres.' }) motivo!: string;
}

export class ListarLotesDto extends PaginaDto {
  @ValidateIf(definido) @IsIn(STATUS_LOTE, { message: 'Status inválido.' }) status?: string;
}

export class ElegiveisRepasseDto {
  @ValidateIf(definido) @Type(() => Number) @IsNumber({}, { message: 'Saldo mínimo inválido.' }) @Min(0, { message: 'Saldo mínimo inválido.' })
  saldo_minimo?: number;
}

/** O JSONB aceita número, texto e objeto: só exige que o valor venha. */
export class SalvarConfigDto {
  @IsDefined({ message: 'Informe o valor.' }) valor!: unknown;
}

export class ListarAuditoriaDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Entidade inválida.' }) @MaxLength(80, { message: 'Entidade inválida.' }) entidade?: string;
  @ValidateIf(definido) @IsString({ message: 'Ação inválida.' }) @MaxLength(80, { message: 'Ação inválida.' }) acao?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) de?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) ate?: string;
}

export class RegistrarAuditoriaDto {
  @IsString({ message: 'Informe a ação.' }) @Length(1, 80, { message: 'Informe a ação.' }) acao!: string;
  @IsString({ message: 'Informe a entidade.' }) @Length(1, 80, { message: 'Informe a entidade.' }) entidade!: string;
  @ValidateIf(preenchido) @IsString({ message: 'Registro inválido.' }) @MaxLength(200, { message: 'Registro inválido.' })
  entidade_id?: string | null;
  @ValidateIf(preenchido) @IsObject({ message: 'Dados inválidos.' }) dados_antes?: Record<string, unknown> | null;
  @ValidateIf(preenchido) @IsObject({ message: 'Dados inválidos.' }) dados_depois?: Record<string, unknown> | null;
  @ValidateIf(preenchido) @IsString({ message: 'Motivo inválido.' }) @MaxLength(500, { message: 'Motivo inválido.' }) motivo?: string | null;
}

export class ListarUsuariosDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Busca inválida.' }) @MaxLength(200, { message: 'Busca inválida.' }) busca?: string;
  @ValidateIf(definido) @IsString({ message: 'Status inválido.' }) @MaxLength(200, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(definido) @IsString({ message: 'Atividade inválida.' }) @MaxLength(200, { message: 'Atividade inválida.' }) atividade?: string;
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Parceiro inválido.' }) parceiro_id?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) criado_de?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) criado_ate?: string;
  @ValidateIf(definido) @IsIn(ORDENACOES_USUARIOS, { message: 'Ordenação inválida.' }) ordenar?: string;
  @ValidateIf(definido) @IsIn(DIRECOES, { message: 'Direção inválida.' }) direcao?: string;
}

export class DefinirStatusCorretorDto {
  @IsString({ message: 'Status inválido.' }) @Length(1, 40, { message: 'Status inválido.' }) status!: string;
  @IsString({ message: 'Informe uma justificativa com ao menos 10 caracteres.' })
  @Length(10, 500, { message: 'Informe uma justificativa com ao menos 10 caracteres.' }) motivo!: string;
}

export class ListarAtendimentoDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Busca inválida.' }) @MaxLength(200, { message: 'Busca inválida.' }) busca?: string;
  @ValidateIf(definido) @IsString({ message: 'Status inválido.' }) @MaxLength(200, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(definido) @IsString({ message: 'Campanha inválida.' }) @MaxLength(200, { message: 'Campanha inválida.' }) campanha?: string;
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Parceiro inválido.' }) parceiro_id?: string;
  @ValidateIf(definido) @Transform(booleano) @IsBoolean({ message: 'Filtro de origem inválido.' }) origem_direta?: boolean;
}

export class ListarAssinaturasDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Busca inválida.' }) @MaxLength(200, { message: 'Busca inválida.' }) busca?: string;
  @ValidateIf(definido) @IsString({ message: 'Status inválido.' }) @MaxLength(200, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(definido) @IsString({ message: 'Plano inválido.' }) @MaxLength(200, { message: 'Plano inválido.' }) plano?: string;
  @ValidateIf(definido) @IsString({ message: 'Ciclo inválido.' }) @MaxLength(200, { message: 'Ciclo inválido.' }) ciclo?: string;
}

export class ListarPagamentosDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Busca inválida.' }) @MaxLength(200, { message: 'Busca inválida.' }) busca?: string;
  @ValidateIf(definido) @IsString({ message: 'Status inválido.' }) @MaxLength(200, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(definido) @IsString({ message: 'Método inválido.' }) @MaxLength(200, { message: 'Método inválido.' }) metodo?: string;
  @ValidateIf(definido) @IsString({ message: 'Plano inválido.' }) @MaxLength(200, { message: 'Plano inválido.' }) plano?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) inicio?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) fim?: string;
}

export class ListarCancelamentosDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Motivo inválido.' }) @MaxLength(200, { message: 'Motivo inválido.' }) motivo?: string;
  @ValidateIf(definido) @IsString({ message: 'Origem inválida.' }) @MaxLength(200, { message: 'Origem inválida.' }) origem?: string;
  @ValidateIf(definido) @IsString({ message: 'Plano inválido.' }) @MaxLength(200, { message: 'Plano inválido.' }) plano?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) inicio?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Informe o período.' }) fim?: string;
}

export class RegistrarCancelamentoDto {
  @IsString({ message: 'Informe o motivo.' }) @Length(1, 200, { message: 'Informe o motivo.' }) motivo!: string;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Conta inválida.' }) corretor_id?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Nome inválido.' }) @MaxLength(200, { message: 'Nome inválido.' }) contato_nome?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'E-mail inválido.' }) contato_email?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Telefone inválido.' }) @MaxLength(200, { message: 'Telefone inválido.' })
  contato_telefone?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Plano inválido.' }) @MaxLength(200, { message: 'Plano inválido.' }) plano_anterior?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Comentário inválido.' }) @MaxLength(500, { message: 'Comentário inválido.' })
  comentario?: string | null;
  @ValidateIf(definido) @IsString({ message: 'Origem inválida.' }) @MaxLength(200, { message: 'Origem inválida.' }) origem?: string;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Data inválida.' }) data?: string | null;
}

export class ListarOrganizacoesDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Busca inválida.' }) @MaxLength(200, { message: 'Busca inválida.' }) busca?: string;
  @ValidateIf(definido) @IsString({ message: 'Status inválido.' }) @MaxLength(200, { message: 'Status inválido.' }) status?: string;
  @ValidateIf(definido) @IsString({ message: 'Plano inválido.' }) @MaxLength(200, { message: 'Plano inválido.' }) plano?: string;
}

export class ListarAcessosDto extends PaginaDto {
  @ValidateIf(definido) @IsString({ message: 'Busca inválida.' }) @MaxLength(200, { message: 'Busca inválida.' }) busca?: string;
}

export class ListarDiagnosticosDto extends PaginaDto {}

export class PeriodoDto {
  @IsISO8601({}, { message: 'Informe o período.' }) inicio!: string;
  @IsISO8601({}, { message: 'Informe o período.' }) fim!: string;
}

// ------------------------------------------------------------------ diagnóstico comercial

export class EventoDiagnosticoDto {
  @Matches(FORMATO_VISITANTE, { message: 'Sessão inválida.' }) session_id!: string;
  @IsIn(EVENTOS_DIAGNOSTICO, { message: 'Evento inválido.' }) event!: string;
  @ValidateIf(definido) @IsString({ message: 'Etapa inválida.' }) @MaxLength(40, { message: 'Etapa inválida.' }) step?: string;
}

export class SubmeterDiagnosticoDto {
  @Matches(FORMATO_VISITANTE, { message: 'Sessão inválida.' }) session_id!: string;
  @IsBoolean({ message: 'Confirme o uso dos dados para contato.' }) consent!: boolean;
  @IsString({ message: 'Confira nome, WhatsApp e e-mail.' }) @Length(2, 120, { message: 'Confira nome, WhatsApp e e-mail.' }) name!: string;
  @IsString({ message: 'Confira nome, WhatsApp e e-mail.' }) @MaxLength(32, { message: 'Confira nome, WhatsApp e e-mail.' }) phone!: string;
  // '' é "sem e-mail": o formulário manda o campo vazio, e a Edge só validava e-mail preenchido.
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined && v !== '') @IsEmail({}, { message: 'Confira nome, WhatsApp e e-mail.' })
  @MaxLength(254, { message: 'Confira nome, WhatsApp e e-mail.' }) email?: string;
  @ValidateIf(definido) @IsString({ message: 'Cidade inválida.' }) @MaxLength(120, { message: 'Cidade inválida.' }) city?: string;
  @ValidateIf(definido) @IsString({ message: 'Empresa inválida.' }) @MaxLength(120, { message: 'Empresa inválida.' }) company?: string;
  @IsObject({ message: 'Respostas inválidas.' }) answers!: Record<string, unknown>;
  @ValidateIf(definido) @IsObject({ message: 'Atribuição inválida.' }) attribution?: Record<string, unknown>;
}

export class StatusDiagnosticoDto {
  @IsIn(STATUS_DIAGNOSTICO, { message: 'Status inválido.' }) status!: string;
}

import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';

export const ACOES_ONBOARDING = ['first_property', 'first_client', 'first_deal', 'first_task',
  'sample_property', 'sample_client', 'sample_deal', 'sample_task', 'remove_samples'] as const;
export const EVENTOS_ONBOARDING = ['signup_completed', 'onboarding_started', 'persona_selected',
  'organization_created', 'profile_completed', 'first_property_created', 'first_client_created',
  'first_deal_created', 'first_task_created', 'calendar_connected', 'team_member_invited', 'ai_first_used',
  'onboarding_step_skipped', 'onboarding_completed', 'onboarding_abandoned', 'first_value_reached'] as const;
export const STATUS_ETAPA = ['iniciado', 'concluido', 'pulado', 'erro'] as const;
export const STATUS_TOUR = ['concluido', 'dispensado'] as const;
export const PAPEIS_CONVITE = ['gestor', 'corretor', 'financeiro', 'juridico', 'locacoes', 'marketing', 'suporte'] as const;
export const SITUACOES_CRECI = ['nao_informado', 'aguardando_validacao', 'validado'] as const;

/** Campos que o hook ja permite hoje (useOnboarding.ts). */
export const COLUNAS_PERFIL = ['nome', 'telefone', 'foto_url', 'cidade', 'estado', 'tipo_atuacao', 'creci',
  'regioes_atendidas', 'especialidade', 'fuso_horario', 'creci_status'] as const;

/** Chave do front -> coluna de routine_organizations (useOnboarding.ts). */
export const MAPA_ORGANIZACAO = {
  nome: 'name', nome_comercial: 'trade_name', cnpj: 'cnpj', telefone: 'phone',
  email: 'email', cidade: 'city', estado: 'state', logo_url: 'logo_url', tamanho_equipe: 'team_size',
  tipo_operacao: 'operation_types', tipo_organizacao: 'organization_type', fuso_horario: 'timezone',
} as const;
export type ChaveOrganizacao = keyof typeof MAPA_ORGANIZACAO;
export const CHAVES_ORGANIZACAO = Object.keys(MAPA_ORGANIZACAO) as ChaveOrganizacao[];
export const COLUNAS_ORGANIZACAO: readonly string[] = Object.values(MAPA_ORGANIZACAO);
export const COLUNAS_CHECKLIST = ['minimized', 'dismissed_at', 'metadata', 'atualizado_em'] as const;

export class SalvarOnboardingDto {
  @IsOptional() @IsObject({ message: 'Dados do perfil inválidos.' }) profile?: Record<string, unknown>;
  @IsOptional() @IsObject({ message: 'Dados de progresso inválidos.' }) progress?: Record<string, unknown>;
  @IsOptional() @IsString({ message: 'Etapa inválida.' }) @MaxLength(80, { message: 'Etapa inválida.' }) stepKey?: string;
  @IsOptional() @IsIn(STATUS_ETAPA, { message: 'Status de etapa inválido.' }) stepStatus?: string;
}

export class AcaoOnboardingDto {
  @IsIn(ACOES_ONBOARDING, { message: 'Ação de onboarding inválida.' }) action!: string;
  @IsOptional() @IsObject({ message: 'Dados da ação inválidos.' }) payload?: Record<string, unknown>;
}

export class EventoOnboardingDto {
  @IsIn(EVENTOS_ONBOARDING, { message: 'Evento de onboarding inválido.' }) eventName!: string;
  @IsOptional() @IsString({ message: 'Etapa inválida.' }) @MaxLength(80, { message: 'Etapa inválida.' }) stepKey?: string;
  @IsOptional() @IsString({ message: 'Origem inválida.' }) @MaxLength(40, { message: 'Origem inválida.' }) source?: string;
  @IsOptional() @IsObject({ message: 'Dados do evento inválidos.' }) metadata?: Record<string, unknown>;
}

export class TourOnboardingDto {
  @IsString({ message: 'Informe o tour.' }) @IsNotEmpty({ message: 'Informe o tour.' })
  @MaxLength(80, { message: 'Informe o tour.' }) tourKey!: string;
  @IsIn(STATUS_TOUR, { message: 'Status de tour inválido.' }) status!: string;
  @IsOptional() @IsInt({ message: 'Etapa do tour inválida.' }) @Min(0, { message: 'Etapa do tour inválida.' })
  @Max(999, { message: 'Etapa do tour inválida.' }) currentStep?: number;
}

export class ChecklistOnboardingDto {
  @IsOptional() @IsBoolean({ message: 'Valor inválido para minimizado.' }) minimized?: boolean;
  @IsOptional() @IsBoolean({ message: 'Valor inválido para dispensado.' }) dismissed?: boolean;
}

export class PerfilProfissionalDto {
  @IsOptional() @IsString({ message: 'Nome inválido.' }) @MaxLength(200, { message: 'Nome inválido.' }) nome?: string;
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) @MaxLength(200, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'Foto inválida.' }) @MaxLength(200, { message: 'Foto inválida.' }) foto_url?: string;
  @IsOptional() @IsString({ message: 'Cidade inválida.' }) @MaxLength(200, { message: 'Cidade inválida.' }) cidade?: string;
  @IsOptional() @IsString({ message: 'Estado inválido.' }) @MaxLength(200, { message: 'Estado inválido.' }) estado?: string;
  @IsOptional() @IsString({ message: 'Tipo de atuação inválido.' }) @MaxLength(200, { message: 'Tipo de atuação inválido.' }) tipo_atuacao?: string;
  @IsOptional() @IsString({ message: 'CRECI inválido.' }) @MaxLength(200, { message: 'CRECI inválido.' }) creci?: string;
  @IsOptional() @IsString({ message: 'Regiões atendidas inválidas.' })
  @MaxLength(500, { message: 'Regiões atendidas inválidas.' }) regioes_atendidas?: string;
  @IsOptional() @IsString({ message: 'Especialidade inválida.' }) @MaxLength(200, { message: 'Especialidade inválida.' }) especialidade?: string;
  @IsOptional() @IsString({ message: 'Fuso horário inválido.' }) @MaxLength(200, { message: 'Fuso horário inválido.' }) fuso_horario?: string;
  @IsOptional() @IsString({ message: 'Situação de CRECI inválida.' }) @MaxLength(200, { message: 'Situação de CRECI inválida.' })
  @IsIn(SITUACOES_CRECI, { message: 'Situação de CRECI inválida.' }) creci_status?: string;
}

export class OrganizacaoDto {
  @IsOptional() @IsString({ message: 'Nome inválido.' }) @MaxLength(200, { message: 'Nome inválido.' }) nome?: string;
  @IsOptional() @IsString({ message: 'Nome comercial inválido.' }) @MaxLength(200, { message: 'Nome comercial inválido.' }) nome_comercial?: string;
  @IsOptional() @IsString({ message: 'CNPJ inválido.' }) @MaxLength(200, { message: 'CNPJ inválido.' }) cnpj?: string;
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) @MaxLength(200, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString({ message: 'Cidade inválida.' }) @MaxLength(200, { message: 'Cidade inválida.' }) cidade?: string;
  @IsOptional() @IsString({ message: 'Estado inválido.' }) @MaxLength(200, { message: 'Estado inválido.' }) estado?: string;
  @IsOptional() @IsString({ message: 'Logo inválida.' }) @MaxLength(200, { message: 'Logo inválida.' }) logo_url?: string;
  @IsOptional() @IsString({ message: 'Tamanho da equipe inválido.' }) @MaxLength(200, { message: 'Tamanho da equipe inválido.' }) tamanho_equipe?: string;
  @IsOptional() @IsArray({ message: 'Tipo de operação inválido.' }) @IsString({ each: true, message: 'Tipo de operação inválido.' })
  @ArrayMaxSize(20, { message: 'Tipo de operação inválido.' }) tipo_operacao?: string[];
  @IsOptional() @IsString({ message: 'Tipo de organização inválido.' }) @MaxLength(200, { message: 'Tipo de organização inválido.' }) tipo_organizacao?: string;
  @IsOptional() @IsString({ message: 'Fuso horário inválido.' }) @MaxLength(200, { message: 'Fuso horário inválido.' }) fuso_horario?: string;
}

export class ConviteDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' }) @MaxLength(254, { message: 'Informe um e-mail válido.' }) email!: string;
  @IsOptional() @IsIn(PAPEIS_CONVITE, { message: 'Escolha uma função válida para o convite.' }) papel?: string;
}

export class AceitarConviteDto {
  @IsString({ message: 'Informe o código do convite.' }) @IsNotEmpty({ message: 'Informe o código do convite.' })
  @MaxLength(200, { message: 'Informe o código do convite.' }) token!: string;
}

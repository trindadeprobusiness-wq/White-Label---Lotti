import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Igual ao max-rows do PostgREST que o front recebe hoje. */
export const LIMITE_LISTA = 1000;
export const LIMITE_ATIVIDADE = 40;

export const PRIORIDADES = ['low', 'medium', 'high', 'urgent'] as const;
export const VISIBILIDADES = ['team', 'private'] as const;
export const ORIGENS_EVENTO = ['lotti', 'google', 'automation', 'ai', 'other_user'] as const;
export const ORIGENS_TAREFA = [...ORIGENS_EVENTO, 'inbox'] as const;
export const TIPOS_INBOX = ['idea', 'note', 'request', 'task', 'audio', 'message', 'service_extract'] as const;
export const MODOS_PRIVACIDADE = ['full', 'partial', 'busy_only'] as const;
export const ACOES_SYNC = ['sync', 'push_event', 'resolve_conflict_lotti', 'resolve_conflict_google'] as const;
export const DIRECOES_SYNC = ['import_only', 'export_only', 'bidirectional', 'disabled'] as const;

export const COLUNAS_EDICAO_EVENTO = [
  'title', 'description', 'activity_type', 'priority', 'assigned_to', 'visibility', 'start_at', 'end_at', 'all_day',
  'recurrence_rule', 'location', 'client_id', 'property_id',
] as const;
export const COLUNAS_EDICAO_TAREFA = [
  'title', 'description', 'activity_type', 'priority', 'assigned_to', 'visibility', 'due_at', 'recurrence_rule', 'client_id', 'property_id',
] as const;
export const COLUNAS_NOVO_EVENTO = [...COLUNAS_EDICAO_EVENTO, 'source'] as const;
export const COLUNAS_NOVA_TAREFA = [...COLUNAS_EDICAO_TAREFA, 'source'] as const;
export const COLUNAS_CALENDARIO = ['selected', 'is_default', 'sync_direction'] as const;

const definido = (_o: unknown, v: unknown) => v !== undefined;
const preenchido = (_o: unknown, v: unknown) => v !== null && v !== undefined;
const aparar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListarEventosDto {
  @IsISO8601({}, { message: 'Informe o período.' }) inicio!: string;
  @IsISO8601({}, { message: 'Informe o período.' }) fim!: string;
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Responsável inválido.' }) responsavel?: string;
}

export class ListarTarefasDto {
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Responsável inválido.' }) responsavel?: string;
}

export class CriarEventoDto {
  @Transform(aparar) @IsString({ message: 'Informe o título.' }) @Length(1, 180, { message: 'Informe o título.' }) title!: string;
  @ValidateIf(preenchido) @IsString({ message: 'Descrição inválida.' }) @MaxLength(5000, { message: 'Descrição inválida.' }) description?: string | null;
  @IsString({ message: 'Tipo de atividade inválido.' }) @Length(1, 60, { message: 'Tipo de atividade inválido.' }) activity_type!: string;
  @IsIn(PRIORIDADES, { message: 'Prioridade inválida.' }) priority!: string;
  @Matches(FORMATO_UUID, { message: 'Responsável inválido.' }) assigned_to!: string;
  @IsIn(VISIBILIDADES, { message: 'Visibilidade inválida.' }) visibility!: string;
  @IsISO8601({}, { message: 'Início inválido.' }) start_at!: string;
  @IsISO8601({}, { message: 'Término inválido.' }) end_at!: string;
  @IsBoolean({ message: 'Informe se é o dia inteiro.' }) all_day!: boolean;
  @ValidateIf(preenchido) @IsString({ message: 'Recorrência inválida.' }) @MaxLength(500, { message: 'Recorrência inválida.' }) recurrence_rule?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Local inválido.' }) @MaxLength(300, { message: 'O local pode ter até 300 caracteres.' }) location?: string | null;
  @ValidateIf(definido) @IsIn(ORIGENS_EVENTO, { message: 'Origem inválida.' }) source?: string;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) client_id?: string | null;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) property_id?: string | null;
  @ValidateIf(preenchido) @IsInt({ message: 'Lembrete inválido.' }) @Min(0, { message: 'Lembrete inválido.' }) @Max(525600, { message: 'Lembrete inválido.' }) reminder_minutes?: number | null;
}

export class CriarTarefaDto {
  @Transform(aparar) @IsString({ message: 'Informe o título.' }) @Length(1, 180, { message: 'Informe o título.' }) title!: string;
  @ValidateIf(preenchido) @IsString({ message: 'Descrição inválida.' }) @MaxLength(5000, { message: 'Descrição inválida.' }) description?: string | null;
  @IsString({ message: 'Tipo de atividade inválido.' }) @Length(1, 60, { message: 'Tipo de atividade inválido.' }) activity_type!: string;
  @IsIn(PRIORIDADES, { message: 'Prioridade inválida.' }) priority!: string;
  @Matches(FORMATO_UUID, { message: 'Responsável inválido.' }) assigned_to!: string;
  @IsIn(VISIBILIDADES, { message: 'Visibilidade inválida.' }) visibility!: string;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Prazo inválido.' }) due_at?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Recorrência inválida.' }) @MaxLength(500, { message: 'Recorrência inválida.' }) recurrence_rule?: string | null;
  @ValidateIf(definido) @IsIn(ORIGENS_TAREFA, { message: 'Origem inválida.' }) source?: string;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) client_id?: string | null;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) property_id?: string | null;
}

export class EditarEventoDto {
  @ValidateIf(definido) @Transform(aparar) @IsString({ message: 'Informe o título.' }) @Length(1, 180, { message: 'Informe o título.' }) title?: string;
  @ValidateIf(preenchido) @IsString({ message: 'Descrição inválida.' }) @MaxLength(5000, { message: 'Descrição inválida.' }) description?: string | null;
  @ValidateIf(definido) @IsString({ message: 'Tipo de atividade inválido.' }) @Length(1, 60, { message: 'Tipo de atividade inválido.' }) activity_type?: string;
  @ValidateIf(definido) @IsIn(PRIORIDADES, { message: 'Prioridade inválida.' }) priority?: string;
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Responsável inválido.' }) assigned_to?: string;
  @ValidateIf(definido) @IsIn(VISIBILIDADES, { message: 'Visibilidade inválida.' }) visibility?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Início inválido.' }) start_at?: string;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Término inválido.' }) end_at?: string;
  @ValidateIf(definido) @IsBoolean({ message: 'Informe se é o dia inteiro.' }) all_day?: boolean;
  @ValidateIf(preenchido) @IsString({ message: 'Recorrência inválida.' }) @MaxLength(500, { message: 'Recorrência inválida.' }) recurrence_rule?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Local inválido.' }) @MaxLength(300, { message: 'O local pode ter até 300 caracteres.' }) location?: string | null;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) client_id?: string | null;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) property_id?: string | null;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Versão da atividade inválida.' }) expected_updated_at?: string;
}

export class EditarTarefaDto {
  @ValidateIf(definido) @Transform(aparar) @IsString({ message: 'Informe o título.' }) @Length(1, 180, { message: 'Informe o título.' }) title?: string;
  @ValidateIf(preenchido) @IsString({ message: 'Descrição inválida.' }) @MaxLength(5000, { message: 'Descrição inválida.' }) description?: string | null;
  @ValidateIf(definido) @IsString({ message: 'Tipo de atividade inválido.' }) @Length(1, 60, { message: 'Tipo de atividade inválido.' }) activity_type?: string;
  @ValidateIf(definido) @IsIn(PRIORIDADES, { message: 'Prioridade inválida.' }) priority?: string;
  @ValidateIf(definido) @Matches(FORMATO_UUID, { message: 'Responsável inválido.' }) assigned_to?: string;
  @ValidateIf(definido) @IsIn(VISIBILIDADES, { message: 'Visibilidade inválida.' }) visibility?: string;
  @ValidateIf(preenchido) @IsISO8601({}, { message: 'Prazo inválido.' }) due_at?: string | null;
  @ValidateIf(preenchido) @IsString({ message: 'Recorrência inválida.' }) @MaxLength(500, { message: 'Recorrência inválida.' }) recurrence_rule?: string | null;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) client_id?: string | null;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) property_id?: string | null;
  @ValidateIf(definido) @IsISO8601({}, { message: 'Versão da atividade inválida.' }) expected_updated_at?: string;
}

export class ConflitosDto {
  @Matches(FORMATO_UUID, { message: 'Responsável inválido.' }) assigned_to!: string;
  @IsISO8601({}, { message: 'Início inválido.' }) start_at!: string;
  @IsISO8601({}, { message: 'Término inválido.' }) end_at!: string;
  @ValidateIf(preenchido) @Matches(FORMATO_UUID, { message: 'Atividade inválida.' }) exclude_event_id?: string | null;
}

export class CriarInboxDto {
  @Transform(aparar) @IsString({ message: 'Escreva a anotação.' }) @Length(1, 5000, { message: 'Escreva a anotação.' }) content!: string;
  @ValidateIf(definido) @IsIn(TIPOS_INBOX, { message: 'Tipo de anotação inválido.' }) kind?: string;
}

export class ConfigurarPrivacidadeDto {
  @IsIn(MODOS_PRIVACIDADE, { message: 'Modo de privacidade inválido.' }) privacy_mode!: string;
}

export class ConfigurarCalendarioDto {
  @ValidateIf(definido) @IsBoolean({ message: 'Seleção inválida.' }) selected?: boolean;
  @ValidateIf(definido) @IsBoolean({ message: 'Calendário padrão inválido.' }) is_default?: boolean;
  @ValidateIf(definido) @IsIn(DIRECOES_SYNC, { message: 'Direção de sincronização inválida.' }) sync_direction?: string;
}

export class SincronizarDto {
  @ValidateIf(definido) @IsIn(ACOES_SYNC, { message: 'Ação de sincronização inválida.' }) action: (typeof ACOES_SYNC)[number] = 'sync';
  @ValidateIf((o: SincronizarDto) => (o.action ?? 'sync') !== 'sync' || o.event_id !== undefined)
  @Matches(FORMATO_UUID, { message: 'Informe a atividade.' }) event_id?: string;
}

export class ComandoDto {
  @Transform(aparar) @IsString({ message: 'Escreva o que deseja organizar.' }) @Length(1, 2000, { message: 'Escreva o que deseja organizar.' }) command!: string;
  @ValidateIf(definido) @IsString({ message: 'Fuso horário inválido.' }) @MaxLength(80, { message: 'Fuso horário inválido.' }) timezone?: string;
}

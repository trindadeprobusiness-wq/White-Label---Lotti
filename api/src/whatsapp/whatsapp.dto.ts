import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class BridgeDto {
  @IsIn(['status', 'connect', 'disconnect', 'send', 'start', 'prepare_upload']) action!: string;
  @IsOptional() @IsUUID() conversation_id?: string;
  @IsOptional() @IsUUID() request_id?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(8000) text?: string;
  @IsOptional() @IsIn(['text', 'file', 'audio']) kind?: string;
  @IsOptional() @IsString() audio?: string;
  @IsOptional() @IsString() @MaxLength(200) mime?: string;
  @IsOptional() @IsString() @MaxLength(180) storage_path?: string;
  @IsOptional() @IsInt() @Min(1) @Max(104857600) size?: number;
  // Responder citando: id (lotti_agent_messages.id) da mensagem citada; o banco confere que é da conversa.
  @IsOptional() @IsUUID() quoted_message_id?: string;
}

export class ModoDto { @IsIn(['ai', 'human', 'paused']) mode!: string; }
export class ReconciliarDto { @IsBoolean() chegou!: boolean; }
export class ContatoDto { @IsString() @MaxLength(120) name!: string; @IsString() @MaxLength(15) phone!: string; }
export class MesclarDto { @IsUUID() keep!: string; @IsUUID() drop!: string; }
export class StatusDto { @IsIn(['open', 'closed']) status!: string; }
export class EmpresaDto { @IsString() @MaxLength(80) name!: string; }
export class ConfiguracoesDto { @IsObject() settings!: Record<string, unknown>; }
export class CampanhaDto { @IsObject() campaign!: Record<string, unknown>; }
export class ControleCampanhaDto { @IsIn(['pause', 'resume', 'cancel']) action!: string; }


import { IsOptional, IsUUID, Matches, ValidateIf } from 'class-validator';

export class SolicitarVisitaDto {
  @IsUUID() conversationId!: string;
  @IsUUID() corretorId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/) data!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) hora!: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() imovelId?: string | null;
}

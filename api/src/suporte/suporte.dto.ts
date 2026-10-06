import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

/**
 * Abertura do atendimento. A conta vem por `corretor_id` (o que o backoffice tem na rota
 * /suporte/:id e o que a Edge recebia) ou por `usuario_id` (auth.users.id do titular) — uma só.
 */
export class AbrirSuporteDto {
  @ValidateIf((o: AbrirSuporteDto) => o.usuario_id === undefined)
  @IsUUID('all', { message: 'Conta inválida.' })
  corretor_id?: string;

  @ValidateIf((o: AbrirSuporteDto) => o.corretor_id === undefined)
  @IsUUID('all', { message: 'Conta inválida.' })
  usuario_id?: string;

  /** Vai para admin_auditoria.motivo; sem ele, o texto de sempre ('Atendimento pelo backoffice'). */
  @IsOptional()
  @IsString({ message: 'Motivo inválido.' })
  @MaxLength(500, { message: 'Motivo muito longo (até 500 caracteres).' })
  motivo?: string;
}

export class EncerrarSuporteDto {
  @IsUUID('all', { message: 'Sessão inválida.' })
  sessao_id!: string;
}

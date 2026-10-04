import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const TIPOS = ['APARTAMENTO', 'CASA', 'COMERCIAL', 'TERRENO'] as const;
export const FINALIDADES = ['VENDA', 'LOCACAO', 'AMBOS'] as const;

export class BuscaImoveisDto {
  @IsOptional() @IsString() @MaxLength(80) cidade?: string;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @IsOptional() @IsIn(TIPOS) tipo?: (typeof TIPOS)[number];
  @IsOptional() @IsIn(FINALIDADES) finalidade?: (typeof FINALIDADES)[number];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) valorMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) valorMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) dormitoriosMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

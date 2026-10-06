import {
  Allow, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength,
} from 'class-validator';

// Os campos com @Allow() são conferidos no service, à mão, com as mesmas regras e textos da Edge
// Function (normalizeLottiAIRequest, validateSuggestionInput...). O @Allow só os põe na whitelist do
// ValidationPipe (forbidNonWhitelisted recusa qualquer chave fora do DTO).

/** Corpo do ai-assistant. */
export class AssistenteDto {
  @Allow() message?: unknown;
  @Allow() conversation_id?: unknown;
  @Allow() file_context?: unknown;
  @Allow() module?: unknown;
  @Allow() intent?: unknown;
  @Allow() locale?: unknown;
  @Allow() timezone?: unknown;
  @Allow() output_mode?: unknown;
  @Allow() trace_id?: unknown;
  @Allow() entity_refs?: unknown;
  @Allow() requires_confirmation?: unknown;
}

/** Renomear (AIConversationList) e fixar (useAIChat.togglePin). */
export class AlterarConversaDto {
  @IsOptional() @IsString({ message: 'Título inválido.' }) @MaxLength(200, { message: 'Título muito longo.' }) title?: string;
  @IsOptional() @IsBoolean({ message: 'Valor inválido para fixar.' }) pinned?: boolean;
}

const SOLICITACAO = { message: 'Solicitação inválida.' };

/** Corpo do ai-action. */
export class DecisaoAcaoDto {
  @IsString(SOLICITACAO) @Matches(/^[0-9a-f-]{36}$/i, SOLICITACAO) proposal_id!: string;
  @IsIn(['confirm', 'reject'], SOLICITACAO) decision!: 'confirm' | 'reject';
}

export const MIMES_FOTO = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** A imagem é reduzida no cliente antes de enviar; este limite é uma salvaguarda (~6 MB). */
export const MAX_BASE64_FOTO = 8_000_000;

const IMAGEM = { message: 'Imagem inválida ou muito grande' };

/** Corpo do analisar-foto. */
export class AnalisarFotoDto {
  @IsString(IMAGEM) @IsNotEmpty(IMAGEM) @MaxLength(MAX_BASE64_FOTO, IMAGEM) imageBase64!: string;
  @IsIn(MIMES_FOTO, { message: 'Formato de imagem inválido' }) mimeType!: string;
}

export const MAX_FOTOS_IMOVEL = 25;
/** ~2,2 MB cada, já reduzidas no navegador. */
export const MAX_BASE64_POR_FOTO = 3_000_000;

const FOTO = { message: 'Alguma foto está inválida ou grande demais.', each: true };

/** Corpo do analisar-fotos-imovel. descricao_atual e dados_imovel são lidos com asString, como na função. */
export class AnalisarFotosImovelDto {
  @IsArray({ message: 'Envie ao menos uma foto.' })
  @ArrayMinSize(1, { message: 'Envie ao menos uma foto.' })
  @ArrayMaxSize(MAX_FOTOS_IMOVEL, { message: `Máximo de ${MAX_FOTOS_IMOVEL} fotos por análise.` })
  @IsString(FOTO) @IsNotEmpty(FOTO) @MaxLength(MAX_BASE64_POR_FOTO, FOTO)
  imagens!: string[];

  @Allow() descricao_atual?: unknown;
  @Allow() dados_imovel?: unknown;
}

/** "Usar a sugestão" do OrganizarFotosIA. */
export class DescricaoImovelDto {
  @IsString({ message: 'Texto inválido.' }) @MaxLength(10_000, { message: 'Texto muito longo.' }) descricao!: string;
}

/** Corpo do generate-whatsapp-message. */
export class MensagemWhatsappDto {
  @IsString({ message: 'Nome do cliente é obrigatório.' }) @IsNotEmpty({ message: 'Nome do cliente é obrigatório.' }) clientName!: string;
  @Allow() messageType?: unknown;
  @Allow() details?: unknown;
  @Allow() tone?: unknown;
}

/** Corpo do inbox-suggest. */
export class SugestaoInboxDto {
  @Allow() propertyId?: unknown;
  @Allow() question?: unknown;
}

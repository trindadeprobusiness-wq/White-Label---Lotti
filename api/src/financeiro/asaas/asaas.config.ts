import { HttpException, Logger } from '@nestjs/common';
import { normalizarChave } from './asaas-crypto';

/**
 * Variáveis do módulo (contrato §2.0), lidas de process.env a cada chamada. Só os NOMES aparecem aqui;
 * nenhuma delas entra em src/config/env.ts.
 */
export const VAR_CHAVE_CIFRA = 'ASAAS_TOKEN_ENCRYPTION_KEY';
export const VAR_BASE_URL = 'ASAAS_BASE_URL';
export const VAR_WEBHOOK_URL_BASE = 'ASAAS_WEBHOOK_URL_BASE';
export const VAR_PROCESSAR_FILA = 'ASAAS_PROCESSAR_FILA';

const logger = new Logger('AsaasConfig');

/** Sem importar financeiro.erros (que importa asaas-http, que importa este arquivo). */
export const naoConfigurado = () => new HttpException(
  { statusCode: 503, codigo: 'asaas_nao_configurado', message: 'Integração com a Asaas indisponível no momento.' }, 503);

/** Chave da cifra dos segredos. Ausente ou mal formada → 503 (o motivo vai só para o log, sem a chave). */
export function chaveCifra(): string {
  const bruto = process.env[VAR_CHAVE_CIFRA];
  if (!bruto?.trim()) throw naoConfigurado();
  try {
    normalizarChave(bruto);
  } catch {
    logger.error({ codigo: 'chave_cifra_invalida' });
    throw naoConfigurado();
  }
  return bruto;
}

/** URL pública da API, sem barra no fim (D6). Ausente → 503. */
export function urlWebhookBase(): string {
  const bruto = process.env[VAR_WEBHOOK_URL_BASE]?.trim();
  if (!bruto) throw naoConfigurado();
  return bruto.replace(/\/+$/, '');
}

/** Sobrescrita da URL de produção (homologação com mock). */
export function baseUrlProducao(): string | undefined {
  const bruto = process.env[VAR_BASE_URL]?.trim();
  return bruto || undefined;
}

export function processarFilaLigado(): boolean {
  return process.env[VAR_PROCESSAR_FILA] === 'true';
}

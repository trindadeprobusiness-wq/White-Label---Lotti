/**
 * Config do cliente S3 (Garage) a partir de process.env. Lida a cada uso: os testes trocam as
 * variáveis sem reiniciar o módulo, e a produção pode subir a config depois do boot. Nenhum valor
 * de segredo é registrado em log — aqui só se decide se a config existe. Faltando qualquer variável
 * obrigatória, devolve null e a rota responde 503 storage_indisponivel (contrato §1.3).
 */
export interface ConfigStorage {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

const texto = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export function lerConfigStorage(env: NodeJS.ProcessEnv = process.env): ConfigStorage | null {
  const endpoint = texto(env.S3_ENDPOINT);
  const region = texto(env.S3_REGION);
  const accessKeyId = texto(env.S3_ACCESS_KEY_ID);
  const secretAccessKey = texto(env.S3_SECRET_ACCESS_KEY);
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) return null;
  // forcePathStyle é opcional e vem ligado por padrão (Garage é path-style).
  const forcePathStyle = texto(env.S3_FORCE_PATH_STYLE)?.toLowerCase() !== 'false';
  return { endpoint, region, accessKeyId, secretAccessKey, forcePathStyle };
}

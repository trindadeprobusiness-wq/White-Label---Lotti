import { HttpException } from '@nestjs/common';

/** Erro no formato do contrato (§0.4): { statusCode, codigo, message }. */
export function erroArquivo(status: number, codigo: string, message: string): HttpException {
  return new HttpException({ statusCode: status, codigo, message }, status);
}

/** Catálogo único dos erros de arquivo (storage + rotas). Nenhum texto do S3/Postgres é repassado. */
export const ERROS_ARQUIVO = {
  keyInvalida: () => erroArquivo(400, 'key_invalida', 'Caminho de arquivo inválido.'),
  sessaoAusente: () => erroArquivo(401, 'sessao_ausente', 'Sessão ausente.'),
  deOutraConta: () => erroArquivo(403, 'arquivo_de_outra_conta', 'Este arquivo não pertence a esta conta.'),
  naoEncontrado: () => erroArquivo(404, 'arquivo_nao_encontrado', 'Arquivo não encontrado.'),
  grandeDemais: () => erroArquivo(413, 'arquivo_grande_demais', 'O arquivo é maior que o limite permitido.'),
  indisponivel: () => erroArquivo(503, 'storage_indisponivel', 'O armazenamento de arquivos não está configurado no servidor.'),
};

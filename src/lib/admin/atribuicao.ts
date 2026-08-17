/**
 * Lado cliente da atribuição de parceiro.
 *
 * O que fica guardado no navegador é APENAS um UUID opaco. Nem o parceiro, nem
 * o percentual, nem o link trafegam por aqui — na conversão o servidor relê o
 * clique que ele mesmo gravou. Editar o localStorage não permite reivindicar a
 * comissão de outro parceiro; no máximo, se atribuir a um clique próprio.
 */

const CHAVE_VISITANTE = '@lotti/visitante_id';
const CHAVE_PENDENTE = '@lotti/atribuicao_pendente';
const CHAVE_NOME_PARCEIRO = '@lotti/parceiro_nome';
const CHAVE_ATIVIDADE = '@lotti/atividade_em';

/** 30 min entre registros de atividade: medimos presença, não navegação. */
const INTERVALO_ATIVIDADE_MS = 30 * 60_000;

/** localStorage pode lançar (modo privado, cota, iframe sem permissão). */
function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* sem storage, a atribuição simplesmente não acontece */
  }
}

function apagar(chave: string): void {
  try {
    localStorage.removeItem(chave);
  } catch {
    /* idem */
  }
}

/** Id do visitante, criado na primeira visita e reusado depois. */
export function obterVisitanteId(): string {
  const existente = ler(CHAVE_VISITANTE);
  if (existente) return existente;

  const novo =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : // Fallback para navegador antigo sem randomUUID. Não precisa ser
        // criptograficamente forte: é uma chave de busca, não um segredo.
        `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4000-8000-${Math.random()
          .toString(16)
          .slice(2, 14)}`.padEnd(36, '0');

  gravar(CHAVE_VISITANTE, novo);
  return novo;
}

/**
 * Marca que existe uma atribuição a reivindicar no próximo login.
 *
 * O nome do parceiro é guardado só para a faixa "Você chegou pela indicação
 * de X" na tela de cadastro. É rótulo de interface, não credencial: quem é o
 * parceiro de verdade o servidor decide relendo o clique que ele registrou.
 * Trocar este nome no localStorage muda um texto na tela e nada mais.
 */
export function marcarAtribuicaoPendente(nomeParceiro?: string): void {
  gravar(CHAVE_PENDENTE, '1');
  if (nomeParceiro) gravar(CHAVE_NOME_PARCEIRO, nomeParceiro);
}

export function nomeParceiroIndicador(): string | null {
  return ler(CHAVE_NOME_PARCEIRO);
}

export function temAtribuicaoPendente(): boolean {
  return ler(CHAVE_PENDENTE) === '1';
}

export function limparAtribuicaoPendente(): void {
  apagar(CHAVE_PENDENTE);
  apagar(CHAVE_NOME_PARCEIRO);
}

/**
 * Passou tempo suficiente desde o último registro de atividade?
 *
 * Sem isto, cada troca de rota gravaria uma linha em atividade_eventos. O que a
 * operação precisa saber é "esta pessoa usou o produto hoje", não cada clique.
 */
export function deveRegistrarAtividade(agora = Date.now()): boolean {
  const ultimo = Number(ler(CHAVE_ATIVIDADE) ?? 0);
  if (!Number.isFinite(ultimo) || ultimo <= 0) return true;
  return agora - ultimo >= INTERVALO_ATIVIDADE_MS;
}

export function marcarAtividadeRegistrada(agora = Date.now()): void {
  gravar(CHAVE_ATIVIDADE, String(agora));
}

export const CHAVES_ATRIBUICAO = {
  visitante: CHAVE_VISITANTE,
  pendente: CHAVE_PENDENTE,
  nomeParceiro: CHAVE_NOME_PARCEIRO,
  atividade: CHAVE_ATIVIDADE,
} as const;

export { INTERVALO_ATIVIDADE_MS };

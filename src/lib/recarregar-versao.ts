// Deploy novo troca os chunks; a aba antiga falha ao abrir uma tela sob demanda. Recarregamos UMA vez
// (janela de 10s) para pegar a versão nova, sem tela de erro. O guard por tempo evita loop caso o chunk
// esteja de fato indisponível.
const CHAVE = 'vite-preload-reload-at';
const JANELA_MS = 10_000;

let recarregando = false;

/** Esta aba já pediu o reload: o que quebrar até ele terminar é consequência, não erro para mostrar. */
export function estaRecarregando(): boolean {
  return recarregando;
}

/** true se recarregou agora; false se já tinha recarregado há menos de 10s. */
export function recarregarParaVersaoNova(): boolean {
  let ultimo = 0;
  try {
    ultimo = Number(sessionStorage.getItem(CHAVE) || 0);
  } catch {
    // sessionStorage bloqueado: recarrega mesmo assim (o guard por tempo some, mas é um caso raro)
  }
  if (Date.now() - ultimo <= JANELA_MS) return false;
  try {
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    // idem
  }
  recarregando = true;
  window.location.reload();
  return true;
}

/** Recarregou há menos de 10s (outra falha logo depois do reload). */
export function recarregouHaPouco(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(CHAVE) || 0) < JANELA_MS;
  } catch {
    return false;
  }
}

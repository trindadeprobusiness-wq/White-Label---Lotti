import { create } from 'zustand';
import { CHAVE_VALORES_OCULTOS, lerPreferenciaOculta } from '@/lib/privacidade';

/**
 * Interruptor global de "esconder valores", no modelo de aplicativo de banco.
 *
 * O que ele resolve: antes cada valor na tela tinha o próprio olhinho e
 * começava escondido. Na tela de Financeiro isso obrigava o corretor a clicar
 * em três olhos para ver os próprios números — toda vez que abria a página, e
 * de novo ao voltar. Proteger dado é bom; esconder do dono por padrão, não.
 *
 * Agora é um controle só, no topo, que vale para o sistema inteiro e é
 * lembrado. Padrão visível; esconder é escolha, para quando alguém está
 * olhando por cima do ombro ou a tela está sendo compartilhada.
 *
 * A máscara é apenas visual — nenhum valor é alterado, e cálculo, busca e
 * exportação continuam usando o número verdadeiro.
 */

/** Leitura tolerante: sem localStorage (vitest roda em node), assume visível. */
function carregar(): boolean {
  try {
    return lerPreferenciaOculta(localStorage.getItem(CHAVE_VALORES_OCULTOS));
  } catch {
    return false;
  }
}

/** Gravação tolerante: modo privado do navegador pode recusar a escrita. */
function salvar(oculto: boolean): void {
  try {
    localStorage.setItem(CHAVE_VALORES_OCULTOS, String(oculto));
  } catch {
    // Sem persistência a preferência vale só nesta sessão, o que é melhor do
    // que quebrar o clique no botão.
  }
}

interface PrivacidadeState {
  valoresOcultos: boolean;
  alternar: () => void;
  definir: (oculto: boolean) => void;
}

export const usePrivacidade = create<PrivacidadeState>((set, get) => ({
  valoresOcultos: carregar(),

  alternar: () => {
    const proximo = !get().valoresOcultos;
    salvar(proximo);
    set({ valoresOcultos: proximo });
  },

  definir: (oculto) => {
    salvar(oculto);
    set({ valoresOcultos: oculto });
  },
}));

/**
 * A mensagem que o corretor manda para o lead que escaneou a placa.
 *
 * Não confundir com `mensagem_whatsapp`, que é o caminho contrário: aquela é o
 * texto que o LEAD envia ao tocar no botão da página pública. Esta é a
 * abordagem do corretor, e por isso tem o nome de quem escaneou e o imóvel da
 * placa — é essa lembrança que faz a conversa começar sem "quem é você?".
 *
 * O botão "Contactar" abria o WhatsApp em branco. Quem clica tem que escrever
 * do zero, toda vez, e acaba mandando "oi" para alguém que não lembra de nada.
 */

export interface DadosDaMensagem {
  /** Nome como o lead escreveu no formulário da placa. */
  nome?: string | null;
  /** Título do imóvel anunciado naquela fachada. */
  imovel?: string | null;
  /** Valor já formatado, como aparece no anúncio. */
  valor?: string | null;
}

/** O que o corretor pode usar no texto. Aparece como ajuda na tela. */
export const CAMPOS_DA_MENSAGEM = ['nome', 'imovel', 'valor'] as const;

export const MENSAGEM_PADRAO =
  'Olá {nome}! Vi que você se interessou pelo {imovel} pelo QR code da placa. Posso te passar mais detalhes?';

/** Primeiro nome: "Maria Aparecida da Silva" vira "Maria". */
function primeiroNome(nome?: string | null): string {
  const limpo = (nome ?? '').trim();
  if (!limpo) return '';
  return limpo.split(/\s+/)[0];
}

/**
 * Preenche o modelo. Campo sem valor vira vazio e o espaço em volta é
 * recolhido, para não sobrar "interessou pelo  ." quando a fachada não tem
 * imóvel vinculado.
 */
export function montarMensagemDeContato(modelo: string | null | undefined, dados: DadosDaMensagem): string {
  const base = (modelo ?? '').trim() || MENSAGEM_PADRAO;
  const valores: Record<string, string> = {
    nome: primeiroNome(dados.nome),
    imovel: (dados.imovel ?? '').trim(),
    valor: (dados.valor ?? '').trim(),
  };

  return base
    .replace(/\{(\w+)\}/g, (original, campo: string) =>
      campo in valores ? valores[campo] : original)
    // Dois espaços viram um, e espaço antes de pontuação some.
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

/** Link do WhatsApp já com o texto. Sem o texto, o corretor digita do zero. */
export function linkDeContato(telefone: string, mensagem: string): string {
  const numero = telefone.replace(/\D/g, '');
  // O formulário da placa guarda o telefone sem o país; o link precisa dele.
  const comPais = numero.startsWith('55') ? numero : `55${numero}`;
  return `https://wa.me/${comPais}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Briefing de template de fachada → prompt de geração de imagem.
 *
 * O corretor não é designer e quase nunca tem uma arte pronta. Pedir só
 * "envie sua imagem" transformava a tela num beco sem saída. Aqui o sistema
 * faz as perguntas certas, monta o prompt no lugar dele e entrega pronto para
 * colar num gerador de imagem.
 *
 * Módulo puro de propósito: nenhum acesso a React, DOM, Supabase ou rede. É o
 * que permite testar a montagem do prompt e o limite da URL sem subir a tela.
 */

/* ── Vocabulário do briefing ────────────────────────────────────────────── */

export type FormatoArte =
  | 'PLACA_VERTICAL'
  | 'PLACA_HORIZONTAL'
  | 'FAIXA'
  | 'POST'
  | 'STORY';

export type ObjetivoArte = 'VENDA' | 'ALUGUEL' | 'LANCAMENTO' | 'TEMPORADA';

export type EstiloArte =
  | 'MODERNO'
  | 'CLASSICO'
  | 'ALTO_PADRAO'
  | 'MINIMALISTA'
  | 'VIBRANTE';

/** Onde fica o quadrado vazio que o sistema preenche com o QR do imóvel. */
export type AreaQr =
  | 'INFERIOR_DIREITA'
  | 'INFERIOR_ESQUERDA'
  | 'INFERIOR_CENTRO'
  | 'CENTRO';

export type DestinoIA = 'CHATGPT' | 'GROK' | 'GEMINI';

export interface OpcaoFormato {
  id: FormatoArte;
  nome: string;
  /** Onde essa arte é usada, na linguagem de quem vende imóvel. */
  uso: string;
  /** Dimensão pedida ao gerador, em px. */
  dimensao: string;
  proporcao: string;
}

export const FORMATOS: OpcaoFormato[] = [
  {
    id: 'PLACA_VERTICAL',
    nome: 'Placa vertical',
    uso: 'Placa de calçada e cavalete',
    dimensao: '1080 x 1440 px',
    proporcao: '3:4',
  },
  {
    id: 'PLACA_HORIZONTAL',
    nome: 'Placa horizontal',
    uso: 'Placa de muro e portão',
    dimensao: '1600 x 1200 px',
    proporcao: '4:3',
  },
  {
    id: 'FAIXA',
    nome: 'Faixa de fachada',
    uso: 'Faixa comprida presa na sacada',
    dimensao: '2400 x 800 px',
    proporcao: '3:1',
  },
  {
    id: 'POST',
    nome: 'Post de Instagram',
    uso: 'Publicação no feed',
    dimensao: '1080 x 1080 px',
    proporcao: '1:1',
  },
  {
    id: 'STORY',
    nome: 'Story e Reels',
    uso: 'Story do Instagram e status do WhatsApp',
    dimensao: '1080 x 1920 px',
    proporcao: '9:16',
  },
];

export const OBJETIVOS: Record<ObjetivoArte, { nome: string; frase: string }> = {
  VENDA: {
    nome: 'Vender',
    frase: 'anunciar um imóvel à venda',
  },
  ALUGUEL: {
    nome: 'Alugar',
    frase: 'anunciar um imóvel para locação',
  },
  LANCAMENTO: {
    nome: 'Lançamento',
    frase: 'divulgar o lançamento de um empreendimento',
  },
  TEMPORADA: {
    nome: 'Temporada',
    frase: 'anunciar um imóvel para aluguel por temporada',
  },
};

export const ESTILOS: Record<EstiloArte, { nome: string; descricao: string }> = {
  MODERNO: {
    nome: 'Moderno',
    descricao:
      'blocos de cor chapada, tipografia sem serifa de peso alto, formas geométricas simples e bastante contraste',
  },
  CLASSICO: {
    nome: 'Clássico',
    descricao:
      'composição centralizada, tipografia serifada, moldura discreta e paleta sóbria',
  },
  ALTO_PADRAO: {
    nome: 'Alto padrão',
    descricao:
      'fundo escuro, tipografia serifada fina, detalhes metálicos, muito espaço vazio e nenhuma poluição visual',
  },
  MINIMALISTA: {
    nome: 'Minimalista',
    descricao:
      'fundo claro e liso, um único peso tipográfico, nenhum ornamento e hierarquia feita só por tamanho',
  },
  VIBRANTE: {
    nome: 'Vibrante',
    descricao:
      'cores saturadas, diagonais, tipografia larga e sensação de urgência',
  },
};

export const AREAS_QR: Record<
  AreaQr,
  { nome: string; descricao: string; posicao: { x: number; y: number } }
> = {
  INFERIOR_DIREITA: {
    nome: 'Canto inferior direito',
    descricao: 'no canto inferior direito',
    posicao: { x: 76, y: 78 },
  },
  INFERIOR_ESQUERDA: {
    nome: 'Canto inferior esquerdo',
    descricao: 'no canto inferior esquerdo',
    posicao: { x: 24, y: 78 },
  },
  INFERIOR_CENTRO: {
    nome: 'Rodapé, centralizado',
    descricao: 'centralizado na faixa inferior',
    posicao: { x: 50, y: 80 },
  },
  CENTRO: {
    nome: 'Centro da arte',
    descricao: 'no centro da arte',
    posicao: { x: 50, y: 50 },
  },
};

/** Itens que o corretor decide estampar. A ordem aqui é a ordem na tela. */
export const DESTAQUES_DISPONIVEIS = [
  'Logo da empresa',
  'WhatsApp',
  'CRECI',
  'Site',
  'Nome do corretor',
  'Selo "Aceita financiamento"',
  'Selo "Agende sua visita"',
] as const;

export type DestaqueArte = (typeof DESTAQUES_DISPONIVEIS)[number];

export interface BriefingTemplate {
  formato: FormatoArte;
  objetivo: ObjetivoArte;
  estilo: EstiloArte;
  areaQr: AreaQr;
  /** Quanto da largura o quadrado do QR ocupa, em %. */
  tamanhoQr: number;
  empresa: string;
  telefone: string;
  creci: string;
  site: string;
  corPrimaria: string;
  corSecundaria: string;
  chamada: string;
  destaques: DestaqueArte[];
  observacoes: string;
}

/* ── Higienização ───────────────────────────────────────────────────────── */

/**
 * Caracteres de controle, incluindo quebra de linha. Escrito com `new RegExp`
 * porque um literal com esse intervalo deixaria bytes de controle crus no
 * próprio arquivo-fonte.
 */
// eslint-disable-next-line no-control-regex
const CONTROLE = new RegExp('[\\u0000-\\u001F\\u007F]+', 'g');

/**
 * Campo livre entra num prompt e depois numa URL de terceiro. Tira quebras de
 * linha e caracteres de controle (que desmontariam a estrutura em blocos do
 * prompt) e limita o tamanho — sem isso um colar acidental de 40 KB viraria
 * uma URL que nenhum navegador abre.
 */
export function limparCampo(valor: string | null | undefined, limite = 120): string {
  if (!valor) return '';
  return valor
    .replace(CONTROLE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limite);
}

/** Cor precisa ser hex válido antes de virar instrução de marca. */
export function limparCor(valor: string | null | undefined, padrao: string): string {
  const v = (valor ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : padrao;
}

export const BRIEFING_PADRAO: BriefingTemplate = {
  formato: 'PLACA_VERTICAL',
  objetivo: 'VENDA',
  estilo: 'MODERNO',
  areaQr: 'INFERIOR_DIREITA',
  tamanhoQr: 25,
  empresa: '',
  telefone: '',
  creci: '',
  site: '',
  corPrimaria: '#093323',
  corSecundaria: '#D4AF37',
  chamada: '',
  destaques: ['Logo da empresa', 'WhatsApp', 'CRECI'],
  observacoes: '',
};

/* ── Montagem do prompt ─────────────────────────────────────────────────── */

/** Chamada de efeito por objetivo, quando o corretor não escreve a dele. */
const CHAMADA_PADRAO: Record<ObjetivoArte, string> = {
  VENDA: 'VEJA ESSE IMÓVEL POR DENTRO',
  ALUGUEL: 'ESTE IMÓVEL ESTÁ PARA ALUGAR',
  LANCAMENTO: 'CONHEÇA O LANÇAMENTO',
  TEMPORADA: 'RESERVE SUA TEMPORADA',
};

/**
 * Transforma o briefing no prompt que o corretor leva para o gerador.
 *
 * O texto é escrito em blocos com títulos em caixa alta porque é assim que os
 * modelos de imagem seguem instrução longa sem misturar os requisitos. O bloco
 * da área do QR é o mais importante: sem ele, o gerador desenha um QR falso e
 * a arte fica inutilizável — o QR real só existe quando a fachada é criada.
 */
export function montarPromptTemplate(briefing: BriefingTemplate): string {
  const formato = FORMATOS.find((f) => f.id === briefing.formato) ?? FORMATOS[0];
  const objetivo = OBJETIVOS[briefing.objetivo];
  const estilo = ESTILOS[briefing.estilo];
  const areaQr = AREAS_QR[briefing.areaQr];

  const empresa = limparCampo(briefing.empresa, 80);
  const telefone = limparCampo(briefing.telefone, 30);
  const creci = limparCampo(briefing.creci, 30);
  const site = limparCampo(briefing.site, 80);
  const observacoes = limparCampo(briefing.observacoes, 400);
  const chamada = limparCampo(briefing.chamada, 60) || CHAMADA_PADRAO[briefing.objetivo];
  const corPrimaria = limparCor(briefing.corPrimaria, BRIEFING_PADRAO.corPrimaria);
  const corSecundaria = limparCor(briefing.corSecundaria, BRIEFING_PADRAO.corSecundaria);
  const tamanhoQr = Math.round(Math.min(60, Math.max(10, briefing.tamanhoQr || 25)));

  const marcado = (item: DestaqueArte) => briefing.destaques.includes(item);

  const blocos: string[] = [];

  blocos.push(
    'Crie a arte de uma placa imobiliária profissional, pronta para impressão.',
  );

  blocos.push(
    ['FORMATO', `${formato.dimensao} (proporção ${formato.proporcao}), alta resolução. Uso: ${formato.uso.toLowerCase()}.`].join(
      '\n',
    ),
  );

  blocos.push(
    ['OBJETIVO', `A arte serve para ${objetivo.frase} e fazer quem passa na rua escanear o QR Code.`].join('\n'),
  );

  const marca = [`Cor principal: ${corPrimaria}. Cor de apoio: ${corSecundaria}.`];
  if (empresa) marca.unshift(`Empresa: ${empresa}.`);
  if (marcado('Logo da empresa')) {
    marca.push(
      'Anexei a logo da empresa nesta conversa: use exatamente essa imagem, sem redesenhar nem alterar as cores dela.',
    );
  }
  blocos.push(['MARCA', marca.join(' ')].join('\n'));

  blocos.push(['ESTILO', `${estilo.nome}: ${estilo.descricao}.`].join('\n'));

  const conteudo = [`- Chamada principal, em destaque: "${chamada}"`];
  if (marcado('WhatsApp') && telefone) conteudo.push(`- WhatsApp: ${telefone}`);
  if (marcado('CRECI') && creci) conteudo.push(`- CRECI: ${creci}`);
  if (marcado('Site') && site) conteudo.push(`- Site: ${site}`);
  if (marcado('Nome do corretor') && empresa) conteudo.push(`- Assinatura: ${empresa}`);
  if (marcado('Selo "Aceita financiamento"')) conteudo.push('- Selo pequeno: "Aceita financiamento"');
  if (marcado('Selo "Agende sua visita"')) conteudo.push('- Selo pequeno: "Agende sua visita"');
  blocos.push(['O QUE PRECISA APARECER', conteudo.join('\n')].join('\n'));

  blocos.push(
    [
      'ÁREA RESERVADA PARA O QR CODE',
      `Deixe um quadrado branco, liso e completamente vazio ${areaQr.descricao}, ocupando cerca de ${tamanhoQr}% da largura da arte.`,
      'Não desenhe QR Code, código de barras nem qualquer padrão dentro desse quadrado: o sistema insere o QR real do imóvel nesse espaço depois.',
    ].join('\n'),
  );

  const regras = [
    '- Nenhum texto além dos listados acima.',
    '- Todo o texto em português do Brasil, escrito corretamente e legível de longe.',
    '- Sem marca d\'água, sem moldura de mockup e sem foto de imóvel cobrindo a arte inteira.',
    '- Deixe margem de segurança de 5% em todas as bordas, para o corte da gráfica.',
    `- Entregue a imagem final em PNG, ${formato.dimensao}.`,
  ];
  blocos.push(['REGRAS', regras.join('\n')].join('\n'));

  if (observacoes) {
    blocos.push(['OBSERVAÇÕES DO CORRETOR', observacoes].join('\n'));
  }

  return blocos.join('\n\n');
}

/* ── Envio para o chat de IA ────────────────────────────────────────────── */

interface BaseIA {
  nome: string;
  url: string;
  /** O site aceita o prompt pela query string `?q=`. */
  aceitaPrompt: boolean;
}

const BASES_IA: Record<DestinoIA, BaseIA> = {
  CHATGPT: { nome: 'ChatGPT', url: 'https://chatgpt.com/', aceitaPrompt: true },
  GROK: { nome: 'Grok', url: 'https://grok.com/', aceitaPrompt: true },
  // O Gemini não tem parâmetro público de prompt: abre limpo e o corretor cola.
  GEMINI: { nome: 'Gemini', url: 'https://gemini.google.com/app', aceitaPrompt: false },
};

export const DESTINOS_IA = (Object.keys(BASES_IA) as DestinoIA[]).map((id) => ({
  id,
  nome: BASES_IA[id].nome,
}));

/**
 * Teto do prompt codificado dentro da URL. Navegador aguenta muito mais, mas
 * proxies e o próprio destino cortam URL longa em silêncio — e um prompt
 * cortado no meio gera arte errada. Acima do teto, abrimos o chat limpo e o
 * corretor cola o que já está na área de transferência.
 */
export const LIMITE_QUERY = 6000;

export interface LinkIA {
  url: string;
  nome: string;
  /** false = o chat abre vazio e o texto precisa ser colado. */
  promptNaUrl: boolean;
}

export function linkParaIA(destino: DestinoIA, prompt: string): LinkIA {
  const base = BASES_IA[destino] ?? BASES_IA.CHATGPT;
  if (!base.aceitaPrompt) {
    return { url: base.url, nome: base.nome, promptNaUrl: false };
  }

  const q = encodeURIComponent(prompt);
  if (q.length > LIMITE_QUERY) {
    return { url: base.url, nome: base.nome, promptNaUrl: false };
  }

  return { url: `${base.url}?q=${q}`, nome: base.nome, promptNaUrl: true };
}

/**
 * Nome sugerido para o template, a partir do briefing. Existe para o corretor
 * não travar num campo em branco: ele renomeia se quiser.
 */
export function sugerirNome(briefing: BriefingTemplate): string {
  const formato = FORMATOS.find((f) => f.id === briefing.formato) ?? FORMATOS[0];
  return `${formato.nome} · ${OBJETIVOS[briefing.objetivo].nome} · ${ESTILOS[briefing.estilo].nome}`;
}

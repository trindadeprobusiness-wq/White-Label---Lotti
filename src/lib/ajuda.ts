/**
 * Conteúdo e busca da ajuda.
 *
 * Antes o "?" do topo era um botão morto: tinha tooltip e não abria nada.
 * Um ícone que não faz nada é pior que a ausência dele — o corretor clica,
 * não acontece nada, e ele conclui que o sistema está quebrado.
 *
 * Duas decisões que moldam este arquivo:
 *
 *  1. **A ajuda é contextual.** Abrir na tela de Fachadas e receber uma lista
 *     de tudo o que o sistema faz não ajuda ninguém. O que a pessoa quer é o
 *     assunto da tela onde ela travou.
 *  2. **Nada aqui descreve função que não existe.** Todo passo abaixo
 *     corresponde a um botão ou fluxo real. Documentação que promete o que o
 *     produto não faz gasta a confiança que ela deveria construir.
 *
 * Lógica pura, separada do componente, porque o vitest deste projeto roda em
 * node sem jsdom — e conteúdo com regra de busca é conteúdo testável.
 */

export interface TopicoAjuda {
  id: string;
  titulo: string;
  /** Uma frase: o que isto resolve. */
  resumo: string;
  /**
   * Rotas onde o tópico é contextual. `'*'` aparece em todas.
   * Prefixo casa com subrota: `/clientes` cobre `/clientes/:id`.
   */
  rotas: readonly string[];
  passos?: readonly string[];
  /** Ressalva que evita erro caro. Aparece destacada. */
  atencao?: string;
  /** Sinônimos que a pessoa digitaria e que não estão no título. */
  termos?: readonly string[];
}

export const TOPICOS: readonly TopicoAjuda[] = [
  {
    id: 'sino',
    titulo: 'Notificações do Asaas no sino',
    resumo:
      'O sino avisa quando entra dinheiro de aluguel e quando um repasse ao proprietário é confirmado.',
    rotas: ['*'],
    passos: [
      'O número vermelho no sino conta as notificações não lidas. Vermelho significa que há algo crítico; verde-escuro, apenas coisas novas.',
      'Abra e use as abas Todas / Financeiro / Operação para separar dinheiro de tarefa.',
      'Verde com "+" é dinheiro que entrou. Escuro com "−" é repasse que saiu.',
      'Valor riscado em vermelho quer dizer que a transferência NÃO foi concluída — o proprietário não recebeu.',
      'Clique na notificação para ir direto à fatura ou ao repasse de origem.',
    ],
    atencao:
      'As notificações chegam sozinhas, sem recarregar a página. Se você ficar mais de um minuto com a aba em segundo plano, ela também se atualiza ao voltar.',
    termos: ['sino', 'notificacao', 'alerta', 'asaas', 'aviso', 'badge', 'pix'],
  },
  {
    id: 'busca',
    titulo: 'Encontrar um cliente, imóvel ou contrato',
    resumo: 'A busca do topo procura nos três ao mesmo tempo, sem esperar carregamento.',
    rotas: ['/', '/crm', '/clientes'],
    passos: [
      'Aperte Ctrl+K (Cmd+K no Mac) de qualquer lugar para focar a busca.',
      'Digite pelo menos 2 letras. Vale nome, telefone, e-mail, endereço ou bairro.',
      'Use as setas ↑ ↓ para percorrer e Enter para abrir.',
    ],
    termos: ['busca', 'procurar', 'pesquisar', 'atalho', 'ctrl k', 'localizar'],
  },
  {
    id: 'cliente-novo',
    titulo: 'Cadastrar um cliente e movê-lo no funil',
    resumo: 'Todo lead vira um cliente com etapa, e é a etapa que organiza o seu dia.',
    rotas: ['/clientes', '/crm', '/'],
    passos: [
      'Em Clientes, use "Novo cliente". Nome e telefone bastam para começar.',
      'Já tem uma lista pronta? "Importar" traz vários de uma vez.',
      'A etapa do funil começa em Qualificação e você a avança em Funil de Vendas.',
      'Marque o próximo follow-up: é ele que faz o cliente aparecer em "Prioridades de hoje" no Início.',
    ],
    termos: ['cliente', 'lead', 'contato', 'funil', 'etapa', 'importar', 'followup'],
  },
  {
    id: 'imovel-novo',
    titulo: 'Cadastrar um imóvel',
    resumo: 'Imóvel sem preço ou sem endereço não aparece bem em fachada nem em anúncio.',
    rotas: ['/imoveis', '/'],
    passos: [
      'Use "Novo imóvel" no topo do Início ou da tela de Imóveis.',
      'Preencha preço e endereço: o Início lista separadamente os imóveis com cadastro incompleto.',
      'Adicione fotos — a primeira vira a capa usada na página pública do QR Code.',
    ],
    termos: ['imovel', 'propriedade', 'casa', 'apartamento', 'cadastro', 'foto'],
  },
  {
    id: 'fachada',
    titulo: 'Criar uma fachada com QR Code',
    resumo:
      'Transforma a placa do imóvel em captação: quem passa na frente escaneia e vira contato.',
    rotas: ['/fachadas'],
    passos: [
      'Clique em "Nova fachada" e escolha o imóvel — ou cadastre um novo ali mesmo, sem sair da janela.',
      'Escolha o template e o tipo de negócio (venda ou locação).',
      'Gere o QR Code, baixe e mande imprimir na placa.',
      'Divulgue o link da fachada, não o PDF: o link não expira e ainda registra cada escaneamento.',
    ],
    atencao:
      'O QR Code nunca muda. Editar a fachada, trocar a foto ou até corrigir os dados do imóvel mantém o mesmo código — a placa já impressa continua valendo para sempre. Só excluir a fachada encerra aquele código.',
    termos: ['fachada', 'qr', 'qrcode', 'placa', 'captacao', 'lead', 'escaneamento'],
  },
  {
    id: 'cobranca',
    titulo: 'Emitir a cobrança do aluguel',
    resumo: 'A fatura sai pelo Asaas com boleto e PIX, usando os dados do contrato.',
    rotas: ['/alugueis'],
    passos: [
      'Vá em Aluguéis › Faturas e localize a fatura em Pendentes.',
      'Emita a cobrança: multa, juros e vencimento vêm do contrato, não de padrões da conta Asaas.',
      'Se o inquilino pagar por fora, use "Baixar" para registrar o recebimento em dinheiro.',
      'Recebeu errado? "Desfazer o pagamento" reverte no Asaas e aqui.',
    ],
    atencao:
      'O vencimento é o dia do contrato no mês de referência. Se essa data já passou, o Asaas não aceita e a cobrança sai com vencimento hoje.',
    termos: ['cobranca', 'fatura', 'boleto', 'pix', 'aluguel', 'asaas', 'emitir', 'baixar'],
  },
  {
    id: 'repasse',
    titulo: 'Repassar o aluguel ao proprietário',
    resumo: 'O repasse nasce sozinho quando a fatura é paga, e a baixa pode ser automática.',
    rotas: ['/alugueis'],
    passos: [
      'Assim que a fatura é marcada como paga, o sistema cria o repasse já com a sua comissão descontada.',
      'Faça o PIX ao proprietário pelo painel do Asaas.',
      'Quando a transferência é concluída, o repasse é baixado sozinho e o sino te avisa.',
    ],
    atencao:
      'A baixa automática casa a transferência pelo valor exato mais a chave PIX do proprietário. Havendo dois repasses em aberto de mesmo valor para a mesma chave, o sistema NÃO escolhe: ele registra a pendência e deixa para você. Adivinhar com dinheiro de terceiro é pior que não dar baixa.',
    termos: ['repasse', 'proprietario', 'transferencia', 'pix', 'comissao', 'baixa'],
  },
  {
    id: 'contrato-ia',
    titulo: 'Gerar ou analisar um contrato com IA',
    resumo: 'A IA lê um contrato existente e preenche imóvel, cliente, valor e datas.',
    rotas: ['/juridico'],
    passos: [
      'Em Jurídico, use "Gerar contrato com IA" para criar do zero a partir dos dados já cadastrados.',
      'Para importar um contrato que você já tem, envie o arquivo e deixe a IA extrair os campos.',
      'Confira o que foi extraído antes de salvar.',
    ],
    atencao:
      'A IA erra. Ela adianta a digitação, não substitui a sua conferência — principalmente em valor, prazo e índice de reajuste.',
    termos: ['contrato', 'ia', 'juridico', 'gerar', 'analisar', 'importar', 'minuta'],
  },
  {
    id: 'documentos',
    titulo: 'Guardar documentos e acompanhar prazos',
    resumo: 'Documento vinculado ao cliente para de sumir em pasta de WhatsApp.',
    rotas: ['/juridico'],
    passos: [
      'Use "Enviar documento" e vincule ao cliente correspondente.',
      'A aba Documentos separa o que está Validado do que está Pendente.',
      'A aba Contratos acompanha vigência e vencimento.',
    ],
    termos: ['documento', 'arquivo', 'upload', 'pendente', 'validado', 'prazo'],
  },
  {
    id: 'financeiro',
    titulo: 'Ver o resultado e exportar',
    resumo: 'Receitas menos despesas no período que você escolher.',
    rotas: ['/financeiro'],
    passos: [
      'Escolha o período no topo; "personalizado" libera datas livres.',
      'O cartão de resultado mostra receitas, despesas e o saldo do período.',
      '"Exportar" gera a planilha do que está filtrado na tela — não do banco inteiro.',
    ],
    termos: ['financeiro', 'receita', 'despesa', 'resultado', 'exportar', 'planilha', 'periodo'],
  },
  {
    id: 'midias',
    titulo: 'Organizar fotos e vídeos',
    resumo: 'Banco de mídia por imóvel, para reaproveitar em anúncio sem caçar arquivo.',
    rotas: ['/midias'],
    passos: [
      '"Enviar mídia" sobe fotos e vídeos e vincula ao imóvel.',
      'A aba Biblioteca filtra por imóvel.',
      '"Gerar fotos com IA" cria variações a partir do que você já tem.',
    ],
    termos: ['midia', 'foto', 'video', 'imagem', 'biblioteca', 'upload', 'ia'],
  },
  {
    id: 'assistente',
    titulo: 'Usar o Assistente de IA',
    resumo: 'O assistente enxerga seus clientes e imóveis e responde sobre eles.',
    rotas: ['*'],
    passos: [
      'Abra o Assistente IA na barra lateral, ou o balão no canto inferior direito.',
      'Pergunte em português comum: "quais leads estão parados há mais de 15 dias?".',
      'Ele responde com base nos seus dados, não em informação genérica de internet.',
    ],
    termos: ['ia', 'assistente', 'chat', 'lotti', 'perguntar', 'inteligencia'],
  },
];

/** Acento fora e caixa baixa: ninguém digita "notificação" com til na pressa. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * O tópico pertence a esta rota?
 *
 * Prefixo, para `/clientes` cobrir `/clientes/abc`. A raiz é a exceção: se
 * `'/'` casasse por prefixo, o Início apareceria em todas as telas.
 */
export function pertenceARota(topico: TopicoAjuda, rota: string): boolean {
  return topico.rotas.some((r) => {
    if (r === '*') return true;
    if (r === '/') return rota === '/';
    return rota === r || rota.startsWith(`${r}/`);
  });
}

/**
 * Tópicos da tela atual, os gerais por último.
 *
 * Quem abre a ajuda em Fachadas quer fachada — o sino e a busca continuam
 * disponíveis, mas embaixo.
 */
export function topicosDaRota(rota: string): TopicoAjuda[] {
  const daTela = TOPICOS.filter(
    (t) => pertenceARota(t, rota) && !t.rotas.includes('*'),
  );
  const gerais = TOPICOS.filter((t) => t.rotas.includes('*'));
  return [...daTela, ...gerais];
}

/**
 * Busca em todo o conteúdo, não só no título.
 *
 * A pessoa procura pelo problema ("não recebi aviso do pix"), não pelo nome
 * que demos ao tópico. Por isso passos e sinônimos também entram — mas
 * pesando menos, para o título continuar ganhando quando ele casa.
 */
export function buscarTopicos(termo: string, rotaAtual?: string): TopicoAjuda[] {
  const q = normalizar(termo);
  if (q.length < 2) return rotaAtual ? topicosDaRota(rotaAtual) : [...TOPICOS];

  const palavras = q.split(/\s+/).filter(Boolean);

  const pontuados = TOPICOS.map((t) => {
    const titulo = normalizar(t.titulo);
    const termos = (t.termos ?? []).map(normalizar).join(' ');
    const resumo = normalizar(t.resumo);
    const corpo = normalizar(
      [...(t.passos ?? []), t.atencao ?? ''].join(' '),
    );

    let peso = 0;
    for (const p of palavras) {
      if (titulo.includes(p)) peso += 8;
      else if (termos.includes(p)) peso += 5;
      else if (resumo.includes(p)) peso += 3;
      else if (corpo.includes(p)) peso += 1;
    }

    // Empate desfeito pela tela: quem está em Fachadas quer o tópico de
    // fachada antes do genérico que menciona a palavra de passagem.
    if (peso > 0 && rotaAtual && pertenceARota(t, rotaAtual) && !t.rotas.includes('*')) {
      peso += 2;
    }
    return { t, peso };
  });

  return pontuados
    .filter((x) => x.peso > 0)
    .sort((a, b) => b.peso - a.peso)
    .map((x) => x.t);
}

/** Atalhos que existem de verdade. Não listar o que não está implementado. */
export const ATALHOS: readonly { teclas: string; acao: string }[] = [
  { teclas: 'Ctrl K', acao: 'Ir para a busca' },
  { teclas: '?', acao: 'Abrir esta ajuda' },
  { teclas: 'Esc', acao: 'Fechar o que estiver aberto' },
];

/**
 * O que estes testes protegem: a ajuda só serve se achar o assunto pelo termo
 * que a pessoa REALMENTE digita — sem acento, com a palavra do problema e não
 * com o nome que demos ao tópico. Uma ajuda que não acha nada é igual ao botão
 * morto que ela veio substituir.
 */
import { describe, it, expect } from 'vitest';
import {
  TOPICOS,
  ATALHOS,
  normalizar,
  pertenceARota,
  topicosDaRota,
  buscarTopicos,
} from './ajuda';

describe('normalizar', () => {
  it('tira acento e caixa — ninguém digita til na pressa', () => {
    expect(normalizar('Notificações')).toBe('notificacoes');
    expect(normalizar('  CobranÇA  ')).toBe('cobranca');
  });
});

describe('pertenceARota', () => {
  const fachada = TOPICOS.find((t) => t.id === 'fachada')!;
  const sino = TOPICOS.find((t) => t.id === 'sino')!;
  const cliente = TOPICOS.find((t) => t.id === 'cliente-novo')!;

  it('tópico geral aparece em qualquer tela', () => {
    expect(pertenceARota(sino, '/fachadas')).toBe(true);
    expect(pertenceARota(sino, '/')).toBe(true);
  });

  it('rota casa com subrota', () => {
    expect(pertenceARota(cliente, '/clientes/abc-123')).toBe(true);
  });

  it('a raiz NÃO casa por prefixo', () => {
    // Se "/" casasse por prefixo, o tópico do Início apareceria em todas as
    // telas e a ajuda contextual deixaria de ser contextual.
    expect(pertenceARota(cliente, '/juridico')).toBe(false);
  });

  it('não vaza tópico de outra tela', () => {
    expect(pertenceARota(fachada, '/financeiro')).toBe(false);
  });
});

describe('topicosDaRota', () => {
  it('põe o assunto da tela antes dos gerais', () => {
    const lista = topicosDaRota('/fachadas');
    expect(lista[0].id).toBe('fachada');
    expect(lista.some((t) => t.id === 'sino')).toBe(true);
  });

  it('toda tela tem pelo menos os gerais — a ajuda nunca abre vazia', () => {
    for (const rota of ['/', '/crm', '/clientes', '/imoveis', '/financeiro',
                        '/juridico', '/midias', '/fachadas', '/alugueis',
                        '/configuracoes', '/rota-que-nao-existe']) {
      expect(topicosDaRota(rota).length).toBeGreaterThan(0);
    }
  });
});

describe('buscarTopicos', () => {
  it('acha pelo termo sem acento', () => {
    expect(buscarTopicos('notificacao')[0].id).toBe('sino');
    expect(buscarTopicos('cobranca')[0].id).toBe('cobranca');
  });

  it('acha pelo sinônimo que não está no título', () => {
    // "qrcode" não aparece no título "Criar uma fachada com QR Code".
    expect(buscarTopicos('qrcode')[0].id).toBe('fachada');
  });

  it('acha pelo problema, não pelo nome do tópico', () => {
    const ids = buscarTopicos('proprietario nao recebeu').map((t) => t.id);
    expect(ids).toContain('repasse');
  });

  it('título pesa mais que menção de passagem no corpo', () => {
    const r = buscarTopicos('fachada');
    expect(r[0].id).toBe('fachada');
  });

  it('a tela atual desempata', () => {
    // "pix" aparece em cobrança, repasse e no sino. Em Aluguéis, os dois
    // tópicos daquela tela têm que vir na frente do geral.
    const emAlugueis = buscarTopicos('pix', '/alugueis').map((t) => t.id);
    expect(emAlugueis.indexOf('sino')).toBeGreaterThan(0);
    expect(emAlugueis.slice(0, 2).sort()).toEqual(['cobranca', 'repasse']);
  });

  it('termo curto devolve o contexto da tela em vez de nada', () => {
    // Enquanto a pessoa digita a primeira letra, sumir com tudo faria a ajuda
    // piscar em branco.
    expect(buscarTopicos('c', '/fachadas')[0].id).toBe('fachada');
  });

  it('termo sem resultado devolve lista vazia, não a lista inteira', () => {
    expect(buscarTopicos('xyzabc')).toEqual([]);
  });
});

describe('integridade do conteúdo', () => {
  it('ids são únicos', () => {
    const ids = TOPICOS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo tópico tem resumo e ao menos uma rota', () => {
    for (const t of TOPICOS) {
      expect(t.resumo.length).toBeGreaterThan(10);
      expect(t.rotas.length).toBeGreaterThan(0);
    }
  });

  it('os atalhos documentados são só os que existem', () => {
    expect(ATALHOS.map((a) => a.teclas)).toEqual(['Ctrl K', '?', 'Esc']);
  });
});

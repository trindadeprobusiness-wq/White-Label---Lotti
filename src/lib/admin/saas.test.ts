/**
 * O critério de aceite do repasse é aritmético: o CSV precisa somar exatamente
 * o total que a tela mostrou. Como os valores chegam do Postgres como `number`
 * do JSON, somar em ponto flutuante produz a diferença de centavo que ninguém
 * consegue explicar depois — e num lote de repasse essa diferença é dinheiro.
 *
 * Estes testes existem para travar isso, não para conferir rótulo.
 */
import { describe, it, expect } from 'vitest';
import {
  somarValores,
  totalSelecionado,
  resumoSelecao,
  podeSelecionar,
  motivoInelegivel,
  rotuloMotivo,
  rotuloOrigem,
  MOTIVOS,
  ORIGENS,
  ROTULO_ASSINATURA,
  rotuloAssinatura,
  rotuloStatusConta,
  rotuloAtividade,
  ROTULO_PAGAMENTO,
  type ParceiroElegivel,
} from './saas';
import { montarCsv, BOM, type ColunaCsv } from './csv';

function parceiro(over: Partial<ParceiroElegivel> = {}): ParceiroElegivel {
  return {
    parceiro_id: over.parceiro_id ?? 'p1',
    nome: over.nome ?? 'Ana Souza',
    email: over.email ?? 'ana@exemplo.com',
    documento: over.documento ?? '12345678900',
    chave_pix: over.chave_pix !== undefined ? over.chave_pix : 'ana@exemplo.com',
    tipo_chave_pix: over.tipo_chave_pix !== undefined ? over.tipo_chave_pix : 'email',
    comissoes: over.comissoes ?? 1,
    valor: over.valor ?? 100,
    elegivel: over.elegivel ?? true,
  };
}

describe('somarValores', () => {
  it('não acumula erro de ponto flutuante', () => {
    // 0.1 + 0.2 === 0.30000000000000004 em IEEE-754.
    expect(somarValores([0.1, 0.2])).toBe(0.3);
  });

  it('soma centavos de muitos parceiros sem desvio', () => {
    const valores = Array.from({ length: 40 }, () => 10.07);
    expect(somarValores(valores)).toBe(402.8);
    // A soma ingênua diverge: prova de que o cuidado não é decorativo.
    const ingenua = valores.reduce((a, b) => a + b, 0);
    expect(ingenua).not.toBe(402.8);
  });

  it('devolve 0 para lista vazia', () => {
    expect(somarValores([])).toBe(0);
  });

  it('ignora valores não finitos em vez de propagar NaN', () => {
    expect(somarValores([10, Number.NaN, 5, Number.POSITIVE_INFINITY])).toBe(15);
  });
});

describe('totalSelecionado', () => {
  const itens = [
    parceiro({ parceiro_id: 'a', valor: 33.33 }),
    parceiro({ parceiro_id: 'b', valor: 66.67 }),
    parceiro({ parceiro_id: 'c', valor: 10.01 }),
  ];

  it('soma apenas os selecionados', () => {
    expect(totalSelecionado(itens, new Set(['a', 'b']))).toBe(100);
  });

  it('devolve 0 quando nada está selecionado', () => {
    expect(totalSelecionado(itens, new Set())).toBe(0);
  });

  it('ignora id selecionado que não está na lista', () => {
    expect(totalSelecionado(itens, new Set(['a', 'inexistente']))).toBe(33.33);
  });

  it('bate exatamente com a soma das linhas do CSV exportado', () => {
    const selecionados = new Set(['a', 'b', 'c']);
    const naTela = totalSelecionado(itens, selecionados);

    const colunas: ColunaCsv<ParceiroElegivel>[] = [
      { cabecalho: 'Nome', valor: (p) => p.nome },
      { cabecalho: 'Valor', valor: (p) => p.valor.toFixed(2) },
    ];
    const csv = montarCsv(
      itens.filter((i) => selecionados.has(i.parceiro_id)),
      colunas,
    );

    const doCsv = somarValores(
      csv
        .slice(BOM.length)
        .split('\r\n')
        .slice(1)
        .map((l) => Number(l.split(';')[1])),
    );

    expect(doCsv).toBe(naTela);
    expect(doCsv).toBe(110.01);
  });
});

describe('resumoSelecao', () => {
  it('conta parceiros e comissões do que foi escolhido', () => {
    const itens = [
      parceiro({ parceiro_id: 'a', valor: 50, comissoes: 3 }),
      parceiro({ parceiro_id: 'b', valor: 25, comissoes: 2 }),
      parceiro({ parceiro_id: 'c', valor: 10, comissoes: 1 }),
    ];
    expect(resumoSelecao(itens, new Set(['a', 'b']))).toEqual({
      parceiros: 2,
      comissoes: 5,
      total: 75,
    });
  });
});

describe('podeSelecionar', () => {
  it('aceita parceiro elegível com PIX', () => {
    expect(podeSelecionar(parceiro())).toBe(true);
  });

  it('recusa quem não tem chave PIX, mesmo elegível pelo saldo', () => {
    expect(podeSelecionar(parceiro({ chave_pix: null, tipo_chave_pix: null }))).toBe(false);
  });

  it('recusa quem está abaixo do saldo mínimo', () => {
    expect(podeSelecionar(parceiro({ elegivel: false }))).toBe(false);
  });
});

describe('motivoInelegivel', () => {
  it('explica a falta de PIX antes de falar de saldo', () => {
    const item = parceiro({ chave_pix: null, tipo_chave_pix: null, elegivel: false });
    expect(motivoInelegivel(item, 50)).toBe('Sem chave PIX cadastrada');
  });

  it('informa o valor mínimo em reais quando o saldo é o problema', () => {
    const item = parceiro({ elegivel: false });
    expect(motivoInelegivel(item, 50)).toContain('50,00');
  });

  it('devolve null para quem pode ser pago', () => {
    expect(motivoInelegivel(parceiro(), 50)).toBeNull();
  });
});

describe('rótulos', () => {
  it('traduz todos os motivos declarados no CHECK da tabela', () => {
    // Se a migration ganhar um motivo e este arquivo não, a tela mostraria a
    // chave crua ao operador.
    expect(MOTIVOS).toHaveLength(10);
    expect(rotuloMotivo('preco_alto')).toBe('Preço alto');
  });

  it('traduz todas as origens declaradas', () => {
    expect(ORIGENS).toHaveLength(6);
    expect(rotuloOrigem('whatsapp')).toBe('WhatsApp');
  });

  it('devolve a chave crua para valor desconhecido em vez de quebrar', () => {
    expect(rotuloMotivo('motivo_que_nao_existe')).toBe('motivo_que_nao_existe');
    expect(rotuloOrigem('inventado')).toBe('inventado');
  });

  it('usa o mesmo nome para o mesmo status em todas as telas', () => {
    expect(rotuloAssinatura('past_due')).toBe('Em atraso');
    expect(rotuloAssinatura('trialing')).toBe('Em teste');
    expect(rotuloAssinatura(null)).toBe('Sem assinatura');
    expect(rotuloAssinatura('status_novo')).toBe('status_novo');
    expect(rotuloStatusConta('suspenso')).toBe('Suspensa');
    expect(rotuloStatusConta('inativo')).toBe('Desativada');
  });

  it('não confunde conta desativada com conta sem uso recente', () => {
    expect(rotuloAtividade('inativo')).toBe('Sem uso recente');
    expect(rotuloAtividade('inativo')).not.toBe(rotuloStatusConta('inativo'));
    expect(rotuloAtividade('sem_dados')).toBe('Sem dados');
  });

  it('cobre os seis status de assinatura e os sete de pagamento', () => {
    expect(Object.keys(ROTULO_ASSINATURA)).toHaveLength(6);
    expect(Object.keys(ROTULO_PAGAMENTO)).toHaveLength(7);
  });
});

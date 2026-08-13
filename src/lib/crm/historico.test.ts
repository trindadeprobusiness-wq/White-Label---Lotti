import { describe, it, expect } from 'vitest';
import {
  paraCanal, paraTipoUI, paraRegistro, montarThread, semContatoHa,
} from './historico';

/**
 * O código do app usa o enum `tipo_contato` (LIGACAO, VISITA, PROPOSTA, NOTA),
 * mas a tabela em produção usa `canal_contato` (WHATSAPP, EMAIL, TELEFONE,
 * PRESENCIAL, OUTRO). Gravar o valor errado é recusado pelo Postgres — foi o que
 * quebrou a timeline. Estes testes travam a tradução nos dois sentidos.
 */
describe('paraCanal (UI → banco)', () => {
  it('traduz os que mudam de nome', () => {
    expect(paraCanal('LIGACAO')).toBe('TELEFONE');
    expect(paraCanal('VISITA')).toBe('PRESENCIAL');
  });
  it('mantém os que existem nos dois', () => {
    expect(paraCanal('WHATSAPP')).toBe('WHATSAPP');
    expect(paraCanal('EMAIL')).toBe('EMAIL');
  });
  it('o que não tem canal próprio vira OUTRO', () => {
    expect(paraCanal('PROPOSTA')).toBe('OUTRO');
    expect(paraCanal('NOTA')).toBe('OUTRO');
  });
  it('valor desconhecido não quebra o insert', () => {
    expect(paraCanal('QUALQUER_COISA')).toBe('OUTRO');
  });
});

describe('paraTipoUI (banco → UI)', () => {
  it('prefere o tipo original guardado em metadata', () => {
    expect(paraTipoUI('OUTRO', { tipo_ui: 'PROPOSTA' })).toBe('PROPOSTA');
    expect(paraTipoUI('PRESENCIAL', { tipo_ui: 'VISITA' })).toBe('VISITA');
  });
  it('sem metadata, traduz de volta pelo canal', () => {
    expect(paraTipoUI('TELEFONE', null)).toBe('LIGACAO');
    expect(paraTipoUI('PRESENCIAL', null)).toBe('VISITA');
    expect(paraTipoUI('WHATSAPP', null)).toBe('WHATSAPP');
  });
  it('OUTRO sem pista vira NOTA', () => {
    expect(paraTipoUI('OUTRO', null)).toBe('NOTA');
  });
  it('ignora metadata com tipo invalido', () => {
    expect(paraTipoUI('TELEFONE', { tipo_ui: 'INVENTADO' })).toBe('LIGACAO');
  });
});

describe('paraRegistro (o que vai para o insert)', () => {
  const base = { clienteId: 'c1', tipo: 'VISITA', texto: 'Visitou o 302' };

  it('usa as colunas que existem de verdade na tabela', () => {
    const r = paraRegistro(base);
    expect(Object.keys(r).sort()).toEqual(
      ['cliente_id', 'conteudo', 'data_contato', 'direcao', 'metadata', 'tipo'].sort(),
    );
  });

  it('nao envia corretor_id, descricao nem data — colunas que nao existem', () => {
    const r = paraRegistro(base) as unknown as Record<string, unknown>;
    expect(r.corretor_id).toBeUndefined();
    expect(r.descricao).toBeUndefined();
    expect(r.data).toBeUndefined();
  });

  it('traduz o tipo e preserva o original em metadata', () => {
    const r = paraRegistro(base);
    expect(r.tipo).toBe('PRESENCIAL');
    expect(r.metadata.tipo_ui).toBe('VISITA');
  });

  it('o que o corretor registra sai como OUT', () => {
    expect(paraRegistro(base).direcao).toBe('OUT');
  });

  it('aceita direcao explicita (mensagem recebida)', () => {
    expect(paraRegistro({ ...base, direcao: 'IN' }).direcao).toBe('IN');
  });
});

describe('montarThread', () => {
  const msg = (id: string, direcao: string, data: string) => ({
    id, direcao, conteudo: id, data_contato: data, tipo: 'WHATSAPP', metadata: null,
  });

  it('ordena do mais antigo para o mais novo, como conversa', () => {
    const t = montarThread([
      msg('c', 'OUT', '2026-08-11T12:00:00Z'),
      msg('a', 'IN', '2026-08-11T10:00:00Z'),
      msg('b', 'OUT', '2026-08-11T11:00:00Z'),
    ]);
    expect(t.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('marca de que lado a bolha fica', () => {
    const t = montarThread([msg('a', 'IN', '2026-08-11T10:00:00Z'), msg('b', 'OUT', '2026-08-11T11:00:00Z')]);
    expect(t[0].meu).toBe(false); // recebida
    expect(t[1].meu).toBe(true);  // enviada
  });

  it('sem direcao trata como enviada — o historico antigo nao tinha o campo', () => {
    const t = montarThread([{ id: 'x', conteudo: 'oi', data_contato: '2026-08-11T10:00:00Z', tipo: 'NOTA' }]);
    expect(t[0].meu).toBe(true);
  });

  it('lista vazia nao quebra', () => {
    expect(montarThread([])).toEqual([]);
  });
});

describe('semContatoHa', () => {
  const agora = new Date('2026-08-11T12:00:00Z');

  it('conta em minutos abaixo de uma hora', () => {
    expect(semContatoHa('2026-08-11T11:24:00Z', agora)).toBe('36min');
  });
  it('conta em horas e minutos no mesmo dia', () => {
    expect(semContatoHa('2026-08-11T08:21:00Z', agora)).toBe('3h39');
  });
  it('conta em dias acima de 24h', () => {
    expect(semContatoHa('2026-08-08T12:00:00Z', agora)).toBe('3d');
  });
  it('sem data devolve null em vez de texto errado', () => {
    expect(semContatoHa(null, agora)).toBeNull();
  });
  it('data no futuro nao vira negativo', () => {
    expect(semContatoHa('2026-08-12T12:00:00Z', agora)).toBe('agora');
  });
});

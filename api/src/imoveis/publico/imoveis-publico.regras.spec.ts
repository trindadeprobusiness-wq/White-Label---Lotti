import { HttpException } from '@nestjs/common';
import {
  descricaoCurta, inteiroPublico, lerFiltrosVitrine, lerIdDetalhe, LinhaDetalhe, LinhaVitrine, normalizarDetalhe, normalizarVitrine,
} from './imoveis-publico.regras';

// O arquivo compartilhado das Edge Functions fica fora de rootDir: entra por require (o ts-jest transforma).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const edge = require('../../../../supabase/functions/_shared/public-request') as {
  publicInteger: (raw: string | null, fallback: number, min: number, max: number) => number;
};

function erro(f: () => unknown): { status: number; corpo: unknown } {
  try {
    f();
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() };
    throw e;
  }
  throw new Error('não lançou');
}

describe('validação da vitrine (public-imoveis)', () => {
  it('inteiroPublico é o publicInteger da Edge', () => {
    for (const [raw, fb, min, max] of [[null, 12, 1, 20], ['5', 12, 1, 20], ['20', 12, 1, 20], ['0', 0, 0, 10000]] as const) {
      expect(inteiroPublico(raw, fb, min, max)).toBe(edge.publicInteger(raw, fb, min, max));
    }
    for (const raw of ['21', '0', '1.5', 'abc', '', ' ']) {
      expect(() => edge.publicInteger(raw, 12, 1, 20)).toThrow('Parâmetro numérico inválido.');
      expect(erro(() => inteiroPublico(raw, 12, 1, 20))).toEqual({ status: 400, corpo: { error: 'Parâmetro numérico inválido.' } });
    }
  });

  it('padrões e normalização dos filtros (tipo em minúsculas, tipo_imovel em maiúsculas)', () => {
    expect(lerFiltrosVitrine({})).toEqual({
      tipo: null, limit: 12, offset: 0, bairro: null, precoMin: null, precoMax: null, quartosMin: null, tipoImovel: null,
    });
    expect(lerFiltrosVitrine({
      tipo: 'VENDA', limit: '3', offset: '6', bairro: 'Centro', preco_min: '100000', preco_max: '2e5', quartos_min: '2', tipo_imovel: 'casa',
      utm_source: 'google', _: '123',
    })).toEqual({
      tipo: 'venda', limit: 3, offset: 6, bairro: 'Centro', precoMin: 100000, precoMax: 200000, quartosMin: 2, tipoImovel: 'CASA',
    });
    // Valor repetido na query: vale o primeiro, como URLSearchParams.get.
    expect(lerFiltrosVitrine({ tipo: ['aluguel', 'venda'] }).tipo).toBe('aluguel');
    // tipo fora de venda/aluguel não filtra.
    expect(lerFiltrosVitrine({ tipo: 'temporada' }).tipo).toBeNull();
    // Texto vazio não filtra (os `if (x)` da Edge); '0' filtra.
    expect(lerFiltrosVitrine({ bairro: '', tipo_imovel: '', preco_min: '0' })).toMatchObject({ bairro: null, tipoImovel: null, precoMin: 0 });
  });

  it('erros com os textos da Edge, na mesma ordem', () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ limit: '50' }, 'Parâmetro numérico inválido.'],
      [{ offset: '-1' }, 'Parâmetro numérico inválido.'],
      [{ bairro: 'x'.repeat(121) }, 'Bairro inválido.'],
      [{ preco_min: 'abc' }, 'Filtro inválido.'],
      [{ preco_max: ' ' }, 'Filtro inválido.'],
      [{ preco_min: '-5' }, 'Filtro inválido.'],
      [{ quartos_min: '1e13' }, 'Filtro inválido.'],
      [{ quartos_min: '2.5' }, 'Filtro inválido.'],
      [{ preco_min: '300', preco_max: '200' }, 'Faixa de preço inválida.'],
      [{ limit: '99', bairro: 'x'.repeat(200) }, 'Parâmetro numérico inválido.'],
    ];
    for (const [consulta, mensagem] of casos) {
      expect(erro(() => lerFiltrosVitrine(consulta))).toEqual({ status: 400, corpo: { error: mensagem } });
    }
  });

  it('id do detalhe: obrigatório e UUID de qualquer versão', () => {
    expect(lerIdDetalhe({ id: '11111111-1111-1111-1111-111111111111' })).toBe('11111111-1111-1111-1111-111111111111');
    for (const id of [undefined, '', 'abc', '11111111-1111-1111-1111-11111111111', { x: 1 }]) {
      expect(erro(() => lerIdDetalhe({ id }))).toEqual({ status: 400, corpo: { error: 'Parâmetro "id" é obrigatório' } });
    }
  });
});

const linhaBase: LinhaVitrine = {
  id: 'i1', titulo: 'Casa', tipo: 'CASA', valor: 350000, area_m2: null, dormitorios: null, banheiros: 2, garagem: null,
  endereco: 'Rua 1', bairro: 'Centro', cidade: 'Anápolis', estado: 'GO', descricao: null, descricao_curta: null,
  created_at: '2026-10-05T11:19:49.433+00:00',
  imovel_fotos: [
    { id: 'f2', arquivo_url: 'u2', ordem: 2, principal: false },
    { id: 'f0', arquivo_url: 'u0', ordem: null, principal: false },
    { id: 'f1', arquivo_url: 'u1', ordem: 1, principal: true },
  ],
  venda: true, aluguel: true,
};

describe('normalização da vitrine', () => {
  it('formato do site: números, zeros, fotos em ordem e principal marcada', () => {
    expect(normalizarVitrine(linhaBase, null)).toEqual({
      id: 'i1', titulo: 'Casa', tipo_imovel: 'CASA', tipo_negocio: 'venda', valor: 350000, area_m2: 0, dormitorios: 0, banheiros: 2,
      garagem: 0, endereco: 'Rua 1', bairro: 'Centro', cidade: 'Anápolis', estado: 'GO', descricao: null, descricao_curta: '',
      foto_principal: 'u1', fotos: ['u0', 'u1', 'u2'], created_at: '2026-10-05T11:19:49.433+00:00',
    });
  });

  it('finalidade: a pedida vence; sem pedido, venda quando há fachada de venda', () => {
    expect(normalizarVitrine(linhaBase, 'aluguel').tipo_negocio).toBe('aluguel');
    expect(normalizarVitrine({ ...linhaBase, venda: false }, null).tipo_negocio).toBe('aluguel');
  });

  it('sem foto principal marcada usa a primeira; sem fotos, null', () => {
    const semPrincipal = { ...linhaBase, imovel_fotos: linhaBase.imovel_fotos.map((f) => ({ ...f, principal: false })) };
    expect(normalizarVitrine(semPrincipal, null).foto_principal).toBe('u0');
    expect(normalizarVitrine({ ...linhaBase, imovel_fotos: [] }, null)).toMatchObject({ foto_principal: null, fotos: [] });
  });

  it('descricaoCurta nunca vira "undefined..."', () => {
    expect(descricaoCurta('curta', 'longa')).toBe('curta');
    expect(descricaoCurta(null, null)).toBe('');
    expect(descricaoCurta(null, 'abc')).toBe('abc');
    expect(descricaoCurta(null, 'x'.repeat(130))).toBe(`${'x'.repeat(120)}...`);
  });
});

describe('normalização do detalhe', () => {
  const detalhe: LinhaDetalhe = {
    ...linhaBase, cep: '75000-000', status_venda: 'DISPONIVEL', finalidade: 'LOCACAO', descricao: 'Ótima casa',
  };

  it('data + similares no formato da Edge', () => {
    const r = normalizarDetalhe(detalhe, [{
      id: 's1', titulo: 'Outra', tipo: 'APARTAMENTO', valor: 300000, area_m2: 70.5, dormitorios: 2, garagem: 1, bairro: 'B', cidade: 'C',
      estado: 'GO', finalidade: 'VENDA', imovel_fotos: [{ arquivo_url: 'x', ordem: 0, principal: false }],
    }]);
    expect(r.data).toMatchObject({ tipo_negocio: 'aluguel', cep: '75000-000', descricao_curta: 'Ótima casa...', foto_principal: 'u1', fotos: ['u0', 'u1', 'u2'] });
    expect(Object.keys(r.data)).not.toContain('status_venda');
    expect(r.similares).toEqual([{
      id: 's1', titulo: 'Outra', tipo_imovel: 'APARTAMENTO', tipo_negocio: 'venda', valor: 300000, area_m2: 70.5, dormitorios: 2,
      garagem: 1, bairro: 'B', cidade: 'C', foto_principal: 'x',
    }]);
  });

  it('sem descrição a curta é vazia (a Edge devolvia "undefined...")', () => {
    expect(normalizarDetalhe({ ...detalhe, descricao: null }, []).data.descricao_curta).toBe('');
    expect(normalizarDetalhe({ ...detalhe, descricao_curta: 'Resumo' }, []).data.descricao_curta).toBe('Resumo');
  });
});

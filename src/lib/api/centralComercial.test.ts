import { beforeEach, describe, expect, it, vi } from 'vitest';

const chamarApi = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ chamarApi }));
import { centralComercial } from './centralComercial';

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

describe('cliente da Central Comercial (API no lugar do Supabase)', () => {
  beforeEach(() => chamarApi.mockReset());

  it('select com ordem e filtro vira GET com ?eq. e ?ordem', async () => {
    chamarApi.mockResolvedValue(resposta([{ id: '1' }]));
    const r = await centralComercial.from('central_comercial_roteiros').select('*').eq('ativo', true).order('created_at', { ascending: false });
    expect(chamarApi).toHaveBeenCalledWith('/api/central-comercial/central_comercial_roteiros?eq.ativo=true&ordem=created_at&asc=false');
    expect(r).toEqual({ data: [{ id: '1' }], error: null });
  });

  it('insert().select().single() devolve a linha; update().eq() vira PATCH; erro volta em error', async () => {
    chamarApi.mockResolvedValueOnce(resposta([{ id: 'n1' }]));
    expect((await centralComercial.from('central_comercial_leads').insert({ nome_empresa: 'X' }).select().single()).data).toEqual({ id: 'n1' });
    expect(JSON.parse(chamarApi.mock.calls[0][1].body)).toEqual({ linhas: [{ nome_empresa: 'X' }], upsert: false });
    chamarApi.mockResolvedValueOnce(resposta([{ id: 'n1' }]));
    await centralComercial.from('central_comercial_leads').update({ status_contato: 'qualificado' }).eq('id', 'n1');
    expect(chamarApi.mock.calls[1][0]).toBe('/api/central-comercial/central_comercial_leads?eq.id=n1');
    expect(chamarApi.mock.calls[1][1].method).toBe('PATCH');
    chamarApi.mockResolvedValueOnce(resposta({ message: 'falhou' }, 400));
    expect((await centralComercial.from('central_comercial_leads').insert({}))).toMatchObject({ data: null, error: expect.any(Error) });
  });

  it('maybeSingle sem linha devolve null', async () => {
    chamarApi.mockResolvedValue(resposta([]));
    expect(await centralComercial.from('central_comercial_projecao_config').select('*').maybeSingle()).toEqual({ data: null, error: null });
  });
});

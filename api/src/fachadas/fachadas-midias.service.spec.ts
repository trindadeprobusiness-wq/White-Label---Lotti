import { FachadasMidiasService } from './fachadas-midias.service';
import { confereCasts, montar, sql, texto } from './fachadas.service.spec';

const IMOVEL = '22222222-2222-4222-8222-222222222222';
const claims = { sub: 'u1', role: 'authenticated' };

describe('FachadasMidiasService F12', () => {
  it('uma consulta só no lugar das três de hoje, com os três parâmetros do mesmo imóvel', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ existe: true }]);
    tx.$queryRaw.mockResolvedValueOnce([{ foto_principal_url: 'https://host/f.jpg', fotos: 8, videos: 2 }]);
    expect(await new FachadasMidiasService(db as never).obter(claims, IMOVEL)).toEqual({
      foto_principal_url: 'https://host/f.jpg', fotos: 8, videos: 2,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(texto(tx, 0)).toBe("select to_regclass('public.videos') is not null as existe");
    const t = texto(tx, 1);
    expect(t).toContain('select (select arquivo_url from public.imovel_fotos where imovel_id = $1::uuid'
      + ' order by principal desc, ordem asc nulls last, id limit 1) as foto_principal_url');
    expect(t).toContain('(select count(*)::int from public.imovel_fotos where imovel_id = $2::uuid) as fotos');
    expect(t).toContain('(select count(*)::int from public.videos where imovel_id = $3::uuid) as videos');
    expect(sql(tx, 1).values).toEqual([IMOVEL, IMOVEL, IMOVEL]);
    confereCasts(tx);
  });

  it('sem a tabela public.videos (os dois bancos hoje): zero vídeos, sem consultar a tabela', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ existe: false }]);
    tx.$queryRaw.mockResolvedValueOnce([{ foto_principal_url: null, fotos: 2, videos: 0 }]);
    expect(await new FachadasMidiasService(db as never).obter(claims, IMOVEL)).toEqual({
      foto_principal_url: null, fotos: 2, videos: 0,
    });
    const t = texto(tx, 1);
    expect(t).not.toContain('public.videos');
    expect(t).toContain('0 as videos');
    expect(sql(tx, 1).values).toEqual([IMOVEL, IMOVEL]);
    confereCasts(tx);
  });

  it('imóvel de outro corretor devolve null e zeros, como as consultas de hoje', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ existe: true }]);
    tx.$queryRaw.mockResolvedValueOnce([{ foto_principal_url: null, fotos: 0, videos: 0 }]);
    expect(await new FachadasMidiasService(db as never).obter(claims, IMOVEL)).toEqual({
      foto_principal_url: null, fotos: 0, videos: 0,
    });
  });

  it('count que chegue como BigInt é normalizado para número', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ existe: true }]);
    tx.$queryRaw.mockResolvedValueOnce([{ foto_principal_url: undefined, fotos: BigInt(3), videos: BigInt(1) }]);
    expect(await new FachadasMidiasService(db as never).obter(claims, IMOVEL)).toEqual({
      foto_principal_url: null, fotos: 3, videos: 1,
    });
  });
});

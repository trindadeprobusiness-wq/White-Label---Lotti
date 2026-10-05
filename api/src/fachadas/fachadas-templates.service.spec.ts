import { ESCOPO_PADRAO, FachadasTemplatesService } from './fachadas-templates.service';
import { CriarTemplateDto, ListarTemplatesDto, PorImagemDto } from './fachadas.dto';
import { confereCasts, dto, erroDe, montar, sql, texto } from './fachadas.service.spec';

const TEMPLATE = '44444444-4444-4444-8444-444444444444';
const claims = { sub: 'u1', role: 'authenticated' };

describe('FachadasTemplatesService F8 listar', () => {
  it('escopo padrão é todos e cai no RLS', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: TEMPLATE } }]);
    expect(await new FachadasTemplatesService(db as never).listar(claims, dto(ListarTemplatesDto, {}))).toEqual([{ id: TEMPLATE }]);
    expect(texto(tx, 0)).toBe(
      'select to_jsonb(t) as linha from public.fachada_templates t'
      + " where ($1::text = 'todos' or t.corretor_id = public.get_corretor_id())"
      + ' order by t.created_at desc, t.id limit $2::int',
    );
    expect(sql(tx, 0).values).toEqual([ESCOPO_PADRAO, 1000]);
    expect(ESCOPO_PADRAO).toBe('todos');
    confereCasts(tx);
  });

  it('escopo=meus resolve o corretor no SQL, sem chamada extra do front', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await new FachadasTemplatesService(db as never).listar(claims, dto(ListarTemplatesDto, { escopo: 'meus' }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(sql(tx, 0).values[0]).toBe('meus');
  });
});

describe('FachadasTemplatesService F9 criar', () => {
  it('corretor de get_corretor_id(), config como jsonb e padrao false por omissão', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: TEMPLATE } }]);
    const corpo = dto(CriarTemplateDto, { nome: 'Minha arte', categoria: 'VENDA', config: { imagem_url: 'https://host/a.png' } });
    expect(await new FachadasTemplatesService(db as never).criar(claims, corpo)).toEqual({ id: TEMPLATE });
    expect(texto(tx, 0)).toBe(
      'insert into public.fachada_templates as x (corretor_id, nome, categoria, config, padrao)'
      + ' select public.get_corretor_id(), $1::text, $2::text, $3::jsonb, $4::boolean'
      + ' returning to_jsonb(x) as linha',
    );
    expect(sql(tx, 0).values).toEqual(['Minha arte', 'VENDA', '{"imagem_url":"https://host/a.png"}', false]);
    confereCasts(tx);
  });

  it('padrao true é repassado', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: {} }]);
    await new FachadasTemplatesService(db as never).criar(claims, dto(CriarTemplateDto, {
      nome: 'x', categoria: 'RURAL', config: {}, padrao: true,
    }));
    expect(sql(tx, 0).values[3]).toBe(true);
  });

  it('corretor_id nunca vem do cliente', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: {} }]);
    const corpo = Object.assign(dto(CriarTemplateDto, { nome: 'x', categoria: 'VENDA', config: {} }), { corretor_id: TEMPLATE });
    await new FachadasTemplatesService(db as never).criar(claims, corpo);
    expect(sql(tx, 0).values).not.toContain(TEMPLATE);
  });
});

describe('FachadasTemplatesService F10 remover', () => {
  it('delete por id com returning', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: TEMPLATE }]);
    expect(await new FachadasTemplatesService(db as never).remover(claims, TEMPLATE)).toBeUndefined();
    expect(texto(tx, 0)).toBe('delete from public.fachada_templates where id = $1::uuid returning id::text as id');
    confereCasts(tx);
  });

  it('sem linha (de outro corretor ou template padrão) dá 404 template_nao_encontrado', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await erroDe(new FachadasTemplatesService(db as never).remover(claims, TEMPLATE))).toEqual({
      status: 404, corpo: { statusCode: 404, codigo: 'template_nao_encontrado', message: 'Template não encontrado.' },
    });
  });
});

describe('FachadasTemplatesService F11 por-imagem', () => {
  it('filtra por config->>imagem_url e devolve a linha', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: TEMPLATE } }]);
    const r = await new FachadasTemplatesService(db as never).porImagem(claims, dto(PorImagemDto, { imagem_url: 'https://host/a.png' }));
    expect(r).toEqual({ id: TEMPLATE });
    expect(texto(tx, 0)).toBe(
      'select to_jsonb(t) as linha from public.fachada_templates t'
      + " where t.config->>'imagem_url' = $1::text order by t.created_at desc, t.id limit 1",
    );
    expect(sql(tx, 0).values).toEqual(['https://host/a.png']);
    confereCasts(tx);
  });

  it('sem linha devolve null (não 404): a tela cai na posição padrão do QR', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await new FachadasTemplatesService(db as never).porImagem(claims, dto(PorImagemDto, { imagem_url: 'x' }))).toBeNull();
  });
});

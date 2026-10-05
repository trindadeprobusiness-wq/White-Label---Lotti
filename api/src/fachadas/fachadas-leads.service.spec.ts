import { FachadasLeadsService } from './fachadas-leads.service';
import { ListarLeadsDto } from './fachadas.dto';
import { confereCasts, dto, erroDe, montar, sql, texto } from './fachadas.service.spec';

const FACHADA = '11111111-1111-4111-8111-111111111111';
const LEAD = '33333333-3333-4333-8333-333333333333';
const claims = { sub: 'u1', role: 'authenticated' };

describe('FachadasLeadsService F5 listar', () => {
  it('to_jsonb, filtro que se anula, created_at desc com desempate por id e teto 1000', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: LEAD } }]);
    expect(await new FachadasLeadsService(db as never).listar(claims, dto(ListarLeadsDto, { fachada_id: FACHADA }))).toEqual([{ id: LEAD }]);
    expect(texto(tx, 0)).toBe(
      'select to_jsonb(l) as linha from public.fachada_leads l where ($1::uuid is null or l.fachada_id = $2::uuid)'
      + ' order by l.created_at desc, l.id limit $3::int',
    );
    expect(sql(tx, 0).values).toEqual([FACHADA, FACHADA, 1000]);
    confereCasts(tx);
  });

  it('sem fachada_id passa null e o filtro se anula', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await new FachadasLeadsService(db as never).listar(claims, dto(ListarLeadsDto, {}));
    expect(sql(tx, 0).values).toEqual([null, null, 1000]);
  });

  it('não filtra por corretor no SQL: quem decide é o RLS', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await new FachadasLeadsService(db as never).listar(claims, dto(ListarLeadsDto, {}));
    expect(texto(tx, 0)).not.toContain('get_corretor_id');
  });
});

describe('FachadasLeadsService F6 remover', () => {
  it('delete por id com returning', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: LEAD }]);
    expect(await new FachadasLeadsService(db as never).remover(claims, LEAD)).toBeUndefined();
    expect(texto(tx, 0)).toBe('delete from public.fachada_leads where id = $1::uuid returning id::text as id');
    expect(sql(tx, 0).values).toEqual([LEAD]);
    confereCasts(tx);
  });

  it('sem linha dá 404 lead_nao_encontrado', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await erroDe(new FachadasLeadsService(db as never).remover(claims, LEAD))).toEqual({
      status: 404, corpo: { statusCode: 404, codigo: 'lead_nao_encontrado', message: 'Lead não encontrado.' },
    });
  });
});

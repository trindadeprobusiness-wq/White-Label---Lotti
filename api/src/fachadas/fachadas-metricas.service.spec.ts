import { DIAS_PADRAO, FachadasMetricasService } from './fachadas-metricas.service';
import { MetricasDto } from './fachadas.dto';
import { confereCasts, dto, montar, sql, texto } from './fachadas.service.spec';

const claims = { sub: 'u1', role: 'authenticated' };

const agregado = (extra: Record<string, unknown> = {}) => [{
  total_fachadas: 3, total_leads: 7, total_escaneamentos: 42, leads_por_dia: [], ...extra,
}];

describe('FachadasMetricasService F7', () => {
  it('uma consulta só, com a janela a partir do now() do banco e sem limit (não há lista)', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce(agregado());
    await new FachadasMetricasService(db as never).obter(claims, dto(MetricasDto, { dias: 7 }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const t = texto(tx, 0);
    expect(t).toContain('with janela as (select (now() - make_interval(days => $1::int)) as inicio)');
    expect(t).toContain('ativas as (select count(*)::int as n from public.fachadas where ativo = true)');
    expect(t).toContain("(l.created_at at time zone 'UTC')::date as dia");
    expect(t).toContain('from public.fachada_leads l, janela j where l.created_at >= j.inicio');
    expect(t).toContain('from public.fachada_escaneamentos s, janela j where s.created_at >= j.inicio');
    expect(t).toContain("to_char(dia, 'YYYY-MM-DD')");
    expect(t).not.toContain('limit');
    expect(sql(tx, 0).values).toEqual([7]);
    confereCasts(tx);
  });

  it('dias ausente usa 30', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce(agregado());
    await new FachadasMetricasService(db as never).obter(claims, dto(MetricasDto, {}));
    expect(sql(tx, 0).values).toEqual([DIAS_PADRAO]);
    expect(DIAS_PADRAO).toBe(30);
  });

  it('devolve o objeto FachadaMetricas, com taxaConversao arredondada no servidor', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce(agregado({
      total_leads: 7, total_escaneamentos: 42,
      leads_por_dia: [{ data: '2026-09-20', leads: 1, escaneamentos: 5 }],
    }));
    expect(await new FachadasMetricasService(db as never).obter(claims, dto(MetricasDto, {}))).toEqual({
      totalFachadas: 3,
      totalEscaneamentos: 42,
      totalLeads: 7,
      taxaConversao: 17,
      fachadasMaisAcessadas: [],
      leadsPorDia: [{ data: '2026-09-20', leads: 1, escaneamentos: 5 }],
    });
  });

  it('sem escaneamento a taxa é 0, não divisão por zero', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce(agregado({ total_leads: 4, total_escaneamentos: 0 }));
    const r = await new FachadasMetricasService(db as never).obter(claims, dto(MetricasDto, {}));
    expect(r.taxaConversao).toBe(0);
  });

  it('fachadasMaisAcessadas continua vazio (§7.1.1) e leadsPorDia nunca é null', async () => {
    const { tx, db } = montar();
    tx.$queryRaw.mockResolvedValueOnce(agregado({ leads_por_dia: null }));
    const r = await new FachadasMetricasService(db as never).obter(claims, dto(MetricasDto, {}));
    expect(r.fachadasMaisAcessadas).toEqual([]);
    expect(r.leadsPorDia).toEqual([]);
  });
});

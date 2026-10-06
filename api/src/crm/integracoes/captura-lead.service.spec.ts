import { HttpException } from '@nestjs/common';
import { CapturaLeadRepo } from './captura-lead.repo';
import { CapturaLeadService } from './captura-lead.service';

/** Os casos de supabase/functions/lead-capture/handler.test.ts, no porte. */
const SEGREDO_N8N = 'test-integration-secret';
const salvos: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of ['N8N_SHARED_SECRET', 'PUBLIC_RATE_LIMIT_SECRET']) salvos[v] = process.env[v];
  process.env.N8N_SHARED_SECRET = SEGREDO_N8N;
  process.env.PUBLIC_RATE_LIMIT_SECRET = 'test-rate-secret';
});
afterEach(() => {
  for (const [v, valor] of Object.entries(salvos)) {
    if (valor === undefined) delete process.env[v];
    else process.env[v] = valor;
  }
});

interface Opcoes { existente?: boolean; limite?: boolean | null; limiteErro?: boolean; donos?: number; orfaoErro?: boolean; upsertErro?: boolean; dono?: string | null; cota?: boolean }

function montar(o: Opcoes = {}) {
  const chamadas: string[] = [];
  const registrar = <T>(nome: string, f: (...a: never[]) => T) => jest.fn((...a: never[]) => { chamadas.push(nome); return f(...a); });
  const repo = {
    consumirLimite: registrar('consumirLimite', async () => {
      if (o.limiteErro) throw new Error('internal');
      return o.limite === undefined ? true : o.limite;
    }),
    donoDoImovel: registrar('donoDoImovel', async () => (o.dono === undefined ? 'dono-do-imovel' : o.dono)),
    corretores: registrar('corretores', async () => Array.from({ length: o.donos ?? 1 }, (_, i) => `owner-${i}`)),
    gravarLeadSemDestino: registrar('gravarLeadSemDestino', async () => {
      if (o.orfaoErro) throw new Error('private database details');
      return 1;
    }),
    upsertCliente: registrar('upsertCliente', async () => {
      if (o.upsertErro) throw new Error('private database details');
      return { cliente_id: 'private-client-id', created: !o.existente };
    }),
    vincularImovel: registrar('vincularImovel', async () => { throw new Error('fk'); }),
    criarAlertaDoLead: registrar('criarAlertaDoLead', async () => 1),
    cota: registrar('cota', async () => ({ permitido: o.cota ?? false, usado: 0, limite: 0, ilimitado: false, habilitado: o.cota ?? false })),
    avisoDePlanoDesde: registrar('avisoDePlanoDesde', async () => false),
    criarAvisoDePlano: registrar('criarAvisoDePlano', async () => 1),
  };
  const servico = new CapturaLeadService(repo as unknown as CapturaLeadRepo);
  return { repo, servico, chamadas };
}

const payload = { nome: 'Contato teste', telefone: '11999991234' };
const entrada = (corpo: unknown = payload, segredo: string | null = null, imovel: string | null = null) => ({
  segredo, imovelIdDaQuery: imovel, lerCorpo: async () => corpo,
});

async function erroDe(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() };
    throw e;
  }
  throw new Error('não lançou');
}

describe('captura pública de lead (porte do lead-capture)', () => {
  it('recusa payload antes de consultar ou gravar no banco', async () => {
    const f = montar();
    expect(await erroDe(f.servico.capturar(entrada({ telefone: {} })))).toEqual({ status: 400, corpo: { success: false, error: 'Campo inválido ou muito longo.' } });
    expect(f.chamadas).toEqual([]);
  });

  it('limite excedido → 429; limitador quebrado ou sem segredo → 503; nada é gravado', async () => {
    for (const [o, status] of [[{ limite: false }, 429], [{ limiteErro: true }, 503], [{ limite: null }, 503]] as const) {
      const f = montar(o);
      const r = await erroDe(f.servico.capturar(entrada()));
      expect(r.status).toBe(status);
      expect(JSON.stringify(r.corpo)).not.toContain('internal');
      expect(f.chamadas).toEqual(['consumirLimite']);
    }
    delete process.env.PUBLIC_RATE_LIMIT_SECRET;
    const f = montar();
    expect(await erroDe(f.servico.capturar(entrada()))).toEqual({ status: 503, corpo: { success: false, error: 'Serviço temporariamente indisponível.' } });
    expect(f.chamadas).toEqual([]);
  });

  it('respostas anônimas não diferenciam cliente novo, existente ou sem dono', async () => {
    const respostas = [];
    for (const o of [{}, { existente: true }, { donos: 2 }]) respostas.push(await montar(o).servico.capturar(entrada()));
    expect(respostas[0]).toEqual({ success: true, message: 'Recebemos seu contato! Em breve alguém falará com você.' });
    expect(respostas[1]).toEqual(respostas[0]);
    expect(respostas[2]).toEqual(respostas[0]);
  });

  it('lead sem dono vai para leads_sem_destino; se não gravar, não informa sucesso', async () => {
    const ok = montar({ donos: 2 });
    expect(await ok.servico.capturar(entrada(payload, SEGREDO_N8N))).toEqual({
      success: true, message: 'Recebemos seu contato! Em breve alguém falará com você.', pendente_triagem: true,
    });
    expect(ok.repo.gravarLeadSemDestino.mock.calls[0][0]).toMatchObject({ nome: 'Contato teste', telefone: '5511999991234', email: null, mensagem: null });
    expect(ok.chamadas).not.toContain('upsertCliente');
    const falhou = montar({ donos: 2, orfaoErro: true });
    expect(await erroDe(falhou.servico.capturar(entrada()))).toEqual({
      status: 500, corpo: { success: false, error: 'Não foi possível receber seu contato. Tente novamente.' },
    });
  });

  it('contrato interno só para a integração autenticada; segredo errado → 401 antes do banco', async () => {
    const f = montar();
    expect(await f.servico.capturar(entrada(payload, SEGREDO_N8N))).toMatchObject({ cliente_id: 'private-client-id', is_new: true, qualificar_com_ia: false });
    const invalido = montar();
    const lido = jest.fn(async () => payload);
    expect(await erroDe(invalido.servico.capturar({ segredo: 'wrong', imovelIdDaQuery: null, lerCorpo: lido })))
      .toEqual({ status: 401, corpo: { success: false, error: 'Integração não autorizada.' } });
    expect(lido).not.toHaveBeenCalled();
    expect(invalido.chamadas).toEqual([]);
    delete process.env.N8N_SHARED_SECRET;
    expect((await erroDe(montar().servico.capturar(entrada(payload, SEGREDO_N8N)))).status).toBe(401);
  });

  it('procura e cadastra numa chamada só, pela chave do telefone; alerta de novo/retorno', async () => {
    const f = montar();
    await f.servico.capturar(entrada({ ...payload, email: 'test@example.test' }));
    const [corretor, nome, telefone, email, tracking] = f.repo.upsertCliente.mock.calls[0] as unknown as [string, string, string, string, Record<string, unknown>];
    expect([corretor, nome, telefone, email]).toEqual(['owner-0', 'Contato teste', '5511999991234', 'test@example.test']);
    expect(tracking).toMatchObject({ origem: 'landing_page' });
    expect(tracking.captured_at).toEqual(expect.any(String));
    expect(f.repo.criarAlertaDoLead.mock.calls[0][0]).toMatchObject({
      clienteId: 'private-client-id', corretorId: 'owner-0', mensagem: 'NOVO lead do site: Contato teste (5511999991234) — direto',
      metadata: { lead_type: 'new', source: 'landing_page' },
    });
    const retorno = montar({ existente: true });
    await retorno.servico.capturar(entrada({ ...payload, origem: 'meta' }));
    expect(retorno.repo.criarAlertaDoLead.mock.calls[0][0]).toMatchObject({
      mensagem: 'Retorno de lead do site: Contato teste (5511999991234) — meta', metadata: { lead_type: 'returning', source: 'meta' },
    });
  });

  it('com imóvel no link: dono = corretor do imóvel, vínculo de melhor esforço; imóvel inexistente → 400', async () => {
    const IMOVEL = '11111111-1111-4111-8111-111111111111';
    const f = montar();
    await f.servico.capturar(entrada(payload, null, IMOVEL));
    expect(f.repo.donoDoImovel).toHaveBeenCalledWith(IMOVEL);
    expect(f.chamadas).not.toContain('corretores');
    expect(f.repo.upsertCliente.mock.calls[0][0]).toBe('dono-do-imovel');
    // O vínculo falhou (fk) e o lead seguiu.
    expect(f.repo.vincularImovel).toHaveBeenCalledWith('private-client-id', IMOVEL);
    expect(f.repo.criarAlertaDoLead).toHaveBeenCalled();
    const semImovel = montar({ dono: null });
    expect(await erroDe(semImovel.servico.capturar(entrada(payload, null, IMOVEL)))).toEqual({ status: 400, corpo: { success: false, error: 'Imóvel inválido.' } });
  });

  it('não informa sucesso se o cliente não foi salvo, e não cria alerta', async () => {
    const f = montar({ upsertErro: true });
    const r = await erroDe(f.servico.capturar(entrada()));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.corpo)).not.toContain('private database details');
    expect(f.chamadas).not.toContain('criarAlertaDoLead');
  });

  it('visitante não consulta cota; integração consulta, não debita e avisa uma vez por mês', async () => {
    const anonimo = montar();
    await anonimo.servico.capturar(entrada());
    expect(anonimo.chamadas).toEqual(['consumirLimite', 'corretores', 'upsertCliente', 'criarAlertaDoLead']);
    const integracao = montar();
    await integracao.servico.capturar(entrada(payload, SEGREDO_N8N));
    expect(integracao.chamadas).toEqual(['consumirLimite', 'corretores', 'upsertCliente', 'criarAlertaDoLead', 'cota', 'avisoDePlanoDesde', 'criarAvisoDePlano']);
    expect(integracao.repo.cota).toHaveBeenCalledWith('owner-0', 'leads_qualificados_monthly');
    const desde = integracao.repo.avisoDePlanoDesde.mock.calls[0][1] as unknown as Date;
    expect(desde.toISOString()).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    const liberada = montar({ cota: true });
    expect(await liberada.servico.capturar(entrada(payload, SEGREDO_N8N))).toMatchObject({ qualificar_com_ia: true });
    expect(liberada.chamadas).not.toContain('criarAvisoDePlano');
  });
});

import { comModeloReserva, MODELO_PADRAO, MODELO_RAPIDO, MODELO_RESERVA, modeloContrato, modeloRapido, modeloReserva } from './gemini';

describe('modelo reserva do Gemini', () => {
  const resp = (status: number) => new Response('{}', { status });
  afterEach(() => { delete process.env.LOTTI_AI_FALLBACK_MODEL; });

  it('com o principal sobrecarregado (503) tenta uma vez o reserva', async () => {
    const chamar = jest.fn().mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(200));
    const r = await comModeloReserva(MODELO_PADRAO, chamar);
    expect(r.status).toBe(200);
    expect(chamar.mock.calls.map((c) => c[0])).toEqual([MODELO_PADRAO, MODELO_RESERVA]);
  });

  it('modelo que não existe mais (404) também cai no reserva; 400 não', async () => {
    const a = jest.fn().mockResolvedValueOnce(resp(404)).mockResolvedValueOnce(resp(200));
    expect((await comModeloReserva(MODELO_PADRAO, a)).status).toBe(200);
    const b = jest.fn().mockResolvedValueOnce(resp(400));
    expect((await comModeloReserva(MODELO_PADRAO, b)).status).toBe(400);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('desligado com LOTTI_AI_FALLBACK_MODEL=off', async () => {
    process.env.LOTTI_AI_FALLBACK_MODEL = 'off';
    const chamar = jest.fn().mockResolvedValueOnce(resp(503));
    expect((await comModeloReserva(MODELO_PADRAO, chamar)).status).toBe(503);
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  it('um é a reserva do outro: conversa usa o rápido, contrato o 3.8-flash', () => {
    expect(modeloRapido()).toBe(MODELO_RAPIDO);
    expect(modeloContrato()).toBe(MODELO_PADRAO);
    expect(modeloReserva(MODELO_RAPIDO)).toBe(MODELO_PADRAO);
    expect(modeloReserva(MODELO_PADRAO)).toBe(MODELO_RAPIDO);
  });

  it('principal que passa do prazo cai no reserva; sem prazo, o erro sobe', async () => {
    const travado = (_m: string, sinal?: AbortSignal) => new Promise<Response>((_ok, falha) => {
      sinal?.addEventListener('abort', () => falha(sinal.reason));
    });
    const chamar = jest.fn(async (m: string, sinal?: AbortSignal) => (m === MODELO_RAPIDO ? travado(m, sinal) : resp(200)));
    const r = await comModeloReserva(MODELO_RAPIDO, chamar, { prazoPrincipalMs: 30 });
    expect(r.status).toBe(200);
    expect(chamar.mock.calls.map((c) => c[0])).toEqual([MODELO_RAPIDO, MODELO_PADRAO]);
    expect(chamar.mock.calls[1][1]).toBeUndefined();

    const erro = jest.fn().mockRejectedValueOnce(new TypeError('rede'));
    await expect(comModeloReserva(MODELO_RAPIDO, erro, { prazoPrincipalMs: 30 })).rejects.toThrow('rede');
    expect(erro).toHaveBeenCalledTimes(1);
  });
});

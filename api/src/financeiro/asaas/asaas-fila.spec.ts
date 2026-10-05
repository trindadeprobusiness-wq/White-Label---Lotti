import { Prisma } from '@prisma/client';
import { AsaasFila } from './asaas-fila';

function montar() {
  const tx = { $queryRaw: jest.fn(async (_q: Prisma.Sql) => [{ id: 'e1' }, { id: 'e2' }]) };
  const servico = { run: jest.fn(async (w: (t: typeof tx) => unknown) => w(tx)) };
  const webhook = { processar: jest.fn(async (_id: string) => undefined) };
  return { tx, webhook, fila: new AsaasFila(servico as never, webhook as never) };
}

describe('AsaasFila (D3)', () => {
  const antes = process.env.ASAAS_PROCESSAR_FILA;
  afterEach(() => {
    if (antes === undefined) delete process.env.ASAAS_PROCESSAR_FILA;
    else process.env.ASAAS_PROCESSAR_FILA = antes;
  });

  it('desligada sem a variável (padrão)', () => {
    delete process.env.ASAAS_PROCESSAR_FILA;
    const { fila } = montar();
    fila.onModuleInit();
    expect(fila.ligada).toBe(false);
    fila.onModuleDestroy();
  });

  it("liga só com 'true' e limpa o timer no destroy", () => {
    process.env.ASAAS_PROCESSAR_FILA = 'true';
    const { fila } = montar();
    fila.onModuleInit();
    expect(fila.ligada).toBe(true);
    fila.onModuleDestroy();
    expect(fila.ligada).toBe(false);
  });

  it('uma volta consulta RECEIVED parados e FAILED < 5 com limit 20 e processa em sequência', async () => {
    const { fila, tx, webhook } = montar();
    expect(await fila.volta()).toBe(2);
    const q = tx.$queryRaw.mock.calls[0][0];
    expect(q.text.replace(/\s+/g, ' ')).toContain(
      "where (status = 'RECEIVED' and received_at < now() - interval '1 minute') or (status = 'FAILED' and attempts < 5) order by received_at, id limit 20");
    expect(webhook.processar.mock.calls).toEqual([['e1'], ['e2']]);
  });
});

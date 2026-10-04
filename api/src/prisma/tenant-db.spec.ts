import { TenantDb } from './tenant-db';

function fakePrisma() {
  const calls: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`raw:${strings.join('?')}|${JSON.stringify(values)}`);
      return 1;
    }),
    $executeRawUnsafe: jest.fn(async (sql: string) => {
      calls.push(`unsafe:${sql}`);
      return 0;
    }),
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma, tx, calls };
}

describe('TenantDb', () => {
  const claims = { sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' };

  it('aplica as claims e o papel authenticated antes da consulta, na mesma transação', async () => {
    const { prisma, tx, calls } = fakePrisma();
    const db = new TenantDb(prisma as never);
    const result = await db.run(claims, async (t) => {
      expect(t).toBe(tx);
      calls.push('work');
      return 42;
    });
    expect(result).toBe(42);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      `raw:select set_config('request.jwt.claims', ?, true)|${JSON.stringify([JSON.stringify(claims)])}`,
      'unsafe:set local role authenticated',
      'work',
    ]);
  });

  it('recusa claims sem usuário autenticado', async () => {
    const { prisma } = fakePrisma();
    const db = new TenantDb(prisma as never);
    await expect(db.run({ sub: '', role: 'authenticated' }, async () => 1)).rejects.toThrow('claims_invalidas');
    await expect(db.run({ sub: claims.sub, role: 'anon' }, async () => 1)).rejects.toThrow('claims_invalidas');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

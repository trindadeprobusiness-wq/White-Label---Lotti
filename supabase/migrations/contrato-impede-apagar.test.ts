import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// As tabelas reproduzem as chaves como estavam em produção antes desta
// migration — CASCADE nas duas, e faturas/repasses também em cascata a partir
// do contrato. É esse encadeamento que apagou contratos ativos em 2026-10-02.
let db: PGlite;

const migration = () => db.exec(readFileSync(new URL('./20261003090000_contrato_impede_apagar_cliente_e_imovel.sql', import.meta.url), 'utf8'));
const conta = async (tabela: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${tabela}`)).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.clientes(id uuid primary key, nome text not null);
    create table public.imoveis(id uuid primary key, titulo text not null);
    create table public.contratos(
      id uuid primary key,
      cliente_id uuid references public.clientes(id) on delete cascade,
      imovel_id uuid references public.imoveis(id) on delete cascade,
      status text not null);
    create table public.faturas_aluguel(id uuid primary key default gen_random_uuid(),
      contrato_id uuid references public.contratos(id) on delete cascade);
    create table public.repasses_proprietario(id uuid primary key default gen_random_uuid(),
      contrato_id uuid references public.contratos(id) on delete cascade);

    insert into public.clientes values
      ('c0000000-0000-4000-8000-000000000001','Marlene Gonzaga de Mattos'),
      ('c0000000-0000-4000-8000-000000000002','Lead sem contrato');
    insert into public.imoveis values
      ('10000000-0000-4000-8000-000000000001','Apartamento 603 - Jardins do Éden'),
      ('10000000-0000-4000-8000-000000000002','Imóvel sem contrato');
    insert into public.contratos values
      ('a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ATIVO');
    insert into public.faturas_aluguel(contrato_id) values ('a0000000-0000-4000-8000-000000000001');
    insert into public.repasses_proprietario(contrato_id) values ('a0000000-0000-4000-8000-000000000001');
  `);
  await migration();
});
afterAll(async () => db?.close());

describe('contrato impede apagar cliente e imóvel', () => {
  it('apagar cliente com contrato falha, e o contrato fica', async () => {
    await expect(db.exec("delete from public.clientes where id='c0000000-0000-4000-8000-000000000001'"))
      .rejects.toThrow(/RESTRICT setting of foreign key constraint/);
    expect(await conta('public.contratos')).toBe(1);
    expect(await conta('public.faturas_aluguel')).toBe(1);
    expect(await conta('public.repasses_proprietario')).toBe(1);
  });

  it('apagar imóvel com contrato falha, e o contrato fica', async () => {
    await expect(db.exec("delete from public.imoveis where id='10000000-0000-4000-8000-000000000001'"))
      .rejects.toThrow(/RESTRICT setting of foreign key constraint/);
    expect(await conta('public.contratos')).toBe(1);
  });

  it('cliente e imóvel sem contrato continuam podendo ser apagados', async () => {
    await db.exec("delete from public.clientes where id='c0000000-0000-4000-8000-000000000002'");
    await db.exec("delete from public.imoveis where id='10000000-0000-4000-8000-000000000002'");
    expect(await conta('public.clientes')).toBe(1);
    expect(await conta('public.imoveis')).toBe(1);
  });

  it('excluir o contrato de propósito continua funcionando, e libera o cliente', async () => {
    // O caminho deliberado segue aberto: tratar o contrato primeiro.
    await db.exec("delete from public.contratos where id='a0000000-0000-4000-8000-000000000001'");
    expect(await conta('public.faturas_aluguel')).toBe(0);
    await db.exec("delete from public.clientes where id='c0000000-0000-4000-8000-000000000001'");
    expect(await conta('public.clientes')).toBe(0);
  });

  it('as duas chaves ficam RESTRICT e não sobra chave duplicada', async () => {
    const r = await db.query<{ conname: string; regra: string }>(`
      select conname, case confdeltype when 'r' then 'RESTRICT' when 'c' then 'CASCADE' else confdeltype::text end as regra
        from pg_constraint where conrelid='public.contratos'::regclass and contype='f'
         and confrelid in ('public.clientes'::regclass, 'public.imoveis'::regclass) order by 1`);
    expect(r.rows).toEqual([
      { conname: 'contratos_cliente_id_fkey', regra: 'RESTRICT' },
      { conname: 'contratos_imovel_id_fkey', regra: 'RESTRICT' },
    ]);
  });
});

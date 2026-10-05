import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlterarDocumentoDto, CriarDocumentoDto } from './documentos.dto';
import { DocumentosService } from './documentos.service';

const A = '11111111-1111-4111-8111-111111111111';
const CORRETOR = '55555555-5555-4555-8555-555555555555';
const OUTRO = '66666666-6666-4666-8666-666666666666';
const claims = { sub: 'u1', role: 'authenticated' };

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  return { tx, db, servico: new DocumentosService(db as never) };
}
const sql = (tx: { $queryRaw: jest.Mock }, i: number) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;
const texto = (tx: { $queryRaw: jest.Mock }, i: number) => sql(tx, i).text.replace(/\s+/g, ' ').trim();
const dto = <T extends object>(Classe: new () => T, dados: Partial<T>): T => Object.assign(new Classe(), dados);

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

describe('DocumentosService', () => {
  it('listar: created_at desc, id e teto', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: A } }]);
    expect(await servico.listar(claims)).toEqual([{ id: A }]);
    expect(texto(tx, 0)).toBe('select to_jsonb(d) as linha from public.documentos d order by d.created_at desc, d.id limit $1::int');
  });

  it('arquivo_path de outra conta → 422 arquivo_invalido, sem insert', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]);
    const r = await erroDe(servico.criar(claims, dto(CriarDocumentoDto, { nome: 'RG', tipo: 'RG', arquivo_path: `${OUTRO}/rg.pdf` })));
    expect(r).toEqual({ status: 422, body: { statusCode: 422, codigo: 'arquivo_invalido', message: 'O arquivo não pertence a esta conta.' } });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("insert com 'false' literal em validado e sem updated_at", async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([{ id: CORRETOR }]).mockResolvedValueOnce([{ linha: { id: A } }]);
    await servico.criar(claims, dto(CriarDocumentoDto, { nome: 'RG', tipo: 'RG', arquivo_path: `${CORRETOR}/rg.pdf` }));
    const t = texto(tx, 1);
    expect(t).toContain('insert into public.documentos as x (corretor_id, validado, nome, tipo, arquivo_path)');
    expect(t).toContain('select $1::uuid, false, r.nome, r.tipo, r.arquivo_path from jsonb_populate_record(null::public.documentos, $2::jsonb) r');
    expect(t).not.toContain('updated_at');
  });

  it('update nunca contém updated_at; zero linhas → 404', async () => {
    const { tx, servico } = montar();
    tx.$queryRaw.mockResolvedValueOnce([]);
    const r = await erroDe(servico.alterar(claims, A, dto(AlterarDocumentoDto, { validado: true })));
    expect(r.body).toEqual({ statusCode: 404, codigo: 'documento_nao_encontrado', message: 'Documento não encontrado.' });
    expect(texto(tx, 0)).toContain('update public.documentos t set (validado) =');
    expect(texto(tx, 0)).not.toContain('updated_at');
  });

  it('42501 → 403 com a mensagem de documentos', async () => {
    const { db, servico } = montar();
    db.run.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2010', clientVersion: 'teste', meta: { code: '42501', message: 'ERROR: new row violates row-level security policy for table "documentos"' },
    }));
    expect(await erroDe(servico.criar(claims, dto(CriarDocumentoDto, { nome: 'RG', tipo: 'RG', arquivo_path: `${CORRETOR}/x` })))).toEqual({
      status: 403, body: { statusCode: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para gerenciar documentos desta conta.' },
    });
  });
});

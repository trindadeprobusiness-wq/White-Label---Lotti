import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../../prisma/tenant-db';
import { OnboardingService } from './onboarding.service';

const claims = { sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'authenticated' } as SupabaseClaims;
const ORG = '11111111-1111-4111-8111-111111111111';

const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
const db = { run: jest.fn(async (_c: SupabaseClaims, w: (t: unknown) => unknown) => w(tx)) };
const servico = new OnboardingService(db as unknown as TenantDb);

const consulta = (i = 0) => tx.$queryRaw.mock.calls[i][0] as Prisma.Sql;
const comando = (i = 0) => tx.$executeRaw.mock.calls[i][0] as Prisma.Sql;

async function corpoDoErro(p: Promise<unknown>): Promise<{ status: number; corpo: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('era esperado um HttpException');
}

beforeEach(() => {
  tx.$queryRaw.mockReset();
  tx.$executeRaw.mockReset();
  db.run.mockClear();
});

describe('OnboardingService', () => {
  it('O1: chama get_onboarding_contexto e repassa o jsonb cru, com as claims no run', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { profile: { id: 'p' } } }]);
    expect(await servico.contexto(claims)).toEqual({ profile: { id: 'p' } });
    expect(consulta().text).toContain('select public.get_onboarding_contexto() as linha');
    expect(db.run.mock.calls[0][0]).toBe(claims);
  });

  it('O1: a função pode devolver NULL, e a rota responde null', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: null }]);
    expect(await servico.contexto(claims)).toBeNull();
  });

  it('O2: jsonb, text e os ausentes como {} e null', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { profile: {} } }]);
    await servico.salvar(claims, { profile: { persona: 'corretor_autonomo' }, stepKey: 'persona', stepStatus: 'concluido' });
    const sql = consulta();
    expect(sql.text).toContain('public.salvar_onboarding($1::jsonb, $2::jsonb, $3::text, $4::text) as linha');
    expect(sql.values).toEqual(['{"persona":"corretor_autonomo"}', '{}', 'persona', 'concluido']);
  });

  it('O2: corpo vazio manda {}, {}, null, null', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: null }]);
    expect(await servico.salvar(claims, {})).toBeNull();
    expect(consulta().values).toEqual(['{}', '{}', null, null]);
  });

  it('O3: chama a RPC e não reescreve a lógica (sem insert/update/delete no SQL)', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ORG, reused: false } }]);
    expect(await servico.executarAcao(claims, { action: 'first_client', payload: { nome: 'Ana' } }))
      .toEqual({ id: ORG, reused: false });
    const sql = consulta();
    expect(sql.text).toContain('public.onboarding_executar_acao($1::text, $2::jsonb) as linha');
    expect(sql.values).toEqual(['first_client', '{"nome":"Ana"}']);
    expect(sql.text).not.toMatch(/insert into|update |delete from/i);
  });

  it('O3: payload ausente vira {}', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { removed: true } }]);
    expect(await servico.executarAcao(claims, { action: 'remove_samples' })).toEqual({ removed: true });
    expect(consulta().values).toEqual(['remove_samples', '{}']);
  });

  it('O4: função void vai por $executeRaw, nunca por $queryRaw', async () => {
    tx.$executeRaw.mockResolvedValueOnce(1);
    await servico.registrarEvento(claims, { eventName: 'persona_selected', metadata: { persona: 'x' } });
    const sql = comando();
    expect(sql.text).toContain('public.registrar_onboarding_evento($1::text, $2::text, $3::text, $4::jsonb)');
    expect(sql.values).toEqual(['persona_selected', null, 'onboarding', '{"persona":"x"}']);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('O5: função void vai por $executeRaw com ::int no passo', async () => {
    tx.$executeRaw.mockResolvedValueOnce(1);
    await servico.salvarTour(claims, { tourKey: 'crm', status: 'concluido' });
    const sql = comando();
    expect(sql.text).toContain('public.salvar_onboarding_tour($1::text, $2::text, $3::int)');
    expect(sql.values).toEqual(['crm', 'concluido', 0]);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('O6: minimized grava e o profile_id sai das claims', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'c1' }]);
    await servico.salvarChecklist(claims, { minimized: true });
    const sql = consulta();
    expect(sql.text).toContain('update public.onboarding_checklist c set (minimized, atualizado_em)');
    expect(sql.text).toContain('jsonb_populate_record(null::public.onboarding_checklist, $1::jsonb) r');
    expect(sql.text).toContain('where c.profile_id = (select p.id from public.onboarding_profiles p where p.user_id = $2::uuid)');
    expect(sql.values[1]).toBe(claims.sub);
    expect(JSON.parse(sql.values[0] as string)).toMatchObject({ minimized: true });
  });

  it('O6: dismissed true vira dismissed_at; dismissed false não entra no SQL', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'c1' }]);
    await servico.salvarChecklist(claims, { dismissed: true });
    expect(consulta().text).toContain('dismissed_at');
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'c1' }]);
    await servico.salvarChecklist(claims, { dismissed: false });
    expect(consulta().text).not.toContain('dismissed_at');
  });

  it('O6: corpo vazio responde 400 nada_para_atualizar sem tocar o banco', async () => {
    const r = await corpoDoErro(servico.salvarChecklist(claims, {}));
    expect(r.status).toBe(400);
    expect(r.corpo.codigo).toBe('nada_para_atualizar');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('O6: zero linhas no returning responde 404', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    const r = await corpoDoErro(servico.salvarChecklist(claims, { minimized: false }));
    expect(r.status).toBe(404);
    expect(r.corpo).toEqual({ statusCode: 404, codigo: 'nao_encontrado', message: 'Seu onboarding ainda não foi criado. Recarregue a página.' });
  });

  it('O7: só as colunas da allowlist, com user_id das claims', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'k1' }]);
    await servico.atualizarPerfil(claims, { nome: 'Ana', cidade: 'Campinas' });
    const sql = consulta();
    expect(sql.text).toContain('update public.corretores t set (nome, cidade)');
    expect(sql.text).toContain('where t.user_id = $2::uuid returning t.id');
    expect(sql.values[1]).toBe(claims.sub);
    expect(JSON.parse(sql.values[0] as string)).toEqual({ nome: 'Ana', cidade: 'Campinas' });
  });

  it('O7: chave fora da allowlist não aparece no SQL', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'k1' }]);
    await servico.atualizarPerfil({ ...claims }, { nome: 'Ana', status: 'ativo' } as never);
    expect(consulta().text).not.toContain('status');
    expect(consulta().values[0]).toBe('{"nome":"Ana"}');
  });

  it('O7: corpo vazio 400 e zero linhas 404', async () => {
    expect((await corpoDoErro(servico.atualizarPerfil(claims, {}))).corpo.codigo).toBe('nada_para_atualizar');
    tx.$queryRaw.mockResolvedValueOnce([]);
    const r = await corpoDoErro(servico.atualizarPerfil(claims, { nome: 'Ana' }));
    expect(r.status).toBe(404);
    expect(r.corpo.message).toBe('Perfil não encontrado.');
  });

  it('O8: traduz as chaves do front para as colunas inglesas e usa o :id da URL', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: ORG }]);
    await servico.atualizarOrganizacao(claims, ORG, { nome: 'Imobiliária', tipo_operacao: ['venda'] });
    const sql = consulta();
    expect(sql.text).toContain('update public.routine_organizations t set (name, operation_types)');
    expect(sql.text).toContain('where t.id = $2::uuid returning t.id');
    expect(sql.values[1]).toBe(ORG);
    expect(JSON.parse(sql.values[0] as string)).toEqual({ name: 'Imobiliária', operation_types: ['venda'] });
    expect(sql.text).not.toContain('nome');
  });

  it('O8: corpo vazio 400; zero linhas (id inexistente ou policy negando) 404', async () => {
    expect((await corpoDoErro(servico.atualizarOrganizacao(claims, ORG, {}))).corpo.codigo).toBe('nada_para_atualizar');
    tx.$queryRaw.mockResolvedValueOnce([]);
    const r = await corpoDoErro(servico.atualizarOrganizacao(claims, ORG, { cidade: 'Campinas' }));
    expect(r.status).toBe(404);
    expect(r.corpo.message).toBe('Organização não encontrada.');
  });

  it('O9: papel padrão corretor e o token sai cru da função', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { id: ORG, token: 'segredo', expires_in_days: 7 } }]);
    const r = await servico.criarConvite(claims, { email: 'ana@exemplo.com' });
    expect(r).toEqual({ id: ORG, token: 'segredo', expires_in_days: 7 });
    const sql = consulta();
    expect(sql.text).toContain('public.criar_convite_organizacao($1::text, $2::text) as linha');
    expect(sql.values).toEqual(['ana@exemplo.com', 'corretor']);
  });

  it('O10: manda só o token', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ linha: { organization_id: ORG, papel: 'gestor' } }]);
    expect(await servico.aceitarConvite(claims, { token: 't' })).toEqual({ organization_id: ORG, papel: 'gestor' });
    const sql = consulta();
    expect(sql.text).toContain('public.aceitar_convite_organizacao($1::text) as linha');
    expect(sql.values).toEqual(['t']);
  });

  it('erro do banco é traduzido fora do run (402 do gatilho de cota em O3)', async () => {
    tx.$queryRaw.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2010', clientVersion: 'teste', meta: { code: 'P0001', message: 'ERROR: PLAN_LIMIT_REACHED:max_imoveis' },
    }));
    const r = await corpoDoErro(servico.executarAcao(claims, { action: 'first_property', payload: {} }));
    expect(r.status).toBe(402);
    expect(r.corpo).toMatchObject({ codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis' });
  });
});

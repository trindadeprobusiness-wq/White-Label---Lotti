import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { DiagnosticosCrescimentoAdminController } from './diagnosticos-crescimento.controller';
import { DiagnosticosCrescimentoAdminService } from './diagnosticos-crescimento.service';

/**
 * A rota do painel com o pipe de produção: passa pelo guard, entrega o corpo cru ao service (sem DTO:
 * o ValidationPipe não recusa `action`/`filters`) e responde exatamente o status e o corpo do service,
 * como a Edge diagnostic-admin. As regras e o SQL estão em test/sql-real/diagnostico-crescimento.test.ts.
 */
const claims = { sub: '11111111-1111-4111-8111-111111111111', role: 'authenticated' };

describe('DiagnosticosCrescimentoAdminController', () => {
  let app: INestApplication;
  let autenticou = 0;
  let liberar = true;
  const servico = { executar: jest.fn(async () => ({ status: 200, corpo: { items: [], total: 0 } as unknown })) };
  const guard: CanActivate = {
    canActivate: (ctx) => { autenticou += 1; ctx.switchToHttp().getRequest().claims = claims; return liberar; },
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [DiagnosticosCrescimentoAdminController],
      providers: [{ provide: DiagnosticosCrescimentoAdminService, useValue: servico }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); autenticou = 0; liberar = true; });

  const http = () => request(app.getHttpServer());

  it('passa pelo guard e entrega o corpo cru com as claims', async () => {
    const corpo = { action: 'list', filters: { search: 'Ana', page: 2, extra: true } };
    const r = await http().post('/api/admin/diagnosticos-crescimento').send(corpo).expect(200);
    expect(autenticou).toBe(1);
    expect(servico.executar).toHaveBeenCalledWith(claims, corpo);
    expect(r.body).toEqual({ items: [], total: 0 });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('status e corpo do service vão como vieram ({ error } da Edge)', async () => {
    servico.executar.mockResolvedValueOnce({ status: 403, corpo: { error: 'Acesso administrativo necessário.' } });
    await http().post('/api/admin/diagnosticos-crescimento').send({ action: 'list' }).expect(403, { error: 'Acesso administrativo necessário.' });
    servico.executar.mockResolvedValueOnce({ status: 404, corpo: { error: 'Diagnóstico não encontrado.' } });
    await http().post('/api/admin/diagnosticos-crescimento').send({ action: 'detail' }).expect(404, { error: 'Diagnóstico não encontrado.' });
  });

  it('sem login o guard barra antes do service; corpo acima de 16 KiB é 413', async () => {
    liberar = false;
    await http().post('/api/admin/diagnosticos-crescimento').send({ action: 'list' }).expect(403);
    expect(servico.executar).not.toHaveBeenCalled();
    liberar = true;
    await http().post('/api/admin/diagnosticos-crescimento').send({ action: 'follow_up', notes: 'x'.repeat(17_000) })
      .expect(413, { error: 'Requisição muito grande.' });
    expect(servico.executar).not.toHaveBeenCalled();
  });
});

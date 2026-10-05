import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DiagnosticoPublicoController } from './diagnostico-publico.controller';
import { DiagnosticoService } from './diagnostico.service';

/**
 * A Edge Function cortava o corpo em 16 KiB (readPublicJson). A rota é anônima e o analisador de
 * JSON da API aceita 21 MB, então o teto precisa continuar existindo aqui.
 */
describe('DiagnosticoPublicoController', () => {
  let app: INestApplication;
  const servico = { receber: jest.fn(async () => ({ success: true as const })) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DiagnosticoPublicoController],
      providers: [{ provide: DiagnosticoService, useValue: servico }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it('corpo acima de 16 KiB é recusado com 413 e não chega ao service', async () => {
    const grande = { action: 'event', lixo: 'x'.repeat(20_000) };
    const r = await request(app.getHttpServer()).post('/diagnostico-comercial').send(grande).expect(413);
    expect(r.body).toMatchObject({ codigo: 'corpo_grande', message: 'Requisição muito grande.' });
    expect(servico.receber).not.toHaveBeenCalled();
  });

  it('corpo dentro do teto chega ao service', async () => {
    await request(app.getHttpServer()).post('/diagnostico-comercial').send({ action: 'event' }).expect(200);
    expect(servico.receber).toHaveBeenCalledWith({ action: 'event' });
  });
});

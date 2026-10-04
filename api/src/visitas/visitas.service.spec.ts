import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { inicioEmBrasilia, VisitasService } from './visitas.service';

const AGORA = new Date('2026-10-05T12:00:00-03:00');
const pedido = { conversationId: 'conv1', corretorId: 'cor1', data: '2026-10-07', hora: '15:30', imovelId: 'imo1' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function repo(over: Record<string, unknown> = {}): any {
  return {
    conversa: jest.fn(async () => ({ corretorId: 'cor1', clienteId: 'cli1', nome: 'Maria Souza' })),
    corretor: jest.fn(async () => ({ userId: 'user1', nome: 'João Corretor' })),
    organizacao: jest.fn(async () => 'org1'),
    gestores: jest.fn(async () => ['gest1']),
    existente: jest.fn(async () => null),
    conflitos: jest.fn(async () => 0),
    criarEvento: jest.fn(async () => 'evt1'),
    confirmarEvento: jest.fn(async () => true),
    alertasDaVisita: jest.fn(async () => []),
    criarAlertas: jest.fn(async () => undefined),
    marcarLidos: jest.fn(async () => undefined),
    ...over,
  };
}

describe('inicioEmBrasilia', () => {
  it('interpreta data e hora no fuso de Brasília', () => {
    expect(inicioEmBrasilia('2026-10-07', '15:30').toISOString()).toBe('2026-10-07T18:30:00.000Z');
  });
});

describe('VisitasService.solicitar', () => {
  it('horário livre: cria evento pendente na agenda do corretor e alerta só o corretor', async () => {
    const r = repo();
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toMatchObject({ situacao: 'agendada', routineEventId: 'evt1' });
    expect(r.conflitos).toHaveBeenCalledWith({ sub: 'user1', role: 'authenticated' }, 'user1',
      new Date('2026-10-07T18:30:00.000Z'), new Date('2026-10-07T19:30:00.000Z'));
    expect(r.criarEvento).toHaveBeenCalledWith({ sub: 'user1', role: 'authenticated' }, {
      organizationId: 'org1', assignedTo: 'user1', createdBy: 'user1', titulo: 'Visita: Maria Souza',
      inicio: new Date('2026-10-07T18:30:00.000Z'), fim: new Date('2026-10-07T19:30:00.000Z'),
      clienteId: 'cli1', imovelId: 'imo1', status: 'pending_confirmation',
    });
    const alertas = r.criarAlertas.mock.calls[0][0];
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({
      corretorId: 'cor1', clienteId: 'cli1',
      mensagem: 'Maria Souza pediu visita em 07/10 às 15:30. Confirme o agendamento.',
      metadata: { prioridade: 'ALTA', tipo: 'visita_confirmar', visita_id: out.visitaId, conversation_id: 'conv1',
        inicio: '2026-10-07T18:30:00.000Z', fim: '2026-10-07T19:30:00.000Z', imovel_id: 'imo1',
        routine_event_id: 'evt1', corretor_user_id: 'user1' },
    });
  });

  it('horário ocupado: não cria evento e alerta corretor e gestores', async () => {
    const r = repo({ conflitos: jest.fn(async () => 2) });
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toMatchObject({ situacao: 'conflito', routineEventId: null });
    expect(r.criarEvento).not.toHaveBeenCalled();
    const alertas = r.criarAlertas.mock.calls[0][0];
    expect(alertas.map((a: { corretorId: string }) => a.corretorId)).toEqual(['cor1', 'gest1']);
    expect(alertas[0].mensagem).toBe('Maria Souza pediu visita em 07/10 às 15:30, mas a agenda de João Corretor está ocupada. Um gestor precisa confirmar ou remarcar.');
    expect(alertas.every((a: { metadata: { tipo: string; visita_id: string } }) => a.metadata.tipo === 'visita_conflito' && a.metadata.visita_id === out.visitaId)).toBe(true);
  });

  it('mesma visita pedida de novo não duplica', async () => {
    const r = repo({ existente: jest.fn(async () => 'evt9') });
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toEqual({ visitaId: expect.any(String), situacao: 'existente', routineEventId: 'evt9' });
    expect(r.criarEvento).not.toHaveBeenCalled();
    expect(r.criarAlertas).not.toHaveBeenCalled();
  });

  it('recusa visita no passado, conversa de outro corretor e conversa inexistente', async () => {
    await expect(new VisitasService(repo() as never).solicitar({ ...pedido, data: '2026-10-05', hora: '09:00' }, AGORA))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(new VisitasService(repo({ conversa: jest.fn(async () => ({ corretorId: 'outro', clienteId: null, nome: null })) }) as never).solicitar(pedido, AGORA))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(new VisitasService(repo({ conversa: jest.fn(async () => null) }) as never).solicitar(pedido, AGORA))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem nome do contato usa "Contato do WhatsApp"', async () => {
    const r = repo({ conversa: jest.fn(async () => ({ corretorId: 'cor1', clienteId: null, nome: null })) });
    await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(r.criarEvento.mock.calls[0][1].titulo).toBe('Visita: Contato do WhatsApp');
  });
});

describe('VisitasService.confirmar', () => {
  const claims = { sub: 'quem-clicou', role: 'authenticated' };
  const meta = (extra: Record<string, unknown>) => ({ visita_id: 'v1', inicio: '2026-10-07T18:30:00.000Z', fim: '2026-10-07T19:30:00.000Z',
    corretor_user_id: 'user1', imovel_id: 'imo1', conversation_id: 'conv1', ...extra });

  it('visita com evento pendente: confirma o evento e marca os alertas', async () => {
    const r = repo({ alertasDaVisita: jest.fn(async () => [{ id: 'a1', metadata: meta({ routine_event_id: 'evt1' }) }]) });
    expect(await new VisitasService(r as never).confirmar(claims, 'v1')).toEqual({ routineEventId: 'evt1' });
    expect(r.confirmarEvento).toHaveBeenCalledWith(claims, 'evt1');
    expect(r.marcarLidos).toHaveBeenCalledWith('v1');
  });

  it('conflito decidido pelo gestor: cria o evento já confirmado na agenda do corretor', async () => {
    const r = repo({
      alertasDaVisita: jest.fn(async () => [{ id: 'a1', metadata: meta({ routine_event_id: null }) }]),
      conversa: jest.fn(async () => ({ corretorId: 'cor1', clienteId: 'cli1', nome: 'Maria Souza' })),
      criarEvento: jest.fn(async () => 'evt2'),
    });
    expect(await new VisitasService(r as never).confirmar(claims, 'v1')).toEqual({ routineEventId: 'evt2' });
    expect(r.criarEvento).toHaveBeenCalledWith(claims, expect.objectContaining({
      organizationId: 'org1', assignedTo: 'user1', createdBy: 'quem-clicou', status: 'confirmed', titulo: 'Visita: Maria Souza',
    }));
    expect(r.marcarLidos).toHaveBeenCalledWith('v1');
  });

  it('visita que o usuário não enxerga responde 404', async () => {
    await expect(new VisitasService(repo() as never).confirmar(claims, 'v1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('evento já confirmado por outra pessoa responde 404 e não marca nada', async () => {
    const r = repo({
      alertasDaVisita: jest.fn(async () => [{ id: 'a1', metadata: meta({ routine_event_id: 'evt1' }) }]),
      confirmarEvento: jest.fn(async () => false),
    });
    await expect(new VisitasService(r as never).confirmar(claims, 'v1')).rejects.toBeInstanceOf(NotFoundException);
    expect(r.marcarLidos).not.toHaveBeenCalled();
  });
});

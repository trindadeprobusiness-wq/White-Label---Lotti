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
    configuracao: jest.fn(async () => null),
    ocupados: jest.fn(async () => []),
    visitaFutura: jest.fn(async () => null),
    reservar: jest.fn(async () => 'evt1'),
    cancelarEvento: jest.fn(async () => true),
    ...over,
  };
}

describe('inicioEmBrasilia', () => {
  it('interpreta data e hora no fuso de Brasília', () => {
    expect(inicioEmBrasilia('2026-10-07', '15:30').toISOString()).toBe('2026-10-07T18:30:00.000Z');
  });
});

describe('VisitasService.solicitar', () => {
  it('horário livre: reserva o evento pendente na agenda do corretor e alerta só o corretor', async () => {
    const r = repo();
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toMatchObject({ situacao: 'agendada', routineEventId: 'evt1' });
    expect(r.reservar).toHaveBeenCalledWith({ sub: 'user1', role: 'authenticated' }, {
      organizationId: 'org1', assignedTo: 'user1', createdBy: 'user1', titulo: 'Visita: Maria Souza',
      inicio: new Date('2026-10-07T18:30:00.000Z'), fim: new Date('2026-10-07T19:30:00.000Z'),
      clienteId: 'cli1', imovelId: 'imo1', status: 'pending_confirmation',
    }, null);
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

  it('horário ocupado na agenda, fora do expediente ou tomado no meio do caminho: indisponível, sem marcar nem alertar', async () => {
    const ocupado = repo({ ocupados: jest.fn(async () => [{ inicio: new Date('2026-10-07T18:00:00Z'), fim: new Date('2026-10-07T19:00:00Z') }]) });
    expect(await new VisitasService(ocupado as never).solicitar(pedido, AGORA)).toMatchObject({ situacao: 'indisponivel', routineEventId: null });
    expect(ocupado.reservar).not.toHaveBeenCalled();
    const noite = repo();
    expect(await new VisitasService(noite as never).solicitar({ ...pedido, hora: '21:00' }, AGORA)).toMatchObject({ situacao: 'indisponivel' });
    const corrida = repo({ reservar: jest.fn(async () => null) });
    expect(await new VisitasService(corrida as never).solicitar(pedido, AGORA)).toMatchObject({ situacao: 'indisponivel' });
    for (const r of [ocupado, noite, corrida]) expect(r.criarAlertas).not.toHaveBeenCalled();
  });

  it('cliente que já tem visita: remarca o mesmo evento (sem contar ele como ocupado)', async () => {
    const r = repo({ visitaFutura: jest.fn(async () => ({ id: 'evt7', inicio: new Date('2026-10-06T13:00:00Z') })) });
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toMatchObject({ situacao: 'remarcada' });
    expect(r.ocupados.mock.calls[0][4]).toBe('evt7');
    expect(r.reservar.mock.calls[0][2]).toBe('evt7');
    expect(r.criarAlertas.mock.calls[0][0][0].mensagem).toBe('Maria Souza remarcou a visita de 06/10 às 10:00 para 07/10 às 15:30. Confirme o agendamento.');
  });

  it('mesma visita pedida de novo não duplica', async () => {
    const r = repo({ existente: jest.fn(async () => 'evt9') });
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toEqual({ visitaId: expect.any(String), situacao: 'existente', routineEventId: 'evt9' });
    expect(r.reservar).not.toHaveBeenCalled();
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
    expect(r.reservar.mock.calls[0][1].titulo).toBe('Visita: Contato do WhatsApp');
  });
});

describe('VisitasService.horarios e cancelar', () => {
  it('horários livres no expediente padrão, até 4 por dia, sem os ocupados', async () => {
    const r = repo({ ocupados: jest.fn(async () => [{ inicio: new Date('2026-10-06T11:00:00Z'), fim: new Date('2026-10-06T12:00:00Z') }]) });
    const out = await new VisitasService(r as never).horarios({ conversationId: 'conv1', corretorId: 'cor1' }, AGORA);
    // Segunda 05/10 12:00 + 2h de antecedência: a partir de 14:00.
    expect(out.horarios.slice(0, 4).map((h) => h.id)).toEqual(['2026-10-05T14:00', '2026-10-05T14:30', '2026-10-05T15:00', '2026-10-05T15:30']);
    // Terça 06/10: 08:00 ocupado das 08 às 09 → começa 09:00.
    expect(out.horarios[4]).toEqual({ id: '2026-10-06T09:00', rotulo: 'ter 06/10 09:00' });
    expect(out.horarios).toHaveLength(14);
    expect(out.visitaMarcada).toBeNull();
  });

  it('cancelar: libera a visita futura e avisa o corretor; sem visita não faz nada', async () => {
    const r = repo({ visitaFutura: jest.fn(async () => ({ id: 'evt7', inicio: new Date('2026-10-06T13:00:00Z') })) });
    expect(await new VisitasService(r as never).cancelar({ conversationId: 'conv1', corretorId: 'cor1' }, AGORA)).toEqual({ situacao: 'cancelada' });
    expect(r.cancelarEvento).toHaveBeenCalledWith({ sub: 'user1', role: 'authenticated' }, 'evt7');
    expect(r.criarAlertas.mock.calls[0][0][0].mensagem).toBe('Maria Souza cancelou a visita de 06/10 às 10:00.');
    const sem = repo();
    expect(await new VisitasService(sem as never).cancelar({ conversationId: 'conv1', corretorId: 'cor1' }, AGORA)).toEqual({ situacao: 'sem_visita' });
    expect(sem.criarAlertas).not.toHaveBeenCalled();
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

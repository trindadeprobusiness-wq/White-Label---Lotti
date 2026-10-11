// SQL real da agenda de visitas da IA (como as tools de agenda do Clix): horários livres, marcar,
// duas conversas no mesmo horário, remarcar e cancelar, contra o Postgres (PGlite) com RLS.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { VisitasRepo } from '../../src/visitas/visitas.repo';
import { VisitasService } from '../../src/visitas/visitas.service';
import { criarBanco } from './harness';

const AGORA = new Date('2026-10-05T12:00:00-03:00'); // segunda

test('IA agenda visita: só horário livre, sem duas no mesmo horário, remarca e cancela', async () => {
  const b = await criarBanco();
  try {
    const servico = new VisitasService(new VisitasRepo(b.prisma as unknown as PrismaService, b.db));
    const canal = randomUUID();
    await b.inserir('lotti_agent_channels', { id: canal, corretor_id: b.corretorA, instance: 'teste-visita', enabled: true, sandbox: false });
    const conversa = async (fone: string) => {
      const cliente = (await b.inserir('clientes', { corretor_id: b.corretorA, nome: `Cliente ${fone}`, telefone: fone })).id as string;
      const id = randomUUID();
      await b.inserir('lotti_agent_conversations', { id, channel_id: canal, corretor_id: b.corretorA, phone: `55${fone}`, mode: 'ai', cliente_id: cliente, contact_name: `Cliente ${fone}` });
      return id;
    };
    const c1 = await conversa('62981110001');
    const c2 = await conversa('62981110002');

    const livres = await servico.horarios({ conversationId: c1, corretorId: b.corretorA }, AGORA);
    assert.equal(livres.horarios[0].id, '2026-10-05T14:00');

    // Marca terça 10:00; a segunda conversa não consegue o mesmo horário e não o vê mais na lista.
    const pedido = { corretorId: b.corretorA, data: '2026-10-06', hora: '10:00', imovelId: null };
    assert.equal((await servico.solicitar({ ...pedido, conversationId: c1 }, AGORA)).situacao, 'agendada');
    assert.equal((await servico.solicitar({ ...pedido, conversationId: c2 }, AGORA)).situacao, 'indisponivel');
    const deC2 = await servico.horarios({ conversationId: c2, corretorId: b.corretorA }, AGORA);
    assert.ok(!deC2.horarios.some((h) => h.id === '2026-10-06T10:00'));
    const deC1 = await servico.horarios({ conversationId: c1, corretorId: b.corretorA }, AGORA);
    assert.equal(deC1.visitaMarcada, '06/10 às 10:00');

    // Remarca: o mesmo evento muda de horário (não cria outro) e o horário antigo fica livre.
    assert.equal((await servico.solicitar({ ...pedido, hora: '15:00', conversationId: c1 }, AGORA)).situacao, 'remarcada');
    const eventos = await b.sqlSuperusuario<{ inicio: string; status: string }>(
      `select to_char(start_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as inicio, status from public.routine_events where source='ai' and deleted_at is null order by start_at`);
    assert.deepEqual(eventos, [{ inicio: '06/10 15:00', status: 'pending_confirmation' }]);
    assert.equal((await servico.solicitar({ ...pedido, conversationId: c2 }, AGORA)).situacao, 'agendada');

    // Cancela a de c1: libera o horário.
    assert.deepEqual(await servico.cancelar({ conversationId: c1, corretorId: b.corretorA }, AGORA), { situacao: 'cancelada' });
    assert.equal((await servico.solicitar({ ...pedido, hora: '15:00', conversationId: c2 }, AGORA)).situacao, 'remarcada');
  } finally { await b.fechar(); }
});

import { describe, expect, it, vi } from 'vitest';
import { salvarClienteDoLead, type ServiceDb } from './cliente';

function banco(resultado: { cliente_id: string; created: boolean }, trackingAtual: Record<string, unknown> = {}) {
  const updates: unknown[] = [];
  const rpc = vi.fn(async () => ({ data: resultado, error: null }));
  const from = vi.fn(() => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { tracking_data: trackingAtual }, error: null }),
      insert: () => { throw new Error('insert direto em clientes'); },
      update: (dados: unknown) => { updates.push(dados); return { eq: async () => ({ error: null }) }; },
    };
    return q;
  });
  return { db: { rpc, from } as unknown as ServiceDb, rpc, updates };
}

const lead = {
  telefone: '5562991110003', tipo_interesse: 'AMBOS', status_funil: 'VISITA_PROPOSTA',
  tracking: { origem: 'whatsapp', classificacao: 'quente' },
};

describe('crm-upsert-lead', () => {
  it('cria pelo helper do banco, na conta informada, sem insert direto', async () => {
    const f = banco({ cliente_id: 'novo', created: true });
    await expect(salvarClienteDoLead(f.db, 'corretor-1', { ...lead, nome: 'Ana' })).resolves.toEqual({ cliente_id: 'novo', created: true });
    expect(f.rpc).toHaveBeenCalledWith('lotti_find_or_create_cliente', expect.objectContaining({
      p_owner: 'corretor-1', p_phone: '5562991110003', p_name: 'Ana',
      p_dados: expect.objectContaining({ status_funil: 'VISITA_PROPOSTA', tracking_data: lead.tracking }),
    }));
    expect(f.updates).toEqual([]);
  });

  it('o mesmo telefone em outra grafia atualiza o cliente existente, sem trocar o número', async () => {
    const f = banco({ cliente_id: 'ana', created: false }, { utm_source: 'site' });
    await expect(salvarClienteDoLead(f.db, 'corretor-1', lead)).resolves.toEqual({ cliente_id: 'ana', created: false });
    const [update] = f.updates as Record<string, unknown>[];
    expect(update).not.toHaveProperty('telefone');
    expect(update).not.toHaveProperty('nome'); // "Lead WhatsApp" nunca substitui um nome
    expect(update).toMatchObject({ status_funil: 'VISITA_PROPOSTA', tracking_data: { utm_source: 'site', origem: 'whatsapp', classificacao: 'quente' } });
  });

  it('nome enviado pelo n8n atualiza o cliente existente, como antes', async () => {
    const f = banco({ cliente_id: 'ana', created: false });
    await salvarClienteDoLead(f.db, 'corretor-1', { ...lead, nome: 'Ana Souza' });
    expect(f.updates[0]).toMatchObject({ nome: 'Ana Souza' });
  });
});

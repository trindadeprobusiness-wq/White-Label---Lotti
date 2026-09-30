import { describe, expect, it, vi } from 'vitest';
import { createCommercialDiagnosticHandler } from './handler';

const answers = {
  profile: 'Imobiliária', team: '6–15', sources: ['Anúncios pagos'], acquisition: 'Aproveitar melhor os contatos que chegam',
  leads: '101–250', properties: '51–100', ad_spend: 'R$ 3–10 mil', response: 'Às vezes demora ou fica sem resposta',
  followup: 'Muitos contatos ficam sem retorno', tools: ['CRM'], crm: 'CRM atual', gaps: ['Demora no atendimento'],
  priority: 'Responder e converter melhor', timing: 'Agora', decision: 'Eu decido',
};
const id = 'a81ad0c4-6df5-4d35-b282-d261aa1be2d3';
function request(body: object) { return new Request('https://example.test/functions/v1/commercial-diagnostic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }

describe('captura do diagnóstico comercial', () => {
  it('calcula scores no servidor e persiste respostas, origem e evento', async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];
    const client = {
      rpc: vi.fn(async () => ({ data: true, error: null })),
      from: (table: string) => ({ insert: async (payload: unknown) => { inserts.push({ table, payload }); return { error: null }; } }),
    };
    const handler = createCommercialDiagnosticHandler(client as never, 'segredo-de-teste');
    const res = await handler(request({ action: 'submit', session_id: id, answers, name: 'Pessoa Teste', phone: '11999999999', consent: true, attribution: { utm_source: 'instagram', is_admin: 'true' } }));
    expect(res.status).toBe(200);
    const saved = inserts.find(row => row.table === 'commercial_diagnostics')?.payload as Record<string, unknown>;
    expect(saved.phone).toBe('5511999999999');
    expect(saved.dominant_problem).toBe('ATENDIMENTO');
    expect(saved.attribution).toEqual({ utm_source: 'instagram' });
    expect(inserts.find(row => row.table === 'commercial_diagnostic_events')).toBeTruthy();
  });
  it('não aceita resposta manipulada nem contato sem consentimento', async () => {
    const insert = vi.fn();
    const client = { rpc: vi.fn(async () => ({ data: true, error: null })), from: () => ({ insert }) };
    const handler = createCommercialDiagnosticHandler(client as never, 'segredo-de-teste');
    const base = { action: 'submit', session_id: id, answers, name: 'Pessoa Teste', phone: '11999999999' };
    expect((await handler(request({ ...base, consent: false }))).status).toBe(400);
    expect((await handler(request({ ...base, consent: true, answers: { ...answers, profile: 'Administrador' } }))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });
});

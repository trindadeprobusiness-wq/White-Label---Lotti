import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/stores/crmStore', () => ({ useCRMStore: (select: (state: { corretor: { id: string } }) => unknown) => select({ corretor: { id: 'legacy' } }) }));
import { useCheckLimit } from './useSubscription';

function queries(subscription: unknown, loading = false) {
  const plan = { id: 'p1', display_order: 1, entitlements: [{ feature_key: 'max_imoveis', enabled: true, limit_value: 5, unlimited: false }] };
  for (const data of [subscription, [plan], [{ feature_key: 'max_imoveis', used_quantity: 5 }], []]) {
    mocks.query.mockReturnValueOnce({ data, isLoading: loading, error: null });
  }
}
beforeEach(() => mocks.query.mockReset());
describe('compatibilidade de limites na integração da branch', () => {
  it('preserva criação para conta legada sem assinatura', () => {
    queries(null);
    expect(useCheckLimit()('max_imoveis')).toMatchObject({ allowed: true, ready: true });
  });
  it('aguarda a consulta antes de liberar a criação', () => {
    queries(null, true);
    expect(useCheckLimit()('max_imoveis')).toMatchObject({ allowed: false, ready: false });
  });
  it('continua bloqueando uma assinatura com cota esgotada', () => {
    queries({ plan_id: 'p1', status: 'active', current_period_end: '2099-01-01' });
    expect(useCheckLimit()('max_imoveis')).toMatchObject({ allowed: false, used: 5, limit: 5 });
  });
});

describe('validade do acesso pago', () => {
  it.each(['canceled','expired','past_due','read_only'])('não libera estado %s', (status) => {
    queries({plan_id:'p1',status,current_period_end:'2099-01-01'});
    expect(useCheckLimit()('max_imoveis').allowed).toBe(false);
  });
  it('não transforma plano desconhecido em ilimitado', () => {
    queries({plan_id:'unknown',status:'active',current_period_end:'2099-01-01'});
    expect(useCheckLimit()('max_imoveis').allowed).toBe(false);
  });
  it('nega acesso quando o período pago terminou', () => {
    queries({plan_id:'p1',status:'active',current_period_end:'2000-01-01'});
    expect(useCheckLimit()('max_imoveis').allowed).toBe(false);
  });
});

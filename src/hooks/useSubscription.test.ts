import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), rpc: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.query, useMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/stores/crmStore', () => ({ useCRMStore: (select: (state: { corretor: { id: string } }) => unknown) => select({ corretor: { id: 'legacy' } }) }));
import { useCheckLimit } from './useSubscription';

function queries(subscription: unknown, loading = false, contaAntiga: { data?: boolean; error?: Error; isLoading?: boolean; failureCount?: number } = { data: false }) {
  const plan = { id: 'p1', display_order: 1, entitlements: [
    { feature_key: 'max_imoveis', enabled: true, limit_value: 5, unlimited: false },
    { feature_key: 'max_contratos_locacao', enabled: true, limit_value: 5, unlimited: false },
    { feature_key: 'ai_contracts_monthly', enabled: true, limit_value: 10, unlimited: false },
  ] };
  const usage = [
    { feature_key: 'max_imoveis', used_quantity: 5 },
    { feature_key: 'max_contratos_locacao', used_quantity: 16 },
    { feature_key: 'ai_contracts_monthly', used_quantity: 10 },
  ];
  for (const data of [subscription, [plan], usage, []]) {
    mocks.query.mockReturnValueOnce({ data, isLoading: loading, error: null });
  }
  mocks.query.mockReturnValueOnce({
    data: contaAntiga.data, isLoading: contaAntiga.isLoading ?? loading,
    failureCount: contaAntiga.failureCount ?? 0, error: contaAntiga.error ?? null,
  });
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

// O caso de 2026-10-02: conta antiga com 16 aluguéis ganha teste do Essencial
// (limite 5) para ligar a IA, e a tela passa a barrar contrato novo.
describe('conta antiga com assinatura de teste', () => {
  const teste = { plan_id: 'p1', status: 'trialing', trial_ends_at: '2099-01-01' };
  it('continua sem limite de aluguéis acima da cota do teste', () => {
    queries(teste, false, { data: true });
    expect(useCheckLimit()('max_contratos_locacao')).toMatchObject({ allowed: true, unlimited: true, ready: true });
  });
  it('segue o plano de teste nas cotas de IA', () => {
    queries(teste, false, { data: true });
    expect(useCheckLimit()('ai_contracts_monthly')).toMatchObject({ allowed: false, used: 10, limit: 10 });
  });
  it('teste vencido mantém os recursos e corta a IA', () => {
    queries({ ...teste, status: 'expired' }, false, { data: true });
    const checar = useCheckLimit();
    expect(checar('max_imoveis').allowed).toBe(true);
    expect(checar('ai_contracts_monthly').allowed).toBe(false);
  });
  it('conta nova em teste continua presa ao limite', () => {
    queries(teste, false, { data: false });
    expect(useCheckLimit()('max_contratos_locacao')).toMatchObject({ allowed: false, used: 16, limit: 5 });
  });
  it('enquanto a conta antiga carrega, só os três recursos esperam', () => {
    queries(teste, false, { isLoading: true });
    const checar = useCheckLimit();
    expect(checar('max_contratos_locacao')).toMatchObject({ allowed: false, ready: false });
    expect(checar('ai_contracts_monthly')).toMatchObject({ ready: true, limit: 10 });
  });
  it('se a primeira pergunta falha, vale o plano enquanto tenta de novo', () => {
    queries(teste, false, { isLoading: true, failureCount: 1 });
    expect(useCheckLimit()('max_contratos_locacao')).toMatchObject({ allowed: false, ready: true, limit: 5 });
  });
  it('sem resposta sobre a conta antiga, vale o plano — e o resto não trava', () => {
    queries(teste, false, { error: new Error('rede') });
    const checar = useCheckLimit();
    expect(checar('max_contratos_locacao')).toMatchObject({ allowed: false, ready: true });
    expect(checar('ai_contracts_monthly')).toMatchObject({ ready: true, limit: 10 });
  });
});

describe('pergunta ao banco se a conta é antiga', () => {
  const usePergunta = (resposta: { data: unknown; error: unknown }) => {
    queries(null);
    useCheckLimit();
    const { queryFn, queryKey } = mocks.query.mock.calls[4][0];
    mocks.rpc.mockReset().mockResolvedValueOnce(resposta);
    return { queryKey, resultado: queryFn() as Promise<boolean> };
  };
  it('chama a função do banco com a própria conta', async () => {
    const { queryKey, resultado } = usePergunta({ data: true, error: null });
    await expect(resultado).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('conta_antiga_sem_limite', { _corretor_id: 'legacy' });
    expect(queryKey).toEqual(['conta-antiga-sem-limite', 'legacy']);
  });
  it('só uma resposta true conta como conta antiga', async () => {
    await expect(usePergunta({ data: null, error: null }).resultado).resolves.toBe(false);
    mocks.query.mockReset();
    await expect(usePergunta({ data: 'true', error: null }).resultado).resolves.toBe(false);
  });
  it('erro da função vira erro da consulta, para a tela cair no plano', async () => {
    await expect(usePergunta({ data: null, error: { code: 'PGRST202' } }).resultado).rejects.toMatchObject({ code: 'PGRST202' });
  });
});

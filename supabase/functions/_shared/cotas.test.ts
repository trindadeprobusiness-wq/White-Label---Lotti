import { describe, expect, it, vi } from 'vitest';
import { consumirCota } from './cotas';

describe('consumirCota', () => {
  it('nega sem registrar quando a cota acabou', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: [{ permitido: false, usado: 10, limite: 10, ilimitado: false, habilitado: true }],
      error: null,
    });
    const result = await consumirCota({ rpc }, 'corretor', 'ai_contracts_monthly');
    expect(result.permitido).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('registra uma unidade somente depois de uma operação bem-sucedida', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{ permitido: true, usado: 9, limite: 10, ilimitado: false, habilitado: true }],
        error: null,
      })
      .mockResolvedValueOnce({ data: 10, error: null });
    const result = await consumirCota({ rpc }, 'corretor', 'ai_contracts_monthly', async () => 'ok');
    expect(result.resultado).toBe('ok');
    expect(rpc).toHaveBeenLastCalledWith('incrementar_uso', {
      _corretor_id: 'corretor', _feature_key: 'ai_contracts_monthly', _quantidade: 1,
    });
  });
});

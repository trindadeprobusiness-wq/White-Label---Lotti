import { describe, expect, it } from 'vitest';
import { negocioDoCliente } from './negocioDoCliente';
import type { CrmOportunidade } from '@/lib/crm/tipos';

const negocio = (extra: Partial<CrmOportunidade>): CrmOportunidade => ({
  id: 'n', corretor_id: 'c', cliente_id: 'cli', imovel_id: null, etapa_id: 'e1', titulo: 'Negócio', valor_estimado: 0,
  probabilidade: 0, data_prevista_fechamento: null, motivo_perda: null, origem: null, ordem: 0, observacoes: null,
  fechada_em: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
});

describe('negocioDoCliente (mesma regra de crm_oportunidade_aberta)', () => {
  it('pega o aberto mais recente pelo updated_at e conta os outros abertos', () => {
    const lista = [
      negocio({ id: 'antigo', updated_at: '2026-10-01T10:00:00Z' }),
      negocio({ id: 'recente', updated_at: '2026-10-09T10:00:00Z' }),
      negocio({ id: 'fechado', updated_at: '2026-10-10T10:00:00Z', fechada_em: '2026-10-10T10:00:00Z' }),
      negocio({ id: 'de-outro', cliente_id: 'outro', updated_at: '2026-10-11T10:00:00Z' }),
    ];
    const { negocio: escolhido, outros } = negocioDoCliente(lista, 'cli');
    expect(escolhido?.id).toBe('recente');
    expect(outros).toBe(1);
  });

  it('sem cliente, sem lista ou sem negócio aberto: nada', () => {
    expect(negocioDoCliente([negocio({})], null)).toEqual({ negocio: undefined, outros: 0 });
    expect(negocioDoCliente(undefined, 'cli')).toEqual({ negocio: undefined, outros: 0 });
    expect(negocioDoCliente([negocio({ fechada_em: '2026-10-02T00:00:00Z' })], 'cli')).toEqual({ negocio: undefined, outros: 0 });
  });
});

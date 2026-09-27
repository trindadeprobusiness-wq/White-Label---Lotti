import { useEtapas } from '@/hooks/crm/useCrm';
import type { StageOption } from './components';

/**
 * Etapas do funil para os seletores de "mover etapa". Só leitura, pela RLS do
 * CRM; se a consulta falhar, os seletores ficam apenas com "Não mover".
 */
export function useStageOptions(): { stages: StageOption[]; unavailable: boolean } {
  const etapas = useEtapas();
  return {
    stages: (etapas.data ?? []).map((etapa) => ({ id: etapa.id, name: etapa.nome })),
    unavailable: etapas.isError,
  };
}

export const stageName = (stages: StageOption[], id: string | null) =>
  id ? stages.find((stage) => stage.id === id)?.name : undefined;

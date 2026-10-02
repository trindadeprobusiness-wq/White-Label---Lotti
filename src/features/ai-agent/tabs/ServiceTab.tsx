import { BehaviorTab } from './BehaviorTab';
import { CycleTab } from './CycleTab';
import type { AgentTabProps } from './types';

/**
 * Atendimento: quando a IA entra, o que faz enquanto está lá, e como sai.
 *
 * Eram duas abas — "Comportamento" e "Ciclo da conversa" — com duas e três
 * seções. Separadas, obrigavam a pular de uma para a outra para entender uma
 * coisa só: como o agente conduz a conversa do começo ao fim.
 */
export function ServiceTab(props: AgentTabProps) {
  return <>
    <BehaviorTab {...props} />
    <CycleTab {...props} />
  </>;
}

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CRM from './CRM';

vi.mock('@/hooks/crm/useCrm', () => ({ useLeadsPendentes: () => ({ data: [] }) }));
vi.mock('@/components/crm/CrmPipeline', () => ({ CrmPipeline: () => <input aria-label="Busca do pipeline" /> }));
vi.mock('@/components/crm/CrmDashboard', () => ({ CrmDashboard: () => null }));
vi.mock('@/components/crm/CrmLeadsInbox', () => ({ CrmLeadsInbox: () => null }));
vi.mock('@/components/crm/CrmTarefas', () => ({ CrmTarefas: () => null }));
vi.mock('@/components/shell/GlobalSearch', () => ({ GlobalSearch: () => <input aria-label="Busca global" /> }));
vi.mock('@/components/shell/PainelNotificacoes', () => ({ PainelNotificacoes: () => null }));
vi.mock('@/components/shell/BotaoPrivacidade', () => ({ BotaoPrivacidade: () => null }));
vi.mock('@/components/shell/PainelAjuda', () => ({ PainelAjuda: () => null }));

describe('CRM', () => {
  it('não duplica a busca global quando o pipeline já tem sua própria busca', () => {
    const html = renderToStaticMarkup(<CRM />);

    expect(html).toContain('Busca do pipeline');
    expect(html).not.toContain('Busca global');
  });
});

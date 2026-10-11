// @vitest-environment jsdom
// Resposta do Assistente na tela: Markdown (tabela, imagem, link), rodapé de consultas, nomes técnicos que
// escapem do prompt e o cartão de ação com os valores que vão ser gravados.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Markdown } from '@/components/ui/markdown';
import { camposDaAcao, valorDoCampo } from '@/lib/ia/acao';
import { humanizarTexto } from '@/lib/ia/humanizar';
import fonteHumanizar from '@/lib/ia/humanizar.ts?raw';
import { rodapeDaResposta } from '@/lib/ia/rodape';
import type { AIMessage, AISuggestedAction } from '@/types/ai';
import { AIActionCard } from './AIActionCard';
import { AIMessageBubble } from './AIMessageBubble';

const resposta = (content: string, metadata: AIMessage['metadata'] = null): AIMessage => ({
  id: 'm1', conversation_id: 'c', role: 'assistant', content, metadata, created_at: new Date().toISOString(),
});

describe('nomes técnicos que escapem do prompt', () => {
  it('troca só identificadores exatos; palavra comum em maiúsculas fica como foi cadastrada', () => {
    expect(humanizarTexto('Usei search_clients e o status_funil QUALIFICACAO.')).toBe('Usei busca de clientes e o status Qualificação.');
    expect(humanizarTexto('Categoria COMISSAO_VENDA, contrato LOCACAO_RESIDENCIAL')).toBe('Categoria Comissão de Venda, contrato Locação Residencial');
    expect(humanizarTexto('CASA À VENDA NO CENTRO, OUTROS, my_search_clients_x')).toBe('CASA À VENDA NO CENTRO, OUTROS, my_search_clients_x');
  });

  it('código de contrato que é palavra comum fica; códigos colados um no outro são trocados', () => {
    expect(humanizarTexto('MULTA POR DISTRATO, PROCURACAO')).toBe('MULTA POR DISTRATO, PROCURACAO');
    expect(humanizarTexto('FECHADO_GANHO/QUALIFICACAO e FECHADO_PERDIDO')).toBe('Fechado Ganho/Qualificação e Fechado Perdido');
    // Safari antes do 16.4 não aceita lookbehind: o módulo carrega com o app inteiro e não pode usá-lo.
    expect(fonteHumanizar).not.toContain('(?<');
  });

  it('na bolha: troca no texto e no código inline, nunca no link', () => {
    render(<AIMessageBubble message={resposta('Fonte: `get_funnel_stats`. Veja [FECHADO_GANHO](https://x.com/?s=FECHADO_GANHO).')} />);
    expect(screen.getByText(/Fonte:/).textContent).toContain('Funil de Vendas');
    const link = screen.getByRole('link');
    expect(link.textContent).toBe('FECHADO_GANHO');
    expect(link.getAttribute('href')).toBe('https://x.com/?s=FECHADO_GANHO');
  });
});

describe('Markdown das respostas', () => {
  it('tabela rola de lado num contêiner acessível; imagem externa não carrega; link abre em outra aba', () => {
    const { container } = render(<Markdown>{'| a | b |\n|---|---|\n| 1 | 2 |\n\n![pixel](https://rastreio.example/p.gif)\n\n[OLX](https://olx.com.br/x)'}</Markdown>);
    const regiao = screen.getByRole('region', { name: 'Tabela' });
    expect(regiao.className).toContain('overflow-x-auto');
    expect(regiao.querySelector('table')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('[pixel]');
    const link = screen.getByRole('link', { name: 'OLX' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(container.innerHTML).not.toContain('node=');
  });
});

describe('rodapé da resposta', () => {
  it('"N consultas · X s", singular, sem contagem quando é zero e nada sem os números', () => {
    expect(rodapeDaResposta({ consultas: 3, duracao_ms: 4200 })).toBe('3 consultas · 4,2 s');
    expect(rodapeDaResposta({ consultas: 1, duracao_ms: 900 })).toBe('1 consulta · 0,9 s');
    expect(rodapeDaResposta({ consultas: 0, duracao_ms: 1500 })).toBe('1,5 s');
    expect(rodapeDaResposta({ module: 'clients' })).toBeNull();
    expect(rodapeDaResposta(null)).toBeNull();
  });

  it('a bolha mostra o rodapé; resposta ainda sem texto não vira bolha vazia', () => {
    render(<AIMessageBubble message={resposta('Você tem **3** clientes.', { consultas: 2, duracao_ms: 3000 })} />);
    expect(screen.getByText(/2 consultas · 3 s/)).toBeTruthy();
    const { container } = render(<AIMessageBubble message={resposta('   ')} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('cartão de ação', () => {
  const acao: AISuggestedAction = {
    id: 'p1', action_type: 'update_client_status', status: 'pending', cliente_nome: 'Ana Souza',
    params: { client_id: '11111111-1111-4111-8111-111111111111', status: 'VISITA_PROPOSTA' },
    description: 'Mudar Ana Souza para VISITA_PROPOSTA',
  };

  it('mostra o que vai ser gravado com os rótulos e formatos das telas, sem o ID', () => {
    expect(camposDaAcao(acao)).toEqual([{ rotulo: 'Cliente', valor: 'Ana Souza' }, { rotulo: 'Status', valor: 'Visita/Proposta' }]);
    expect(valorDoCampo('valor', 1500.5)).toMatch(/^R\$\s1\.500,50$/); // Intl usa espaço não separável
    expect(valorDoCampo('data', '2026-10-12')).toBe('12/10/2026');
    expect(valorDoCampo('categoria', 'COMISSAO_VENDA')).toBe('Comissão de Venda');
    expect(valorDoCampo('recorrente', true)).toBe('Sim');
    expect(valorDoCampo('tipo', 'LIGACAO')).toBe('Ligação');
    expect(valorDoCampo('tipo', 'GERAL')).toBe('Aviso');
  });

  it('renderiza o resumo sem código interno e confirma pela ação inteira', () => {
    const confirmar = vi.fn();
    render(<AIActionCard action={acao} onConfirm={confirmar} onReject={vi.fn()} />);
    expect(screen.getByText('Mudar status do cliente')).toBeTruthy();
    expect(screen.getByText('Mudar Ana Souza para Visita/Proposta')).toBeTruthy();
    expect(screen.queryByText(/11111111/)).toBeNull();
    screen.getByRole('button', { name: /Confirmar/ }).click();
    expect(confirmar).toHaveBeenCalledWith(acao);
  });
});

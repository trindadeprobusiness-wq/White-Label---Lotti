import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './AppSidebar';
import { DroppableColumn } from '@/pages/FunilVendas';
import { useDroppable } from '@dnd-kit/core';

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...original,
    useDroppable: vi.fn(() => ({
      setNodeRef: vi.fn(),
      isOver: true,
    })),
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    corretor: { nome: 'Corretor Teste' },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/stores/crmStore', () => ({
  useCRMStore: () => ({ alertas: [] }),
}));

describe('acabamento visual do funil e da sidebar', () => {
  it('destaca a coluna de destino com contorno interno uniforme', () => {
    vi.mocked(useDroppable).mockReturnValue({
      setNodeRef: vi.fn(),
      isOver: true,
    } as unknown as ReturnType<typeof useDroppable>);

    const html = renderToStaticMarkup(
      <DroppableColumn id="DOCUMENTACAO">Conteúdo</DroppableColumn>,
    );

    expect(html).toContain('outline-2');
    expect(html).toContain('-outline-offset-2');
    expect(html).not.toContain('ring-2');
  });

  it('sobe o divisor e preserva a scrollbar nativa', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <AppSidebar />
      </StaticRouter>,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('border-sidebar-border');
    expect(html).toContain('pb-2');
    expect(html).toContain('pt-2');
    expect(html).toContain('overflow-y-auto');
    expect(html).not.toContain('scrollbar-width');
    expect(html).not.toContain('webkit-scrollbar');
  });

  it('mantém todos os itens visíveis e a IA dentro de Sistema', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/assistente">
        <AppSidebar />
      </StaticRouter>,
    );

    expect(html.indexOf('>Sistema<')).toBeLessThan(html.indexOf('Assistente IA'));
    expect(html.indexOf('Assistente IA')).toBeLessThan(html.indexOf('Configurações'));
    expect(html).not.toContain('>Recursos<');
    expect(html).not.toContain('aria-controls="grupo-operacao"');
    expect(html).not.toContain('aria-controls="grupo-gestao"');
    expect(html).not.toContain('aria-controls="grupo-sistema"');
    expect(html).not.toContain('class="hidden"');
  });

  it('agrupa Inbox, Funil de Vendas e Conexão nesta ordem dentro de WhatsApp', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/whatsapp">
        <AppSidebar />
      </StaticRouter>,
    );

    expect(html).toContain('aria-label="Seção WhatsApp"');
    expect(html).toContain('>Conversas<');
    expect(html).toContain('>Funil de Vendas<');
    expect(html).toContain('>Conexão<');
    expect(html.indexOf('>WhatsApp<')).toBeLessThan(html.indexOf('>Conversas<'));
    expect(html.indexOf('>Conversas<')).toBeLessThan(html.indexOf('>Funil de Vendas<'));
    expect(html.indexOf('>Funil de Vendas<')).toBeLessThan(html.indexOf('>Conexão<'));
    // Grupos nascem fechados; só o da rota atual abre. Por isso a ordem se
    // confere contra o título da seção seguinte, não contra um item dela.
    expect(html.indexOf('>Conexão<')).toBeLessThan(html.indexOf('aria-label="Seção Cadastros"'));
  });

  it('marca somente Conexão como ativa na rota de conexão', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/whatsapp/conexao">
        <AppSidebar />
      </StaticRouter>,
    );

    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a(?=[^>]*href="\/whatsapp\/conexao")(?=[^>]*aria-current="page")[^>]*>/);
  });

  it('nomeia a área de agenda como Planejamento, sem mudar o endereço', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/rotina">
        <AppSidebar />
      </StaticRouter>,
    );

    expect(html).toContain('>Planejamento<');
    expect(html).not.toContain('>Rotina<');
    expect(html).toMatch(/<a(?=[^>]*href="\/rotina")(?=[^>]*aria-current="page")[^>]*>/);
  });
});

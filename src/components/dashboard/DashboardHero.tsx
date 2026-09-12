import type { ReactNode } from 'react';

interface DashboardHeroProps {
  saudacao?: string;
  data?: string;
  clientes?: string;
  imoveis?: string;
  leads?: string;
  vendas?: string;
  ferramentas?: ReactNode;
}

/**
 * Barra de ferramentas do topo do dashboard.
 *
 * Mantém a busca global e os controles de privacidade/notificações/ajuda,
 * sem o bloco hero decorativo que foi removido a pedido.
 */
export function DashboardHero({ ferramentas }: DashboardHeroProps) {
  if (!ferramentas) return null;

  return (
    <div className="mb-5">
      {ferramentas}
    </div>
  );
}

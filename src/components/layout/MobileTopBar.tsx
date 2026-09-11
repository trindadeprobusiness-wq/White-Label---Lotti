import { Link } from 'react-router-dom';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { PainelNotificacoes } from '@/components/shell/PainelNotificacoes';
import { PainelAjuda } from '@/components/shell/PainelAjuda';

/**
 * Barra superior fixa do mobile.
 *
 * Substitui o hambúrguer + drawer lateral. Fica visível em qualquer página
 * protegida do app, sempre com o logo e as ações globais (sino + ajuda).
 * O backdrop-blur imita o efeito de vidro translúcido de apps nativos iOS.
 *
 * Visível apenas em mobile (< md). Desktop usa a sidebar.
 */
export function MobileTopBar() {
  return (
    <div
      className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between
                 border-b border-sidebar-border bg-sidebar/95 px-4 backdrop-blur-sm
                 md:hidden"
      role="banner"
    >
      {/* Logo — toca e vai para o Dashboard */}
      <Link to="/" aria-label="Ir para o início" className="rounded focus-ring">
        <LottiLogo variant="full" className="text-xl text-primary" />
      </Link>

      {/* Ações globais compactas */}
      <div className="flex items-center gap-1">
        <PainelNotificacoes />
        <PainelAjuda />
      </div>
    </div>
  );
}

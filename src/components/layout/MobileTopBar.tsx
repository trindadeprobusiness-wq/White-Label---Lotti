import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { PainelNotificacoes } from '@/components/shell/PainelNotificacoes';
import { PainelAjuda } from '@/components/shell/PainelAjuda';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ConteudoDaSidebar } from './AppSidebar';
import { useEffect } from 'react';

/**
 * Barra superior fixa do mobile.
 *
 * O hambúrguer abre o mesmo menu do desktop como gaveta, em vez de uma barra
 * inferior com cinco atalhos e um "Mais". São vinte destinos em seis seções:
 * na barra inferior, quinze deles ficavam atrás do "Mais", e as seções — que
 * são o que dá sentido ao conjunto — desapareciam.
 *
 * Visível apenas em mobile (< md). Desktop usa a sidebar fixa.
 */
export function MobileTopBar() {
  const [menuAberto, setMenuAberto] = useState(false);
  const { pathname } = useLocation();

  // Trocar de página fecha a gaveta: sem isso ela fica aberta sobre o destino.
  useEffect(() => { setMenuAberto(false); }, [pathname]);

  return (
    <>
      <div
        className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2
                   border-b border-sidebar-border bg-sidebar/95 px-3 backdrop-blur-sm
                   md:hidden"
        role="banner"
      >
        <button
          type="button"
          onClick={() => setMenuAberto(true)}
          aria-label="Abrir menu"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg
                     text-foreground transition-colors duration-150
                     hover:bg-sidebar-accent focus-ring"
        >
          <Menu className="h-6 w-6" />
        </button>

        {/* Sem a marca aqui: ela já abre a gaveta, e repetida no topo só
            roubava a faixa que a página usa para se identificar. */}
        <div className="ml-auto flex items-center gap-1">
          <PainelNotificacoes />
          <PainelAjuda />
        </div>
      </div>

      <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
        <SheetContent side="left" className="w-[86vw] max-w-[310px] p-0">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <ConteudoDaSidebar
            recolhida={false}
            emDrawer
            aoNavegar={() => setMenuAberto(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

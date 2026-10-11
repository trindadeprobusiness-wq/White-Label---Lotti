export type RouteLoader = () => Promise<unknown>;

export const dashboardLoader = () => import('@/pages/Dashboard');
export const rotinaLoader = () => import('@/pages/Rotina');
/** /whatsapp/demo (tela de demonstração). A tela de Conversas é a LiveAgentInbox. */
export const whatsappLoader = () => import('@/pages/WhatsAppInbox');
export const conversasLoader = () => import('@/features/whatsapp-inbox/LiveAgentInbox');
export const disparosLoader = () => import('@/features/broadcasts/BroadcastsPage');
export const whatsappConnectionLoader = () => import('@/pages/WhatsAppConnectionPage');
export const clientesLoader = () => import('@/pages/Clientes');
export const imoveisLoader = () => import('@/pages/Imoveis');
export const funilLoader = () => import('@/pages/FunilVendas');
export const juridicoLoader = () => import('@/pages/Juridico');
export const midiasLoader = () => import('@/pages/Midias');
export const financeiroLoader = () => import('@/pages/Financeiro');
export const configuracoesLoader = () => import('@/pages/Configuracoes');
export const alugueisLoader = () => import('@/pages/RentalManagement');
export const assistenteLoader = () => import('@/pages/Assistente');
export const fachadasLoader = () => import('@/pages/FachadasInteligentes');
export const crmLoader = () => import('@/pages/CRM');

export const SIDEBAR_ROUTE_LOADERS: Record<string, RouteLoader> = {
  '/': dashboardLoader,
  '/planejamento': rotinaLoader,
  '/whatsapp/conexao': whatsappConnectionLoader,
  '/whatsapp': conversasLoader,
  '/automacoes': disparosLoader,
  '/clientes': clientesLoader,
  '/imoveis': imoveisLoader,
  '/funil': funilLoader,
  '/crm': crmLoader,
  '/financeiro': financeiroLoader,
  '/juridico': juridicoLoader,
  '/midias': midiasLoader,
  '/configuracoes': configuracoesLoader,
  '/alugueis': alugueisLoader,
  '/assistente': assistenteLoader,
  '/fachadas': fachadasLoader,
};

export async function preloadRoute(
  pathname: string,
  loaders: Record<string, RouteLoader> = SIDEBAR_ROUTE_LOADERS,
): Promise<void> {
  const entry = Object.entries(loaders).find(([route]) =>
    pathname === route || (route !== '/' && pathname.startsWith(`${route}/`)),
  );

  if (entry) await entry[1]();
}

/**
 * Na entrada (F5, link direto, login), a tela começa a baixar junto com a renovação da sessão, em vez de
 * esperar sessão, onboarding e listas. Só a rota exata: /clientes/123 abre outra tela.
 */
export function preloadRotaDeEntrada(
  pathname: string,
  loaders: Record<string, RouteLoader> = SIDEBAR_ROUTE_LOADERS,
): void {
  const rota = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  void loaders[rota]?.().catch(() => undefined);
}

export async function preloadAllSidebarRoutes(): Promise<void> {
  await Promise.allSettled([...new Set(Object.values(SIDEBAR_ROUTE_LOADERS))].map((loader) => loader()));
}

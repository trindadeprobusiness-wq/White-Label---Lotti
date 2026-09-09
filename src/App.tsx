import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { FLAGS } from "@/lib/flags";
import { AuthProvider } from "@/hooks/useAuth";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { DataLoader } from "@/components/DataLoader";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Auth from "@/pages/Auth";
import RecuperarSenha from "@/pages/RecuperarSenha";
import NovaSenha from "@/pages/NovaSenha";
import {
  alugueisLoader,
  assistenteLoader,
  clientesLoader,
  configuracoesLoader,
  crmLoader,
  dashboardLoader,
  fachadasLoader,
  financeiroLoader,
  funilLoader,
  imoveisLoader,
  juridicoLoader,
  midiasLoader,
  rotinaLoader,
  whatsappLoader,
} from "@/lib/routePreloaders";

// Páginas carregadas sob demanda (code-splitting por rota): libs pesadas
// (recharts, pdf-lib, docx, jszip) só baixam quando a página é acessada.
const Dashboard = lazy(dashboardLoader);
const Rotina = lazy(rotinaLoader);
const WhatsAppInbox = lazy(whatsappLoader);
const Clientes = lazy(clientesLoader);
const ClienteDetalhes = lazy(() => import("@/pages/ClienteDetalhes"));
const Imoveis = lazy(imoveisLoader);
const ImovelDetalhes = lazy(() => import("@/pages/ImovelDetalhes"));
const FunilVendas = lazy(funilLoader);
const Juridico = lazy(juridicoLoader);
const Midias = lazy(midiasLoader);
const Financeiro = lazy(financeiroLoader);
const Configuracoes = lazy(configuracoesLoader);
const RentalManagement = lazy(alugueisLoader);
const Assistente = lazy(assistenteLoader);
const FachadasInteligentes = lazy(fachadasLoader);
const FachadaPublica = lazy(() => import("@/pages/FachadaPublica"));
const CRM = lazy(crmLoader);
// Assinatura/Planos. Passou a fazer sentido expor quando as cotas deixaram de
// ser decorativas: o corretor precisa ver quanto da cota de leads já usou e
// para onde ir quando ela acabar.
const PlanoAssinatura = lazy(() =>
  import("@/pages/PlanoAssinatura").then((m) => ({ default: m.PlanoAssinatura })),
);
const NotFound = lazy(() => import("@/pages/NotFound"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));

// Rota pública do link de parceiro: registra o clique no servidor e segue para
// o cadastro. Fica fora do ProtectedRoute porque acontece antes de existir conta.
const RedirectParceiro = lazy(() => import("@/pages/RedirectParceiro"));
const PaginaInicialPublica = lazy(() => import("@/pages/PublicInfo").then((m) => ({ default: m.PaginaInicialPublica })));
const PoliticaPrivacidade = lazy(() => import("@/pages/PublicInfo").then((m) => ({ default: m.PoliticaPrivacidade })));
const TermosUso = lazy(() => import("@/pages/PublicInfo").then((m) => ({ default: m.TermosUso })));

// Back office. Bundle próprio e só baixado por quem tem papel administrativo —
// o corretor comum nunca carrega este código.
const AdminVisaoGeral = lazy(() => import("@/pages/admin/AdminVisaoGeral"));
const AdminUsuarios = lazy(() => import("@/pages/admin/AdminUsuarios"));
const AdminUsuarioDetalhe = lazy(() => import("@/pages/admin/AdminUsuarioDetalhe"));
const AdminOnboarding = lazy(() => import("@/pages/admin/AdminOnboarding"));
const AdminParceiros = lazy(() => import("@/pages/admin/AdminParceiros"));
const AdminParceiroDetalhe = lazy(() => import("@/pages/admin/AdminParceiroDetalhe"));
const AdminComissoes = lazy(() => import("@/pages/admin/AdminComissoes"));
const AdminAssinaturas = lazy(() => import("@/pages/admin/AdminAssinaturas"));
const AdminPagamentos = lazy(() => import("@/pages/admin/AdminPagamentos"));
const AdminCancelamentos = lazy(() => import("@/pages/admin/AdminCancelamentos"));
const AdminRepasses = lazy(() => import("@/pages/admin/AdminRepasses"));
const AdminCampanha = lazy(() => import("@/pages/admin/AdminCampanha"));
const AdminIntegracoes = lazy(() => import("@/pages/admin/AdminIntegracoes"));
const AdminReceita = lazy(() => import("@/pages/admin/AdminReceita"));
const AdminAuditoria = lazy(() => import("@/pages/admin/AdminAuditoria"));
const AdminConfiguracoes = lazy(() => import("@/pages/admin/AdminConfiguracoes"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dados considerados frescos por 60s → evita refetches e requisições
      // duplicadas em remontagens/foco de janela. As mutações continuam
      // invalidando as queries explicitamente, então criar/editar/excluir
      // reflete na hora. Não altera retry nem tratamento de erro.
      staleTime: 60_000,
    },
  },
});

const PageLoader = () => (
  <div className="flex h-screen w-full items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {/* Um único estado de auth para o app inteiro — antes cada consumidor
          criava o seu, com três getSession() e três listeners concorrentes. */}
      <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public route */}
          <Route path="/auth" element={<Auth />} />
          {/* Recuperação de senha — não existia caminho nenhum: quem esquecia
              a senha ficava trancado fora para sempre. */}
          <Route path="/recuperar-senha" element={<RecuperarSenha />} />
          <Route path="/nova-senha" element={<NovaSenha />} />
          <Route path="/sobre" element={<PaginaInicialPublica />} />
          <Route path="/politica-de-privacidade" element={<PoliticaPrivacidade />} />
          <Route path="/termos-de-uso" element={<TermosUso />} />

          {/* Experiência protegida em tela própria: não carrega sidebar nem os
              dados operacionais antes de a pessoa escolher seu caminho. */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />

          {/* Protected routes */}
          <Route element={
            <ProtectedRoute>
              <OnboardingGate>
                <DataLoader>
                  <AppLayout />
                </DataLoader>
              </OnboardingGate>
            </ProtectedRoute>
          }>
            <Route path="/" element={<Dashboard />} />
            <Route path="/rotina" element={<Rotina />} />
            <Route path="/whatsapp" element={<WhatsAppInbox />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/clientes/:id" element={<ClienteDetalhes />} />
            <Route path="/imoveis" element={<Imoveis />} />
            <Route path="/imoveis/:id" element={<ImovelDetalhes />} />
            {/* Com o CRM ligado ele é o dono do pipeline, e /funil vira atalho —
                nenhum link ou favorito antigo quebra. Desligado, o funil clássico
                continua exatamente como sempre foi. */}
            {FLAGS.crm ? (
              <>
                <Route path="/crm" element={<CRM />} />
                <Route path="/funil" element={<Navigate to="/crm" replace />} />
              </>
            ) : (
              <Route path="/funil" element={<FunilVendas />} />
            )}
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/juridico" element={<Juridico />} />
            <Route path="/midias" element={<Midias />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
            <Route path="/plano" element={<PlanoAssinatura />} />
            <Route path="/alugueis" element={<RentalManagement />} />
            <Route path="/assistente" element={<Assistente />} />
            <Route path="/fachadas" element={<FachadasInteligentes />} />
          </Route>



          {/* Back office — exige papel admin/super_admin, não só sessão.
              Fora da árvore ProtectedRoute > DataLoader > AppLayout: o
              DataLoader carrega clientes/imóveis do corretor logado, que aqui
              não servem para nada. O AdminRoute é navegação; a autorização de
              verdade está nas policies e no guard das RPCs. */}
          <Route
            element={
              <AdminRoute>
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route path="/admin" element={<AdminVisaoGeral />} />
            <Route path="/admin/usuarios" element={<AdminUsuarios />} />
            <Route path="/admin/usuarios/:id" element={<AdminUsuarioDetalhe />} />
            <Route path="/admin/onboarding" element={<AdminOnboarding />} />
            <Route path="/admin/parceiros" element={<AdminParceiros />} />
            <Route path="/admin/parceiros/:id" element={<AdminParceiroDetalhe />} />
            <Route path="/admin/assinaturas" element={<AdminAssinaturas />} />
            <Route path="/admin/pagamentos" element={<AdminPagamentos />} />
            <Route path="/admin/cancelamentos" element={<AdminCancelamentos />} />
            <Route path="/admin/comissoes" element={<AdminComissoes />} />
            <Route path="/admin/repasses" element={<AdminRepasses />} />
            <Route path="/admin/campanha" element={<AdminCampanha />} />
            <Route path="/admin/integracoes" element={<AdminIntegracoes />} />
            <Route path="/admin/receita" element={<AdminReceita />} />
            <Route path="/admin/auditoria" element={<AdminAuditoria />} />
          </Route>

          {/* Configurações mexem em como a receita é atribuída e como a
              operação é medida: só super_admin. */}
          <Route
            element={
              <AdminRoute recurso="configuracoes">
                <AdminLayout />
              </AdminRoute>
            }
          >
            <Route path="/admin/configuracoes" element={<AdminConfiguracoes />} />
          </Route>

          {/* Public route — QR Code landing page (no auth required) */}
          <Route path="/p/:fachadaId" element={<FachadaPublica />} />

          {/* Link exclusivo do parceiro */}
          <Route path="/r/:slug" element={<RedirectParceiro />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

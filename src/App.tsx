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
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Auth from "@/pages/Auth";
import RecuperarSenha from "@/pages/RecuperarSenha";
import NovaSenha from "@/pages/NovaSenha";

// Páginas carregadas sob demanda (code-splitting por rota): libs pesadas
// (recharts, pdf-lib, docx, jszip) só baixam quando a página é acessada.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Clientes = lazy(() => import("@/pages/Clientes"));
const ClienteDetalhes = lazy(() => import("@/pages/ClienteDetalhes"));
const Imoveis = lazy(() => import("@/pages/Imoveis"));
const ImovelDetalhes = lazy(() => import("@/pages/ImovelDetalhes"));
const FunilVendas = lazy(() => import("@/pages/FunilVendas"));
const Juridico = lazy(() => import("@/pages/Juridico"));
const Midias = lazy(() => import("@/pages/Midias"));
const Financeiro = lazy(() => import("@/pages/Financeiro"));
const Configuracoes = lazy(() => import("@/pages/Configuracoes"));
const RentalManagement = lazy(() => import("@/pages/RentalManagement"));
const Assistente = lazy(() => import("@/pages/Assistente"));
const FachadasInteligentes = lazy(() => import("@/pages/FachadasInteligentes"));
const FachadaPublica = lazy(() => import("@/pages/FachadaPublica"));
const CRM = lazy(() => import("@/pages/CRM"));
// Assinatura/Planos: código mantido no repositório para o back office futuro,
// mas fora do grafo de rotas — não faz sentido expor ao corretor hoje.
const NotFound = lazy(() => import("@/pages/NotFound"));

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

          {/* Protected routes */}
          <Route element={
            <ProtectedRoute>
              <DataLoader>
                <AppLayout />
              </DataLoader>
            </ProtectedRoute>
          }>
            <Route path="/" element={<Dashboard />} />
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
            <Route path="/alugueis" element={<RentalManagement />} />
            <Route path="/assistente" element={<Assistente />} />
            <Route path="/fachadas" element={<FachadasInteligentes />} />
          </Route>



          {/* Public route — QR Code landing page (no auth required) */}
          <Route path="/p/:fachadaId" element={<FachadaPublica />} />

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

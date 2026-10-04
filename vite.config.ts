/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Caminho do callback OAuth do Google Agenda no domínio da Lotti.
// Precisa ser idêntico ao `source` da reescrita em `vercel.json` e ao
// GOOGLE_CALENDAR_REDIRECT_URI cadastrado no Supabase e no Google Cloud.
const GOOGLE_CALENDAR_CALLBACK = "/google-agenda/callback";
const GOOGLE_CALENDAR_FUNCTION = "/functions/v1/google-calendar-auth/callback";

// Espelha em desenvolvimento a reescrita que a Vercel faz em produção.
// O Google exibe na tela de consentimento o domínio do redirect_uri até
// verificar a marca: apontar o callback direto para *.supabase.co faz o
// usuário ler o identificador do projeto no lugar de "Lotti", e impede a
// verificação (o Google exige domínios comprováveis no Search Console).
function googleCalendarProxy(mode: string) {
  const supabaseUrl = loadEnv(mode, process.cwd(), "").VITE_SUPABASE_URL?.replace(/\/+$/, "");
  if (!supabaseUrl) return undefined;
  return {
    [GOOGLE_CALENDAR_CALLBACK]: {
      target: supabaseUrl,
      changeOrigin: true,
      rewrite: (urlPath: string) => urlPath.replace(GOOGLE_CALENDAR_CALLBACK, GOOGLE_CALENDAR_FUNCTION),
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "127.0.0.1",
    port: 8085,
    proxy: googleCalendarProxy(mode),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Edge Functions usam o specifier pinado do Deno; nos testes Node/Vitest,
      // resolve para a mesma versão instalada e travada no package-lock.
      "npm:zod@3.25.76": "zod",
    },
  },
  build: {
    // NÃO reintroduzir manualChunks aqui. O agrupamento manual quebrou a ordem
    // de inicialização entre chunks em produção, causando
    //   "Uncaught ReferenceError: Cannot access 'X' before initialization"
    // → tela branca. A divisão padrão do Vite/Rollup é ordenada corretamente.
    // Para reduzir o bundle no futuro, use React.lazy() por rota (code-splitting
    // baseado em import dinâmico), que não tem esse problema de ordem.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    // api/ é um serviço Node à parte, testado com Jest dentro da própria pasta.
    exclude: [...configDefaults.exclude, "api/**"],
  },
}));

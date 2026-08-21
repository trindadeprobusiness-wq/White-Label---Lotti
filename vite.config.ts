import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8085,
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
}));

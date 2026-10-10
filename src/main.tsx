import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "./components/theme-provider";
import { recarregarParaVersaoNova } from "./lib/recarregar-versao";
import { vigiarVersaoNova } from "./lib/versao-nova";

// Quando um novo deploy troca os chunks e o usuário está com a aba antiga aberta,
// carregar uma tela sob demanda pode falhar ("Failed to fetch dynamically imported
// module"). O Vite dispara `vite:preloadError` nesse caso: recarregamos para pegar a
// versão nova. Com o preventDefault o import resolve undefined e o lazy() quebra
// ("Element type is invalid"); o ErrorBoundary vê estaRecarregando() e mostra
// "Atualizando…" em vez da tela de erro até o reload terminar.
window.addEventListener("vite:preloadError", (event) => {
  if (recarregarParaVersaoNova()) event.preventDefault();
});

// Versão nova publicada: recarrega com a aba em segundo plano, não ao trocar de tela.
if (import.meta.env.PROD) vigiarVersaoNova();

// Errar a área de upload por alguns pixels fazia o navegador abrir o arquivo solto
// e sair do app — com o formulário preenchido junto. As áreas de upload chamam
// stopPropagation, então só chega aqui o que caiu fora delas.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);

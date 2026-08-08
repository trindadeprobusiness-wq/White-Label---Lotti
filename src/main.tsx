import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "./components/theme-provider";

// Quando um novo deploy troca os chunks e o usuário está com a aba antiga aberta,
// carregar uma tela sob demanda pode falhar ("Failed to fetch dynamically imported
// module"). O Vite dispara `vite:preloadError` nesse caso — recarregamos UMA vez
// (janela de 10s) para pegar a versão nova de forma transparente, sem tela de erro.
// O guard por tempo evita loop caso o chunk esteja de fato indisponível.
window.addEventListener("vite:preloadError", () => {
  const last = Number(sessionStorage.getItem("vite-preload-reload-at") || 0);
  if (Date.now() - last > 10000) {
    sessionStorage.setItem("vite-preload-reload-at", String(Date.now()));
    window.location.reload();
  }
});

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

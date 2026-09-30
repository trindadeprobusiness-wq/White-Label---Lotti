/**
 * O botão flutuante da IA some onde ele atrapalha ou se repete: nas telas do
 * próprio assistente, no atendimento do WhatsApp e na tela inicial, que já é
 * uma lista do que fazer agora e não precisa de um balão por cima dela.
 */
export function shouldShowAIChatWidget(pathname: string): boolean {
  if (pathname === '/') return false;
  return !pathname.startsWith('/assistente') && !pathname.startsWith('/whatsapp');
}

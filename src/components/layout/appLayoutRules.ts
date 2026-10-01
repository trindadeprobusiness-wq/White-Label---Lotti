/**
 * O botão flutuante da IA some onde ele atrapalha ou se repete: nas telas do
 * próprio assistente, no atendimento do WhatsApp, na tela inicial — que já é
 * uma lista do que fazer agora — e no funil, onde o quadro vai até a borda de
 * baixo e o balão fica por cima da última coluna.
 */
export function shouldShowAIChatWidget(pathname: string): boolean {
  if (pathname === '/') return false;
  return !['/assistente', '/whatsapp', '/crm', '/funil']
    .some((rota) => pathname.startsWith(rota));
}

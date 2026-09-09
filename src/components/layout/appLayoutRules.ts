export function shouldShowAIChatWidget(pathname: string): boolean {
  return !pathname.startsWith('/assistente') && !pathname.startsWith('/whatsapp');
}

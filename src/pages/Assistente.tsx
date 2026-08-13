import { useState, useRef, useEffect } from 'react';
import { Send, RotateCcw, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAIChat } from '@/hooks/useAIChat';
import { AIMessageBubble } from '@/components/ai/AIMessageBubble';
import { AITypingIndicator } from '@/components/ai/AITypingIndicator';
import { AIActionCard } from '@/components/ai/AIActionCard';
import { AIFileUpload } from '@/components/ai/AIFileUpload';
import type { AIFileUploadHandle } from '@/components/ai/AIFileUpload';
import { AIConversationList } from '@/components/ai/AIConversationList';
import { useFileDrop } from '@/hooks/useFileDrop';
import { AI_ACCEPTED_TYPES } from '@/types/ai';

export default function Assistente() {
  const [inputText, setInputText] = useState('');
  const [fileContext, setFileContext] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    conversations,
    activeConversation,
    isStreaming,
    error,
    sendMessage,
    uploadFile,
    startConversation,
    loadConversation,
    loadConversations,
    togglePin,
    deleteConversation,
    confirmAction,
    rejectAction,
    retry,
    pendingActions,
  } = useAIChat();

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text && !fileContext) return;
    setInputText('');
    const ctx = fileContext;
    setFileContext(null);
    await sendMessage(text || 'Analise o arquivo enviado', ctx || undefined);
  };

  const handleFileProcessed = (result: { extracted_text: string; file_name: string }) => {
    setFileContext(
      `Arquivo: ${result.file_name}\n\nConteúdo extraído:\n${result.extracted_text}`,
    );
  };

  const welcomeMessage = {
    id: 'welcome',
    conversation_id: '',
    role: 'assistant' as const,
    content:
      'Olá! Sou o assistente IA da Lotti. Posso ajudar com:\n\n- **Consultar clientes** e seus históricos\n- **Buscar imóveis** por tipo, cidade, preço\n- **Analisar finanças** — receitas, despesas, resumos\n- **Verificar contratos** e prazos\n- **Processar documentos** — envie PDFs, planilhas ou imagens\n- **Sugerir ações** — criar clientes, agendar follow-ups\n\nComo posso ajudar?',
    created_at: new Date().toISOString(),
  };

  const displayMessages = messages.length > 0 ? messages : [welcomeMessage];

  const fileUploadRef = useRef<AIFileUploadHandle>(null);
  const { dragActive: chatDragActive, dropProps: chatDropProps } = useFileDrop(
    (arquivos) => fileUploadRef.current?.selecionarArquivo(arquivos[0]),
    { accept: AI_ACCEPTED_TYPES.join(','), disabled: isStreaming },
  );

  return (
    // Full-bleed dentro do AppLayout: os negative margins anulam o padding
    // do <main> para o assistente ocupar toda a área do canvas.
    <div className="flex h-[calc(100vh-4rem)] -my-8 -mx-4 md:-mx-8 rounded-none overflow-hidden bg-background">
      {/* Coluna de conversas */}
      <aside className="w-[300px] shrink-0 border-r border-border hidden md:flex flex-col overflow-hidden">
        <AIConversationList
          conversations={conversations}
          activeId={activeConversation}
          onSelect={loadConversation}
          onNew={startConversation}
          onLoad={loadConversations}
          onTogglePin={togglePin}
          onDelete={deleteConversation}
        />
      </aside>

      {/* Área principal do chat */}
      <section
        className="flex-1 flex flex-col min-w-0 relative bg-background"
        {...chatDropProps}
      >
        {chatDragActive && (
          <div className="absolute inset-3 z-20 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-xl pointer-events-none">
            <p className="text-sm font-medium text-primary bg-background/90 px-4 py-2 rounded-lg shadow-sm">
              Solte o arquivo aqui
            </p>
          </div>
        )}

        {/* Header do chat — respiro maior, tipografia mais legível */}
        <header className="border-b border-border px-6 py-4 flex items-center gap-3 bg-background">
          <div className="bg-accent p-2 rounded-full">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground leading-tight">
              Assistente IA
            </h1>
            <p className="text-xs text-muted-foreground">
              Integrado ao seu CRM · Gemini 2.5 Flash
            </p>
          </div>
        </header>

        {/* Mensagens */}
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
            {displayMessages.map((msg) => (
              <AIMessageBubble key={msg.id} message={msg} />
            ))}
            {pendingActions.map((action) => (
              <AIActionCard
                key={action.id}
                action={action}
                onConfirm={confirmAction}
                onReject={rejectAction}
              />
            ))}
            {isStreaming && <AITypingIndicator />}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg max-w-md">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{error}</span>
                <Button size="sm" variant="ghost" onClick={retry}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Tentar
                </Button>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>

        {/* Composer */}
        <div className="border-t border-border px-6 py-4 bg-background">
          <div className="max-w-3xl mx-auto space-y-2">
            {fileContext && (
              <div className="text-xs bg-accent border border-primary/20 p-2 rounded-lg flex items-center justify-between">
                <span className="truncate text-accent-foreground">
                  📎 Arquivo pronto para análise
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  onClick={() => setFileContext(null)}
                  aria-label="Remover arquivo"
                >
                  ×
                </Button>
              </div>
            )}
            <form
              className="flex items-center gap-2 rounded-xl border border-border bg-background focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 transition px-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <AIFileUpload
                ref={fileUploadRef}
                onFileProcessed={handleFileProcessed}
                uploadFile={uploadFile}
                disabled={isStreaming}
              />
              <Input
                placeholder="Pergunte algo ou envie um arquivo…"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 h-11 bg-transparent"
                disabled={isStreaming}
                autoFocus
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-lg"
                disabled={(!inputText.trim() && !fileContext) || isStreaming}
                aria-label="Enviar mensagem"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground text-center">
              Enter envia · Shift+Enter quebra linha · Arraste arquivos pra qualquer canto
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

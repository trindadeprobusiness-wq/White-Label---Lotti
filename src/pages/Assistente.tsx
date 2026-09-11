import { useState, useRef, useEffect } from 'react';
import {
  Send, RotateCcw, AlertCircle, Sparkles, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
import { EstadoInicialIA } from '@/components/ai/EstadoInicialIA';
import { useCRMStore } from '@/stores/crmStore';


export default function Assistente() {
  const [inputText, setInputText] = useState('');
  const [fileContext, setFileContext] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { corretor } = useCRMStore();

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
    // O AppLayout não aplica padding nesta rota; o chat ocupa a altura disponível.
    <div className="flex h-[calc(100dvh-4.5rem)] m-2 md:m-5 md:h-[calc(100dvh-2.5rem)] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
      {/* Coluna de conversas */}
      <aside className="w-[260px] xl:w-[280px] shrink-0 border-r border-border/70 hidden md:flex flex-col overflow-hidden bg-muted/20">
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
        className="flex-1 flex flex-col min-h-0 min-w-0 relative bg-background"
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
        <header className="flex items-center gap-3 border-b border-border bg-background px-6 py-4">
          <div className="rounded-lg bg-surface-brand p-2">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight text-foreground">
              {messages.length ? 'Análise em andamento' : 'Nova análise'}
            </h1>
            {/* "Conectado aos dados da Lotti" e não o nome do modelo: o que
                importa ao corretor é que a IA enxerga os dados dele, não qual
                LLM está por trás. */}
            <p className="mt-1 text-xs text-muted-foreground">Explore os dados da sua operação imobiliária</p>
          </div>

          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            Disponível
          </span>

          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={startConversation}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Limpar conversa</span>
            </Button>
          )}
        </header>

        {/* Mensagens */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="max-w-4xl mx-auto px-5 py-3 space-y-4">
            {messages.length === 0 ? (
              <EstadoInicialIA
                nome={corretor?.nome}
                onSugestao={(texto) => { setInputText(texto); }}
              />
            ) : (
              messages.map((msg) => <AIMessageBubble key={msg.id} message={msg} />)
            )}
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
        <div className="shrink-0 border-t border-border px-5 py-2.5 bg-background">
          <div className="max-w-4xl mx-auto space-y-2">
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
              className="flex items-center gap-2 rounded-xl border border-border bg-background focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition p-2"
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
              <Textarea
                placeholder="Pergunte sobre imóveis, clientes, contratos ou financeiro…"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="min-h-9 max-h-32 flex-1 resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent text-sm"
                rows={1}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!isStreaming) void handleSend(); } }}
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
            <p className="text-center text-[11px] text-muted-foreground">
              Enter envia · Shift+Enter quebra linha
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}

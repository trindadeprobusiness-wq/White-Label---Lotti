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
import { AIConversationList } from '@/components/ai/AIConversationList';

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
      `Arquivo: ${result.file_name}\n\nConteúdo extraído:\n${result.extracted_text}`
    );
  };

  const welcomeMessage = {
    id: 'welcome',
    conversation_id: '',
    role: 'assistant' as const,
    content:
      'Olá! Sou o assistente IA do CRM Oliver. Posso ajudar com:\n\n- **Consultar clientes** e seus históricos\n- **Buscar imóveis** por tipo, cidade, preço\n- **Analisar finanças** — receitas, despesas, resumos\n- **Verificar contratos** e prazos\n- **Processar documentos** — envie PDFs, planilhas ou imagens\n- **Sugerir ações** — criar clientes, agendar follow-ups\n\nComo posso ajudar?',
    created_at: new Date().toISOString(),
  };

  const displayMessages = messages.length > 0 ? messages : [welcomeMessage];

  return (
    <div className="flex h-[calc(100vh-3rem)] -my-6 -mx-4 md:-mx-6 lg:-mx-8">
      {/* Sidebar */}
      <div className="w-72 border-r bg-background hidden md:block">
        <AIConversationList
          conversations={conversations}
          activeId={activeConversation}
          onSelect={loadConversation}
          onNew={startConversation}
          onLoad={loadConversations}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b px-4 py-3 flex items-center gap-2 bg-background/80 backdrop-blur">
          <div className="bg-primary/10 p-1.5 rounded-full">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">IA Assistant</h1>
            <p className="text-[10px] text-muted-foreground">
              Powered by Grok &middot; grok-4.20-reasoning
            </p>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto p-4 space-y-4">
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

        {/* Input */}
        <div className="border-t p-3 bg-background">
          <div className="max-w-3xl mx-auto space-y-2">
            {fileContext && (
              <div className="text-xs bg-primary/5 border border-primary/20 p-2 rounded-lg flex items-center justify-between">
                <span className="truncate">📎 Arquivo pronto para análise</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5"
                  onClick={() => setFileContext(null)}
                >
                  ×
                </Button>
              </div>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
            >
              <AIFileUpload
                onFileProcessed={handleFileProcessed}
                uploadFile={uploadFile}
                disabled={isStreaming}
              />
              <Input
                placeholder="Pergunte algo ou envie um arquivo..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1"
                disabled={isStreaming}
                autoFocus
              />
              <Button
                type="submit"
                size="icon"
                disabled={(!inputText.trim() && !fileContext) || isStreaming}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Sparkles, Minimize2, Maximize2, RotateCcw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAIChat } from '@/hooks/useAIChat';
import { AIMessageBubble } from './AIMessageBubble';
import { AITypingIndicator } from './AITypingIndicator';
import { AIActionCard } from './AIActionCard';
import { AIFileUpload } from './AIFileUpload';
import { useNavigate } from 'react-router-dom';

export function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [fileContext, setFileContext] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    uploadFile,
    startConversation,
    confirmAction,
    rejectAction,
    retry,
    pendingActions,
  } = useAIChat();

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, isOpen]);

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
      'Olá! Sou o assistente IA do CRM Oliver. Posso consultar seus dados de clientes, imóveis, contratos e finanças. Pergunte qualquer coisa ou envie um arquivo para análise!',
    created_at: new Date().toISOString(),
  };

  const displayMessages = messages.length > 0 ? messages : [welcomeMessage];

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end space-y-3">
      {isOpen && (
        <Card className="w-[min(400px,calc(100vw-2rem))] h-[min(620px,calc(100dvh-6rem))] flex flex-col shadow-2xl border-primary/20 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <CardHeader className="bg-primary/5 p-3 flex flex-row items-center justify-between space-y-0 rounded-t-lg">
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 p-1.5 rounded-full">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold text-primary">
                  IA Assistant
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">Powered by Grok</p>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setIsOpen(false);
                  navigate('/assistente');
                }}
                title="Expandir"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsOpen(false)}
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 p-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-3">
                {displayMessages.map((msg) => (
                  <AIMessageBubble key={msg.id} message={msg} />
                ))}
                {pendingActions
                  .filter((a) => a.status === 'pending')
                  .map((action) => (
                    <AIActionCard
                      key={action.id}
                      action={action}
                      onConfirm={confirmAction}
                      onReject={rejectAction}
                    />
                  ))}
                {isStreaming && <AITypingIndicator />}
                {error && (
                  <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded-lg">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1">{error}</span>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={retry}>
                      <RotateCcw className="h-3 w-3 mr-1" /> Tentar
                    </Button>
                  </div>
                )}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>
          </CardContent>

          <CardFooter className="p-2.5 border-t flex-col gap-2 bg-background">
            {fileContext && (
              <div className="w-full text-xs bg-primary/5 border border-primary/20 p-2 rounded-lg flex items-center justify-between">
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
              className="flex w-full items-center gap-2"
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
                placeholder="Pergunte algo..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 h-9"
                disabled={isStreaming}
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={(!inputText.trim() && !fileContext) || isStreaming}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardFooter>
        </Card>
      )}

      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          size="lg"
          aria-label="Abrir assistente IA"
          className="relative h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90 transition-all hover:scale-110"
        >
          <Bot className="h-7 w-7" />
          {/* Indicador sutil de IA disponível */}
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-gold" />
          </span>
        </Button>
      )}
    </div>
  );
}

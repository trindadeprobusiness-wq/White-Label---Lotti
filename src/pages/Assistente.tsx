import { useState, useRef, useEffect } from 'react';
import {
  Send, RotateCcw, AlertCircle, Sparkles, Trash2, ChevronRight, ShieldCheck,
  ExternalLink, Users, Building2, TrendingUp, FileText,
} from 'lucide-react';
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
import { EstadoInicialIA } from '@/components/ai/EstadoInicialIA';
import { useCRMStore } from '@/stores/crmStore';

/** Atalhos do painel direito — cada um preenche o campo com a pergunta pronta. */
const CAPACIDADES = [
  { Icone: Users, titulo: 'Consultar clientes e históricos',
    prompt: 'Mostre um resumo dos meus clientes e do histórico de contato de cada um.' },
  { Icone: Building2, titulo: 'Encontrar imóveis',
    prompt: 'Quais imóveis eu tenho disponíveis no momento?' },
  { Icone: TrendingUp, titulo: 'Analisar receitas e despesas',
    prompt: 'Analise minhas receitas e despesas e aponte o que mais pesa no resultado.' },
  { Icone: FileText, titulo: 'Organizar contratos e documentos',
    prompt: 'Quais contratos e documentos precisam de atenção por prazo ou pendência?' },
] as const;

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
        <header className="flex items-center gap-3 border-b border-border bg-background px-6 py-4">
          <div className="rounded-lg bg-surface-brand p-2">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight text-foreground">
              Assistente IA
            </h1>
            {/* "Conectado aos dados da Lotti" e não o nome do modelo: o que
                importa ao corretor é que a IA enxerga os dados dele, não qual
                LLM está por trás. */}
            <p className="text-xs text-muted-foreground">Conectado aos dados da Lotti</p>
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
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
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
            <p className="text-center text-[11px] text-muted-foreground">
              Enter envia · Shift+Enter quebra linha
            </p>
          </div>
        </div>
      </section>

      {/* Painel de contexto. Só a partir de xl: abaixo disso ele roubaria
          largura do chat, que é onde o trabalho acontece. */}
      <aside className="hidden w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4 xl:flex">
        <div>
          <h2 className="mb-2 px-1 text-sm font-medium text-foreground">
            A IA pode ajudar com
          </h2>
          <div className="space-y-0.5">
            {CAPACIDADES.map((c) => (
              <button
                key={c.titulo}
                type="button"
                onClick={() => setInputText(c.prompt)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors duration-150 hover:bg-muted focus-ring"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-primary">
                  <c.Icone className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">
                  {c.titulo}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>

        {/* O corretor precisa saber que a IA não age sozinha — é o que separa
            "assistente" de "coisa que mexe nos meus dados". */}
        <div className="rounded-card border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-warning" />
            <p className="text-sm font-medium text-foreground">Você está no controle</p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Ações que alteram dados exigem sua confirmação.
          </p>
          <a
            href="https://supabase.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline focus-ring rounded"
          >
            Como a IA usa seus dados
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <p className="mt-auto text-xs leading-relaxed text-muted-foreground">
          As respostas da IA não substituem orientação profissional. Confira as
          informações antes de tomar decisões.
        </p>
      </aside>
    </div>
  );
}

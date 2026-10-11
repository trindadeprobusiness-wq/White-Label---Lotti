import { FormEvent, useEffect, useState } from 'react';
import { Bot, Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Markdown } from '@/components/ui/markdown';
import { useAIChat } from '@/hooks/useAIChat';
import { responderAjudaOnboarding } from '@/lib/onboarding/contexto';
import type { PersonaOnboarding } from '@/lib/onboarding/regras';

interface Props {
  persona: PersonaOnboarding | null;
  etapa: string;
  onAction?: (tipo: string, destino?: string) => void;
}

const SUGESTOES = [
  'Tenho clientes em uma planilha',
  'Como cadastro um imóvel?',
  'Crie um follow-up para amanhã',
];

export function OnboardingAssistant({ persona, etapa, onAction }: Props) {
  const [pergunta, setPergunta] = useState('');
  const [resposta, setResposta] = useState('Posso explicar esta etapa e preparar seu próximo passo.');
  const ia = useAIChat();

  useEffect(() => {
    const ultima = [...ia.messages].reverse().find((message) => message.role === 'assistant' && message.content.trim());
    if (ultima) setResposta(ultima.content);
  }, [ia.messages]);

  const enviar = (texto: string) => {
    const resultado = responderAjudaOnboarding(texto, { persona, etapa });
    setResposta(resultado.texto);
    if (resultado.acao) {
      // Ações no onboarding são somente navegação/pré-preenchimento local.
      // Nenhum cadastro é confirmado por IA.
      onAction?.(resultado.acao.tipo, resultado.acao.destino);
    } else {
      // Modo onboarding da API: orienta em texto curto, sem consultar nem propor ações.
      void ia.sendMessage(texto, `Persona: ${persona ?? 'não informada'}. Etapa atual: ${etapa}.`, { intent: 'onboarding.help' });
    }
    setPergunta('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pergunta.trim()) enviar(pergunta.trim());
  };

  return (
    <aside className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4" aria-labelledby="onboarding-assistant-title">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Bot className="h-4 w-4" /></span>
        <div>
          <h2 id="onboarding-assistant-title" className="text-sm font-semibold">Assistente IA de configuração</h2>
          <p className="text-xs text-muted-foreground">Contexto da etapa atual</p>
        </div>
      </div>
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-card p-3 text-sm leading-6 shadow-sm" aria-live="polite">
        {ia.isStreaming
          ? <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
          : <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
        <Markdown className="min-w-0 flex-1">{resposta}</Markdown>
      </div>
      {ia.error && <p className="mb-3 text-xs text-muted-foreground">A IA está indisponível; a orientação segura desta etapa continua ativa.</p>}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SUGESTOES.map((sugestao) => (
          <button key={sugestao} type="button" onClick={() => enviar(sugestao)} className="rounded-full border bg-card px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {sugestao}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <Input value={pergunta} onChange={(event) => setPergunta(event.target.value)} placeholder="Pergunte sobre esta etapa" aria-label="Pergunta para a assistente" className="bg-card" />
        <Button type="submit" size="icon" aria-label="Enviar pergunta" disabled={!pergunta.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </aside>
  );
}

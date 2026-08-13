import { useMemo, useRef, useState } from 'react';
import {
  DndContext, DragEndEvent, MouseSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { Building2, CalendarClock, Loader2, MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { agruparPorEtapa } from '@/lib/crm/pipeline';
import { useEtapas, useOportunidades, useMoverOportunidade, useModoCrm } from '@/hooks/crm/useCrm';
import type { CrmOportunidade, ColunaPipeline } from '@/lib/crm/tipos';
import { WhatsAppDialog } from './WhatsAppDialog';
import FunilVendas from '@/pages/FunilVendas';

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const CORES: Record<string, { dot: string; line: string; text: string }> = {
  slate: { dot: 'bg-slate-500', line: 'bg-slate-500', text: 'text-slate-600' },
  sky: { dot: 'bg-sky-500', line: 'bg-sky-500', text: 'text-sky-600' },
  blue: { dot: 'bg-blue-500', line: 'bg-blue-500', text: 'text-blue-600' },
  indigo: { dot: 'bg-indigo-500', line: 'bg-indigo-500', text: 'text-indigo-600' },
  amber: { dot: 'bg-amber-500', line: 'bg-amber-500', text: 'text-amber-600' },
  orange: { dot: 'bg-orange-500', line: 'bg-orange-500', text: 'text-orange-600' },
  violet: { dot: 'bg-violet-500', line: 'bg-violet-500', text: 'text-violet-600' },
  green: { dot: 'bg-emerald-500', line: 'bg-emerald-500', text: 'text-emerald-600' },
  red: { dot: 'bg-red-500', line: 'bg-red-500', text: 'text-red-600' },
};

const atrasada = (o: CrmOportunidade) =>
  !!o.data_prevista_fechamento && !o.fechada_em &&
  new Date(o.data_prevista_fechamento) < new Date();

type CardOportunidade = CrmOportunidade & { clientes?: { nome?: string; telefone?: string }; imoveis?: { titulo?: string } };

function Card({ oportunidade, onWhatsApp }: { oportunidade: CardOportunidade; onWhatsApp: (o: CardOportunidade) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: oportunidade.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        'rounded-lg border border-border bg-card p-3 space-y-1.5 cursor-grab active:cursor-grabbing shadow-sm transition-colors',
        isDragging ? 'opacity-50 shadow-lg z-50' : 'hover:border-primary/40',
      )}
    >
      <p className="text-sm font-medium leading-tight">{oportunidade.titulo}</p>
      {oportunidade.clientes?.nome && (
        <p className="text-xs text-muted-foreground truncate">{oportunidade.clientes.nome}</p>
      )}
      {oportunidade.imoveis?.titulo && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
          <Building2 className="h-3 w-3 shrink-0" /> {oportunidade.imoveis.titulo}
        </p>
      )}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-sm font-semibold">{moeda(Number(oportunidade.valor_estimado) || 0)}</span>
        <div className="flex items-center gap-1">
          {atrasada(oportunidade) && (
            <Badge variant="secondary" className="bg-red-500/10 text-red-600 dark:text-red-400 gap-1 text-[10px]">
              <CalendarClock className="h-3 w-3" /> Atrasada
            </Badge>
          )}
          {/* onPointerDown para o dnd-kit não engolir o clique no botão. */}
          <button
            type="button"
            title="Falar no WhatsApp"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onWhatsApp(oportunidade); }}
            className="p-1 rounded text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Coluna({ coluna, onWhatsApp }: { coluna: ColunaPipeline; onWhatsApp: (o: CardOportunidade) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.etapa.id });

  const cor = CORES[coluna.etapa.cor] ?? CORES.slate;
  return (
    <div className="min-w-[260px] flex-1 rounded-xl border border-border bg-secondary/60 flex flex-col min-h-[500px] overflow-hidden">
      <div className="px-3 pt-3 pb-2 bg-card">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center min-w-0 gap-2">
            <span className={cn('h-2 w-2 rounded-full shrink-0', cor.dot)} />
            <span className={cn('text-sm font-semibold truncate', cor.text)}>{coluna.etapa.nome}</span>
          </div>
          <Badge variant="secondary" className="h-5 min-w-[2rem] justify-center rounded-full px-2 text-[10px] font-semibold">{coluna.oportunidades.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{moeda(coluna.total)}</p>
      </div>
      <div className={cn('h-0.5 w-full opacity-70', cor.line)} />
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 min-h-0 overflow-y-auto p-3 space-y-2 transition',
          isOver && 'ring-2 ring-primary/50 bg-primary/[0.02]',
        )}
      >
        {coluna.oportunidades.map((o) => <Card key={o.id} oportunidade={o} onWhatsApp={onWhatsApp} />)}
        {coluna.oportunidades.length === 0 && (
          <p className="text-xs italic text-muted-foreground text-center py-10">Vazio. Arraste cards pra cá.</p>
        )}
      </div>
    </div>
  );
}

export function CrmPipeline() {
  const { data: modo } = useModoCrm();
  const { data: etapas, isLoading: carregandoEtapas } = useEtapas();
  const { data: oportunidades, isLoading: carregandoOps } = useOportunidades();
  const mover = useMoverOportunidade();
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [conversa, setConversa] = useState<CardOportunidade | null>(null);

  // Mesmo tratamento do funil atual: sem estas duas coisas o Kanban parece
  // funcionar e falha no uso real — o clique pós-drop dispara navegação, e sem
  // constraint o card "gruda" no dedo impedindo scroll no celular.
  const arrastou = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const colunas = useMemo(
    () => agruparPorEtapa(etapas ?? [], oportunidades ?? []),
    [etapas, oportunidades],
  );

  const aoSoltar = (evento: DragEndEvent) => {
    setArrastando(null);
    arrastou.current = true;
    const { active, over } = evento;
    if (!over) return;

    const alvo = (oportunidades ?? []).find((o) => o.id === String(active.id));
    const etapaDestino = String(over.id);
    if (!alvo || alvo.etapa_id === etapaDestino) return;

    const destino = colunas.find((c) => c.etapa.id === etapaDestino);
    mover.mutate({
      id: alvo.id,
      etapaId: etapaDestino,
      ordem: destino?.oportunidades.length ?? 0,
      updatedAt: alvo.updated_at, // token de concorrência
    });
  };

  if (carregandoEtapas || carregandoOps) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 min-h-[500px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="flex-shrink-0 w-[280px] h-[480px] rounded-lg" />
        ))}
      </div>
    );
  }

  // Enquanto as tabelas crm_* ainda não foram aplicadas, o pipeline usa o
  // Funil completo que já existia no app. Assim preservamos toda a UX criada
  // (busca, filtros, seleção em lote e gerenciamento de etapas), enquanto as
  // abas Leads/Tarefas/Painel continuam disponíveis no CRM.
  if (modo === 'legado') {
    return <FunilVendas embedded />;
  }

  return (
    <div className="space-y-3">
      {/* Honestidade sobre o que está rodando: no modo legado o card É o cliente,
          então não há valor por negócio nem dois negócios para a mesma pessoa. */}
      {mover.isPending && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
        </p>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => { arrastou.current = false; setArrastando(String(e.active.id)); }}
        onDragEnd={aoSoltar}
        onDragCancel={() => setArrastando(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-2 min-h-[500px]">
          {colunas.map((c) => <Coluna key={c.etapa.id} coluna={c} onWhatsApp={setConversa} />)}
        </div>
      </DndContext>
      {arrastando && <span className="sr-only">Movendo negócio</span>}

      <WhatsAppDialog
        open={!!conversa}
        onOpenChange={(o) => !o && setConversa(null)}
        contato={conversa?.cliente_id ? {
          id: conversa.cliente_id,
          nome: conversa.clientes?.nome ?? conversa.titulo,
          telefone: conversa.clientes?.telefone,
        } : null}
      />
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import {
  DndContext, DragEndEvent, MouseSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { Building2, CalendarClock, Loader2, AlertTriangle, MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { agruparPorEtapa } from '@/lib/crm/pipeline';
import { useEtapas, useOportunidades, useMoverOportunidade, useModoCrm } from '@/hooks/crm/useCrm';
import type { CrmOportunidade, ColunaPipeline } from '@/lib/crm/tipos';
import { WhatsAppDialog } from './WhatsAppDialog';

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const CORES: Record<string, string> = {
  slate: 'bg-muted', sky: 'bg-sky-500/10', blue: 'bg-blue-500/10',
  indigo: 'bg-indigo-500/10', amber: 'bg-amber-500/10', orange: 'bg-orange-500/10',
  violet: 'bg-violet-500/10', green: 'bg-emerald-500/10', red: 'bg-red-500/10',
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
        'rounded-lg border bg-card p-3 space-y-1.5 cursor-grab active:cursor-grabbing transition',
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

  return (
    <div className="flex-shrink-0 w-[280px]">
      <div className={cn('rounded-t-lg px-3 py-2', CORES[coluna.etapa.cor] ?? 'bg-muted')}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{coluna.etapa.nome}</span>
          <Badge variant="secondary" className="text-[10px]">{coluna.oportunidades.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{moeda(coluna.total)}</p>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'rounded-b-lg border border-t-0 p-2 space-y-2 min-h-[420px] transition',
          isOver && 'ring-2 ring-primary/50 bg-primary/[0.02]',
        )}
      >
        {coluna.oportunidades.map((o) => <Card key={o.id} oportunidade={o} onWhatsApp={onWhatsApp} />)}
        {coluna.oportunidades.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">Arraste um negócio para cá</p>
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
      <div className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="flex-shrink-0 w-[280px] h-[480px] rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Honestidade sobre o que está rodando: no modo legado o card É o cliente,
          então não há valor por negócio nem dois negócios para a mesma pessoa. */}
      {modo === 'legado' && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-muted-foreground">
            <span className="font-medium text-amber-600 dark:text-amber-400">Modo simplificado.</span>{' '}
            Cada card é um cliente e arrastar grava a etapa dele, como no funil de sempre.
            Aplicando a migration <code className="text-[11px]">crm-module.sql</code>, cada cliente
            passa a poder ter vários negócios, com valor, probabilidade e motivo de perda.
          </p>
        </div>
      )}
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
        <div className="flex gap-3 overflow-x-auto pb-2">
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

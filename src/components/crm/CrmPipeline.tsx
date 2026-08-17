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
import { moeda as moedaBR } from '@/lib/formato';

/** Sem centavos no Kanban: o valor é referência de negócio, não extrato. */
const moeda = (v: number) => moedaBR(v, true);


/**
 * Cor da etapa → token do tema.
 *
 * Antes eram cores cruas do Tailwind (`sky-500`, `violet-500`, `amber-500`),
 * que não acompanham o tema e destoavam da identidade. O mapa leva cada cor
 * cadastrada em `crm_etapas.cor` para os tokens do funil, então mudar a
 * paleta num lugar reflete no Kanban inteiro.
 *
 * `ponto` é a bolinha do cabeçalho — o status não pode depender só de cor, e o
 * nome da etapa fica sempre ao lado.
 */
const CORES: Record<string, { ponto: string; barra: string }> = {
  slate: { ponto: 'bg-muted-foreground', barra: 'bg-muted-foreground' },
  sky: { ponto: 'bg-info', barra: 'bg-info' },
  blue: { ponto: 'bg-info', barra: 'bg-info' },
  indigo: { ponto: 'bg-info', barra: 'bg-info' },
  amber: { ponto: 'bg-warning', barra: 'bg-warning' },
  orange: { ponto: 'bg-doc', barra: 'bg-doc' },
  violet: { ponto: 'bg-doc', barra: 'bg-doc' },
  green: { ponto: 'bg-primary', barra: 'bg-primary' },
  red: { ponto: 'bg-destructive', barra: 'bg-destructive' },
};

const corDaEtapa = (cor?: string) => CORES[cor ?? 'slate'] ?? CORES.slate;

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
        'cursor-grab space-y-1.5 rounded-lg border border-border bg-card p-3',
        'transition-shadow duration-150 active:cursor-grabbing',
        isDragging
          ? 'z-50 rotate-1 opacity-60 shadow-overlay'
          : 'hover:border-border-strong hover:shadow-card',
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
            <Badge variant="secondary" className="gap-1 border-destructive/20 bg-destructive-surface text-[10px] text-destructive">
              <CalendarClock className="h-3 w-3" /> Atrasada
            </Badge>
          )}
          {/* onPointerDown para o dnd-kit não engolir o clique no botão. */}
          <button
            type="button"
            title="Falar no WhatsApp"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onWhatsApp(oportunidade); }}
            className="rounded p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-success-surface hover:text-success focus-ring"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Texto de coluna vazia, por posição no funil — genérico não orienta ninguém. */
function vazioDaEtapa(indice: number, total: number): { titulo: string; dica: string } {
  if (indice === 0) {
    return { titulo: 'Nenhum lead nesta etapa', dica: 'Novos contatos entram por aqui' };
  }
  if (indice === total - 1) {
    return { titulo: 'Nenhum negócio fechado', dica: 'Arraste para cá ao concluir' };
  }
  return { titulo: 'Nenhum lead nesta etapa', dica: 'Arraste um lead qualificado para cá' };
}

function Coluna({
  coluna, indice, total, onWhatsApp,
}: {
  coluna: ColunaPipeline;
  indice: number;
  total: number;
  onWhatsApp: (o: CardOportunidade) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.etapa.id });
  const cor = corDaEtapa(coluna.etapa.cor);
  const vazio = vazioDaEtapa(indice, total);

  return (
    // `snap-start` + largura mínima: no celular as colunas viram um carrossel
    // que para certinho em cada etapa, em vez de espremer quatro colunas
    // ilegíveis na largura da tela.
    <div className="w-[min(300px,82vw)] flex-shrink-0 snap-start">
      <div className="flex h-full flex-col rounded-card border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', cor.ponto)} aria-hidden="true" />
            <span className="truncate text-sm font-medium text-foreground">
              {coluna.etapa.nome}
            </span>
          </div>
          <span className="shrink-0 text-sm tabular text-muted-foreground">
            {coluna.oportunidades.length}
          </span>
        </div>

        {/* Barra da cor da etapa, logo abaixo do cabeçalho — é o que dá a
            leitura rápida de "em que ponto do funil estou olhando". */}
        <div className={cn('h-0.5 w-full', cor.barra)} aria-hidden="true" />

        <div
          ref={setNodeRef}
          className={cn(
            'flex-1 space-y-2 p-2.5 transition-colors duration-150',
            'min-h-[360px]',
            isOver && 'bg-surface-brand',
          )}
        >
          {coluna.oportunidades.map((o) => (
            <Card key={o.id} oportunidade={o} onWhatsApp={onWhatsApp} />
          ))}

          {coluna.oportunidades.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
              <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <CalendarClock className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">{vazio.titulo}</p>
              <p className="text-xs text-muted-foreground">{vazio.dica}</p>
            </div>
          )}
        </div>

        {coluna.total > 0 && (
          <div className="border-t border-border px-4 py-2.5">
            <p className="text-sm font-medium tabular text-foreground">{moeda(coluna.total)}</p>
          </div>
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
      <div className="flex gap-4 overflow-x-auto pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[440px] w-[min(300px,82vw)] flex-shrink-0 rounded-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Honestidade sobre o que está rodando: no modo legado o card É o cliente,
          então não há valor por negócio nem dois negócios para a mesma pessoa. */}
      {modo === 'legado' && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-surface px-3 py-2.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Modo simplificado.</span>{' '}
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
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
          {colunas.map((c, i) => (
            <Coluna
              key={c.etapa.id}
              coluna={c}
              indice={i}
              total={colunas.length}
              onWhatsApp={setConversa}
            />
          ))}
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

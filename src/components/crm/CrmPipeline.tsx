import { useEffect, useMemo, useRef, useState } from 'react';
import { PALETA_HEX, corParaHex } from '@/lib/crm/cores';
import {
  DndContext, DragEndEvent, MouseSensor, TouchSensor,
  DragOverlay, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import { Building2, CalendarClock, Check, Loader2, MessageCircle, MoreHorizontal, RefreshCw, Search, Settings2, SlidersHorizontal, SquareCheckBig, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { agruparPorEtapa, filtrarOportunidades } from '@/lib/crm/pipeline';
import { FILTROS_VAZIOS, PERIODO_LABEL, aplicarFiltros, contarFiltros, type FiltrosFunil, type PeriodoFiltro } from '@/lib/crm/filtros';
import { useEtapas, useOportunidades, useMoverOportunidade, useExcluirOportunidades, useModoCrm } from '@/hooks/crm/useCrm';
import type { CrmEtapa, CrmOportunidade, ColunaPipeline } from '@/lib/crm/tipos';
import { WhatsAppDialog } from './WhatsAppDialog';
import { moeda as moedaBR } from '@/lib/formato';
import { DadoSensivel } from '@/components/ui/dado-sensivel';
import FunilVendas from '@/pages/FunilVendas';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { mensagemDeErro } from '@/lib/errors';

// Mesma regra da API na URL e no corpo (8-4-4-4-12 hexadecimal): id que passa aqui passa na rota.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
const hexParaCor = (hex: string) => Object.entries(PALETA_HEX).reduce((melhor, atual) => {
  const distancia = (valor: string) => Math.abs(parseInt(valor.slice(1, 3), 16) - parseInt(hex.slice(1, 3), 16)) + Math.abs(parseInt(valor.slice(3, 5), 16) - parseInt(hex.slice(3, 5), 16)) + Math.abs(parseInt(valor.slice(5, 7), 16) - parseInt(hex.slice(5, 7), 16));
  return distancia(atual[1]) < distancia(PALETA_HEX[melhor]) ? atual[0] : melhor;
}, 'slate');

const atrasada = (o: CrmOportunidade) =>
  !!o.data_prevista_fechamento && !o.fechada_em &&
  new Date(o.data_prevista_fechamento) < new Date();

/**
 * Cards montados por coluna de cada vez. Com o histórico do WhatsApp virando lead, uma coluna passa
 * de centenas de cards, e montar todos (cada um arrastável) travava a abertura do CRM. Busca, filtros,
 * contagem e "selecionar coluna" continuam valendo para todos.
 */
export const CARDS_POR_LOTE = 30;

type CardOportunidade = CrmOportunidade & { clientes?: { nome?: string; telefone?: string }; imoveis?: { titulo?: string } };

function Card({ oportunidade, onWhatsApp, modoSelecao, selecionado, onSelecionar }: {
  oportunidade: CardOportunidade;
  onWhatsApp: (o: CardOportunidade) => void;
  modoSelecao: boolean;
  selecionado: boolean;
  onSelecionar: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } =
    useDraggable({ id: oportunidade.id, disabled: modoSelecao });
  const nomeCliente = oportunidade.clientes?.nome;
  const mostrarCliente = nomeCliente &&
    nomeCliente.trim().toLocaleLowerCase('pt-BR') !== oportunidade.titulo.trim().toLocaleLowerCase('pt-BR');

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={modoSelecao ? () => onSelecionar(oportunidade.id) : undefined}
      className={cn(
        'space-y-1.5 rounded-[10px] border border-border bg-card px-3 py-2.5',
        'transition-shadow duration-150 active:cursor-grabbing',
        modoSelecao ? 'cursor-pointer' : 'cursor-grab',
        selecionado && 'border-primary bg-primary/5 ring-1 ring-primary/30',
        isDragging
          ? 'opacity-0'
          : 'hover:border-border-strong hover:shadow-card',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {modoSelecao && (
          <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', selecionado ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 bg-background')} aria-hidden="true">
            {selecionado && <Check className="h-3 w-3" strokeWidth={3} />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold leading-tight">{oportunidade.titulo}</p>
            {oportunidade.is_sample_data && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700">Demo</span>}
          </div>
          {mostrarCliente && <p className="mt-1 truncate text-[11px] text-muted-foreground">{nomeCliente}</p>}
        </div>
        {/* onPointerDown para o dnd-kit não engolir o clique no botão. */}
        <button
          type="button"
          title="Falar no WhatsApp"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onWhatsApp(oportunidade); }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#25D366] text-white transition-opacity hover:opacity-90 focus-ring"
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </button>
      </div>
      {oportunidade.clientes?.telefone && (
        <DadoSensivel valor={oportunidade.clientes.telefone} tipo="telefone" className="block font-mono text-[11px] tabular text-muted-foreground" />
      )}
      {oportunidade.imoveis?.titulo && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
          <Building2 className="h-3 w-3 shrink-0" /> {oportunidade.imoveis.titulo}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {Number(oportunidade.valor_estimado) > 0 && (
          <DadoSensivel valor={moeda(Number(oportunidade.valor_estimado))} tipo="valor" className="text-xs font-medium" />
        )}
        {atrasada(oportunidade) && (
          <Badge variant="secondary" className="h-5 gap-1 border-destructive/20 bg-destructive-surface px-1.5 text-[9px] text-destructive">
            <CalendarClock className="h-3 w-3" /> Atrasada
          </Badge>
        )}
      </div>
    </div>
  );
}

/** Cópia visual usada pelo overlay: o card não fica preso nem atrás das colunas. */
function CardEmArraste({ oportunidade }: { oportunidade: CardOportunidade }) {
  return (
    <div className="w-[260px] rounded-lg border border-primary/30 bg-card p-3 shadow-xl ring-1 ring-primary/20">
      <p className="text-sm font-medium leading-tight">{oportunidade.titulo}</p>
      {oportunidade.clientes?.nome && <p className="truncate text-xs text-muted-foreground">{oportunidade.clientes.nome}</p>}
      {oportunidade.imoveis?.titulo && <p className="truncate text-[11px] text-muted-foreground">{oportunidade.imoveis.titulo}</p>}
      <DadoSensivel valor={moeda(Number(oportunidade.valor_estimado) || 0)} tipo="valor" className="text-sm font-semibold" />
    </div>
  );
}

function Coluna({
  coluna, onWhatsApp, modoSelecao, selecionados, onSelecionar, onSelecionarColuna,
}: {
  coluna: ColunaPipeline;
  onWhatsApp: (o: CardOportunidade) => void;
  modoSelecao: boolean;
  selecionados: Set<string>;
  onSelecionar: (id: string) => void;
  onSelecionarColuna: (ids: string[]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: coluna.etapa.id });
  const cor = corParaHex(coluna.etapa.cor ?? 'slate');
  const [limite, setLimite] = useState(CARDS_POR_LOTE);
  const visiveis = coluna.oportunidades.slice(0, limite);
  const restantes = coluna.oportunidades.length - visiveis.length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-[260px] shrink-0 overflow-hidden rounded-xl border border-border bg-secondary/60 flex flex-col h-full min-h-0 transition-all',
        // Verde da marca com opacidade, não o #F6FFE7: aquele era tão claro
        // que a coluna de destino mal se distinguia das outras.
        isOver && 'border-primary outline outline-2 -outline-offset-2 outline-primary/60',
      )}
    >
      <div className="bg-card px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {modoSelecao && (
              <button
                type="button"
                onClick={() => onSelecionarColuna(coluna.oportunidades.map((o) => o.id))}
                className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', coluna.oportunidades.length > 0 && coluna.oportunidades.every((o) => selecionados.has(o.id)) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 bg-background')}
                aria-label={`Selecionar todos em ${coluna.etapa.nome}`}
              >
                {coluna.oportunidades.length > 0 && coluna.oportunidades.every((o) => selecionados.has(o.id)) && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
            )}
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} aria-hidden="true" />
            <h3 className="truncate text-sm font-semibold text-foreground">{coluna.etapa.nome}</h3>
          </div>
          <Badge variant="secondary" className="h-5 min-w-[2rem] shrink-0 justify-center rounded-full px-2 text-[11px] font-semibold tabular">
            {coluna.oportunidades.length}
          </Badge>
        </div>
      </div>

      <div className="h-[3px] w-full" style={{ background: cor }} aria-hidden="true" />

      <div className={cn('flex-1 space-y-2 overflow-y-auto p-2.5',
            '[scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent]', modoSelecao && 'pb-24', isOver && 'bg-primary/20')}>
        {visiveis.map((o) => (
          <Card key={o.id} oportunidade={o} onWhatsApp={onWhatsApp} modoSelecao={modoSelecao} selecionado={selecionados.has(o.id)} onSelecionar={onSelecionar} />
        ))}

        {restantes > 0 && (
          <button
            type="button"
            onClick={() => setLimite((atual) => atual + CARDS_POR_LOTE)}
            className="w-full rounded-lg border border-dashed border-border py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-ring"
          >
            Mostrar mais {Math.min(restantes, CARDS_POR_LOTE)} de {restantes}
          </button>
        )}

        {coluna.oportunidades.length === 0 && (
          <div className={cn(
            'flex items-center justify-center rounded-lg py-6 text-center text-[12.5px] italic text-muted-foreground',
            isOver && 'border-2 border-dashed border-primary/50 not-italic text-foreground',
          )}>
            {isOver ? 'Solte aqui' : 'Vazio. Arraste cards pra cá.'}
          </div>
        )}
      </div>
    </div>
  );
}

export function CrmPipeline() {
  const { data: modo } = useModoCrm();
  const { data: etapas, isLoading: carregandoEtapas, refetch: recarregarEtapas } = useEtapas();
  const { data: oportunidades, isLoading: carregandoOps, refetch: recarregarOportunidades } = useOportunidades();
  const mover = useMoverOportunidade();
  const excluir = useExcluirOportunidades();
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [conversa, setConversa] = useState<CardOportunidade | null>(null);
  const navegar = useNavigate();
  // O ícone abria um compositor solto, fora da conversa. Quem clica ali quer
  // ler o que já foi dito antes de responder — então vai para o Inbox, já na
  // conversa daquele contato.
  const abrirConversa = (o: CardOportunidade) => {
    const telefone = (o.clientes?.telefone ?? '').replace(/\D/g, '');
    const destino = o.cliente_id
      ? `/whatsapp?cliente=${encodeURIComponent(o.cliente_id)}`
      : telefone ? `/whatsapp?telefone=${telefone}` : '/whatsapp';
    navegar(destino);
  };
  const [busca, setBusca] = useState('');
  const [filtros, setFiltros] = useState<FiltrosFunil>(FILTROS_VAZIOS);
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [gerenciarOpen, setGerenciarOpen] = useState(false);

  // Mesmo tratamento do funil atual: sem estas duas coisas o Kanban parece
  // funcionar e falha no uso real — o clique pós-drop dispara navegação, e sem
  // constraint o card "gruda" no dedo impedindo scroll no celular.
  const arrastou = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const colunasCompletas = useMemo(
    () => agruparPorEtapa(etapas ?? [], oportunidades ?? []),
    [etapas, oportunidades],
  );
  const oportunidadesVisiveis = useMemo(() => {
    const encontradas = filtrarOportunidades((oportunidades ?? []) as CardOportunidade[], busca);
    // A busca corta por texto; o filtro corta por situação. São perguntas
    // diferentes e se somam.
    return aplicarFiltros(encontradas, filtros);
  }, [busca, filtros, oportunidades]);
  const colunas = useMemo(
    () => agruparPorEtapa(etapas ?? [], oportunidadesVisiveis),
    [etapas, oportunidadesVisiveis],
  );

  const aoSoltar = (evento: DragEndEvent) => {
    setArrastando(null);
    arrastou.current = true;
    const { active, over } = evento;
    if (!over) return;

    const alvo = (oportunidades ?? []).find((o) => o.id === String(active.id));
    const etapaDestino = String(over.id);
    if (!alvo || alvo.etapa_id === etapaDestino) return;

    const destino = colunasCompletas.find((c) => c.etapa.id === etapaDestino);
    mover.mutate({
      id: alvo.id,
      etapaId: etapaDestino,
      ordem: destino?.oportunidades.length ?? 0,
      updatedAt: alvo.updated_at, // token de concorrência
    });
  };

  const alternarSelecao = (id: string) => {
    setSelecionados((atuais) => {
      const proximo = new Set(atuais);
      if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
      return proximo;
    });
  };

  const sairDaSelecao = () => {
    setSelecionados(new Set());
    setModoSelecao(false);
  };

  const alternarSelecaoColuna = (ids: string[]) => {
    setSelecionados((atuais) => {
      const proximo = new Set(atuais);
      const todosSelecionados = ids.length > 0 && ids.every((id) => proximo.has(id));
      ids.forEach((id) => todosSelecionados ? proximo.delete(id) : proximo.add(id));
      return proximo;
    });
  };

  const moverSelecionados = (etapaId: string) => {
    const destino = colunasCompletas.find((coluna) => coluna.etapa.id === etapaId);
    [...selecionados].forEach((id, ordem) => {
      const oportunidade = (oportunidades ?? []).find((item) => item.id === id);
      if (oportunidade && oportunidade.etapa_id !== etapaId) {
        mover.mutate({ id, etapaId, ordem: (destino?.oportunidades.length ?? 0) + ordem, updatedAt: oportunidade.updated_at });
      }
    });
    setSelecionados(new Set());
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

  // Mantém a experiência completa que já existia quando as tabelas crm_* ainda
  // não estão disponíveis: busca, filtros, seleção e etapas legadas.
  if (modo === 'legado') return <FunilVendas embedded />;

  const buscaAtiva = busca.trim().length > 0;
  const filtrosLigados = contarFiltros(filtros);

  return (
    <div className="relative flex h-full min-h-[440px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar lead, cliente ou imóvel..."
            aria-label="Buscar no pipeline"
            className="h-[34px] pl-9 pr-9 text-[13.5px]"
          />
          {busca && (
            <button type="button" onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Limpar busca">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant={filtrosLigados ? 'default' : 'outline'} className="h-[34px] shrink-0 gap-1.5 px-3.5 text-[13px] font-semibold">
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {filtrosLigados > 0 && (
                <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary-foreground px-1.5 text-[11px] font-bold tabular text-primary">
                  {filtrosLigados}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Movimentação</Label>
              <Select value={filtros.periodo} onValueChange={(v) => setFiltros((f) => ({ ...f, periodo: v as PeriodoFiltro }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIODO_LABEL) as PeriodoFiltro[]).map((p) => (
                    <SelectItem key={p} value={p}>{PERIODO_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {([
              ['atrasados', 'Só os atrasados', 'Passaram da data prevista e seguem abertos.'],
              ['comValor', 'Só os com valor', 'Negócio com valor estimado preenchido.'],
              ['comImovel', 'Só os com imóvel', 'Negócio já ligado a um imóvel.'],
            ] as const).map(([chave, titulo, ajuda]) => (
              <div key={chave} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor={`filtro-${chave}`} className="text-sm font-medium">{titulo}</Label>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{ajuda}</p>
                </div>
                <Switch
                  id={`filtro-${chave}`}
                  checked={filtros[chave]}
                  onCheckedChange={(v) => setFiltros((f) => ({ ...f, [chave]: v }))}
                />
              </div>
            ))}
            {filtrosLigados > 0 && (
              <button type="button" onClick={() => setFiltros(FILTROS_VAZIOS)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                Limpar filtros
              </button>
            )}
          </PopoverContent>
        </Popover>
        {(buscaAtiva || filtrosLigados > 0) && <span className="text-xs text-muted-foreground">{oportunidadesVisiveis.length} negócio{ oportunidadesVisiveis.length === 1 ? '' : 's' }</span>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="ml-auto h-[34px] w-[34px]" aria-label="Mais opções do funil">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => modoSelecao ? sairDaSelecao() : setModoSelecao(true)}>
              <SquareCheckBig className="mr-2 h-4 w-4" />
              {modoSelecao ? 'Sair da seleção' : 'Selecionar vários'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setGerenciarOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" />
              Gerenciar etapas
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
        <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent]">
          {colunas.map((c) => (
            <Coluna
              key={c.etapa.id}
              coluna={c}
              onWhatsApp={abrirConversa}
              modoSelecao={modoSelecao}
              selecionados={selecionados}
              onSelecionar={alternarSelecao}
              onSelecionarColuna={alternarSelecaoColuna}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null} zIndex={1000}>
          {arrastando && (() => {
            const oportunidade = (oportunidades ?? []).find((item) => item.id === arrastando);
            return oportunidade ? <CardEmArraste oportunidade={oportunidade} /> : null;
          })()}
        </DragOverlay>
      </DndContext>
      {arrastando && <span className="sr-only">Movendo negócio</span>}

      {modoSelecao && (
        <div className="absolute bottom-3 left-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-xl bg-[#151824] px-2.5 py-1.5 text-xs text-white shadow-xl">
          <span className="whitespace-nowrap font-semibold">{selecionados.size} selecionado(s)</span>
          <Select value="" onValueChange={moverSelecionados}>
            <SelectTrigger className="h-8 w-[154px] border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground [&_svg]:text-primary-foreground">
              <SelectValue placeholder="Mover para..." />
            </SelectTrigger>
            <SelectContent>
              {colunasCompletas.map((coluna) => <SelectItem key={coluna.etapa.id} value={coluna.etapa.id}>{coluna.etapa.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Arquivar nunca existiu de verdade: era um botão desabilitado
              prometendo uma ação. Excluir passa a excluir. */}
          <Button
            type="button" size="sm" variant="destructive"
            disabled={excluir.isPending || selecionados.size === 0}
            onClick={() => { excluir.mutate([...selecionados], { onSuccess: () => setSelecionados(new Set()) }); }}
            className="h-8 px-2.5 text-xs"
          >
            {excluir.isPending ? 'Excluindo…' : 'Excluir'}
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={sairDaSelecao} className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Cancelar seleção"><X className="h-3.5 w-3.5" /></Button>
        </div>
      )}

      <WhatsAppDialog
        open={!!conversa}
        onOpenChange={(o) => !o && setConversa(null)}
        contato={conversa?.cliente_id ? {
          id: conversa.cliente_id,
          nome: conversa.clientes?.nome ?? conversa.titulo,
          telefone: conversa.clientes?.telefone,
        } : null}
      />
      <GerenciarEtapas open={gerenciarOpen} onOpenChange={setGerenciarOpen} etapas={etapas ?? []} oportunidades={oportunidades ?? []} aoSalvar={() => { void Promise.all([recarregarEtapas(), recarregarOportunidades()]); }} />
    </div>
  );
}

function GerenciarEtapas({ open, onOpenChange, etapas, oportunidades, aoSalvar }: { open: boolean; onOpenChange: (open: boolean) => void; etapas: CrmEtapa[]; oportunidades: CrmOportunidade[]; aoSalvar: () => void }) {
  const [draft, setDraft] = useState(etapas);
  useEffect(() => { if (open) setDraft(etapas); }, [etapas, open]);
  const salvar = async () => {
    // Dinâmico de propósito: o teste visual roda em node sem mock do cliente do Supabase.
    const { apiDisponivel } = await import('@/lib/api');
    if (apiDisponivel()) {
      // Itens 'novo-…' não vão: hoje também nunca criam nada.
      const etapas = draft.filter((e) => UUID.test(e.id)).map(({ id, nome, cor, tipo, ordem }) => ({ id, nome, cor, tipo, ordem }));
      if (etapas.length > 0) {
        try {
          const { salvarEtapasApi } = await import('@/lib/api/crm');
          await salvarEtapasApi(etapas);
        } catch (e) {
          toast.error(mensagemDeErro(e, 'Não foi possível salvar as etapas.'));
          return; // diálogo fica aberto com o rascunho; nada foi gravado (rota atômica)
        }
      }
      aoSalvar(); onOpenChange(false);
      return;
    }
    const { supabase } = await import('@/integrations/supabase/client');
    for (const etapa of draft) {
      await (supabase as any).from('crm_etapas').update({ nome: etapa.nome, cor: etapa.cor, tipo: etapa.tipo, ordem: etapa.ordem }).eq('id', etapa.id);
    }
    aoSalvar(); onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Gerenciar etapas</DialogTitle></DialogHeader><div className="space-y-2">{draft.map((etapa, i) => <div key={etapa.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2"><Input value={etapa.nome} onChange={(e) => setDraft(d => d.map((x, idx) => idx === i ? { ...x, nome: e.target.value } : x))} className="h-9 flex-1" /><input type="color" value={corParaHex(etapa.cor)} onChange={(e) => setDraft(d => d.map((x, idx) => idx === i ? { ...x, cor: hexParaCor(e.target.value) } : x))} className="h-9 w-10 cursor-pointer rounded border" /><Button type="button" size="icon" variant="ghost" title="Remover etapa" className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={oportunidades.some(o => o.etapa_id === etapa.id)} onClick={() => setDraft(d => d.filter(x => x.id !== etapa.id))}><Trash2 className="h-4 w-4" /></Button></div>)}</div><Button type="button" variant="outline" className="w-full" onClick={() => setDraft(d => [...d, { id: `novo-${Date.now()}`, corretor_id: '', nome: 'Novo quadro', ordem: d.length, cor: 'blue', tipo: 'ABERTA', ativo: true }])}>+ Adicionar quadro</Button><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => void salvar()}>Salvar</Button></DialogFooter></DialogContent></Dialog>;
}

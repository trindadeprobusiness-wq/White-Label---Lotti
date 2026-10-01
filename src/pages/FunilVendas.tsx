import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useCRMStore } from '@/stores/crmStore';
import { StatusFunil, Cliente, Imovel, TipoInteresse } from '@/types/crm';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getCommonSelectedStageId } from '@/lib/funnelSelection';
import { AlertTriangle, MessageCircle, MoreHorizontal, Plus, Search, Settings2, SlidersHorizontal, SquareCheckBig, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { deveBloquearCliqueDoCard } from '@/lib/funilDrag';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

// Paleta de cores das etapas — 6 opções fixas, apresentadas como bolinhas.
// Manter tudo em Tailwind evita malabarismo com CSS-in-JS e permite dark theme
// pelo próprio design system.
type StageColor = 'blue' | 'amber' | 'orange' | 'emerald' | 'violet' | 'red' | 'slate';

const COLOR_CLASSES: Record<StageColor, { dot: string; text: string; accent: string }> = {
  blue: { dot: 'bg-blue-500', text: 'text-blue-400', accent: 'bg-blue-500' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-400', accent: 'bg-amber-500' },
  orange: { dot: 'bg-orange-500', text: 'text-orange-400', accent: 'bg-orange-500' },
  emerald: { dot: 'bg-emerald-500', text: 'text-emerald-400', accent: 'bg-emerald-500' },
  violet: { dot: 'bg-violet-500', text: 'text-violet-400', accent: 'bg-violet-500' },
  red: { dot: 'bg-red-500', text: 'text-red-400', accent: 'bg-red-500' },
  slate: { dot: 'bg-slate-500', text: 'text-slate-400', accent: 'bg-slate-500' },
};

/**
 * Cada etapa tem um `id` estável. Para as 4 etapas canônicas o id é o próprio
 * enum StatusFunil — daí conseguimos falar direto com o crmStore.
 * Etapas customizadas ganham id `custom_...` e o vínculo com cada cliente vive
 * em um overrides-map (id do cliente → id da etapa custom). Assim mantemos a
 * tipagem global do CRM intacta e ainda deixamos o corretor criar quantas
 * etapas quiser.
 */
type FunnelColumn = {
  id: string;
  label: string;
  color: StageColor;
  canonical: StatusFunil | null;
};

const CANONICAL_STAGES: FunnelColumn[] = [
  { id: 'QUALIFICACAO', canonical: 'QUALIFICACAO', label: 'Qualificação', color: 'blue' },
  { id: 'VISITA_PROPOSTA', canonical: 'VISITA_PROPOSTA', label: 'Visita/Proposta', color: 'amber' },
  { id: 'DOCUMENTACAO', canonical: 'DOCUMENTACAO', label: 'Documentação', color: 'orange' },
  { id: 'FECHADO_GANHO', canonical: 'FECHADO_GANHO', label: 'Fechamento', color: 'emerald' },
];

const STORAGE_KEY = 'lotti_funil_stages_v2';
const OVERRIDES_KEY = 'lotti_funil_client_stage_v1';

function loadColumns(): FunnelColumn[] {
  if (typeof window === 'undefined') return CANONICAL_STAGES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return CANONICAL_STAGES;
    const saved: FunnelColumn[] = JSON.parse(raw);
    // Garante que as canônicas nunca somem, mesmo se um snapshot antigo estiver corrompido.
    const byId = new Map(saved.map((s) => [s.id, s]));
    const merged: FunnelColumn[] = saved.filter((s) => !CANONICAL_STAGES.some((c) => c.id === s.id));
    return [
      ...CANONICAL_STAGES.map((c) => byId.get(c.id) ?? c),
      ...merged,
    ];
  } catch {
    return CANONICAL_STAGES;
  }
}

function loadOverrides(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(OVERRIDES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const formatValor = (valor: number) =>
  valor > 10000
    ? `R$ ${(valor / 1000).toFixed(0)}k`
    : `R$ ${valor.toLocaleString('pt-BR')}/mês`;

export function DroppableColumn({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Todas as etapas recebem a mesma fração do board. A largura mínima
        // preserva a leitura; acima dela, as colunas se redistribuem para
        // preencher o espaço após adicionar ou remover uma etapa.
        'min-w-[260px] flex-1 rounded-xl border border-border bg-secondary/60 flex flex-col h-full min-h-0 transition-all',
        isOver && 'border-primary/40 outline outline-2 -outline-offset-2 outline-primary/40'
      )}
    >
      {children}
    </div>
  );
}

function DraggableCard({
  cliente,
  imovel,
  alert,
  selectionMode,
  selected,
  onToggleSelect,
  bloquearCliqueRef,
  arrasteAtivo,
}: {
  cliente: Cliente;
  imovel: Imovel | null;
  alert: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  bloquearCliqueRef: MutableRefObject<boolean>;
  arrasteAtivo: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cliente.id,
    // No modo seleção o card não deve arrastar — o clique é para marcar.
    disabled: selectionMode,
  });

  const commonClasses = cn(
    'block rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow',
    selectionMode
      ? cn('cursor-pointer hover:border-primary/40', selected && 'border-primary bg-primary/5')
      : 'cursor-grab active:cursor-grabbing hover:shadow-md',
    isDragging && 'opacity-0',
  );

  const inner = (
    <div className="flex min-w-0 flex-col gap-1">
      {selectionMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="absolute h-4 w-4 rounded border-border accent-primary cursor-pointer"
          aria-label={`Selecionar ${cliente.nome}`}
        />
      )}
      <div className={cn('min-w-0', selectionMode && 'pl-6')}>
        <div className="flex items-center gap-2">
          {alert && <AlertTriangle className="h-4 w-4 flex-shrink-0 text-destructive" />}
          <p className="truncate text-sm font-semibold">{cliente.nome}</p>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {imovel?.titulo ?? cliente.tipo_interesse}
        </p>
      </div>
      <div className={cn('flex items-center justify-between pt-1', selectionMode && 'pl-6')}>
        <DadoSensivel valor={imovel ? formatValor(imovel.valor) : 'R$ 0'} tipo="valor" className="text-sm font-semibold text-primary" />
        <MessageCircle className="h-4 w-4 text-muted-foreground" aria-label="Conversa do cliente" />
      </div>
    </div>
  );

  // No modo seleção o "cartão" é um botão que só marca — sem navegar, sem arrastar.
  if (selectionMode) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleSelect}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggleSelect();
          }
        }}
        className={commonClasses}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      to={`/clientes/${cliente.id}`}
      onClick={(e) => {
        if (deveBloquearCliqueDoCard(arrasteAtivo, bloquearCliqueRef.current)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      style={{
        touchAction: 'manipulation',
      }}
      className={commonClasses}
    >
      {inner}
    </Link>
  );
}

function CardEmArraste({
  cliente,
  imovel,
  alert,
}: Pick<Parameters<typeof DraggableCard>[0], 'cliente' | 'imovel' | 'alert'>) {
  return (
    <div className="w-[260px] rounded-lg border border-primary/30 bg-card p-3 shadow-xl ring-1 ring-primary/20">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          {alert && <AlertTriangle className="h-4 w-4 flex-shrink-0 text-destructive" />}
          <p className="truncate text-sm font-semibold">{cliente.nome}</p>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {imovel?.titulo ?? cliente.tipo_interesse}
        </p>
        <div className="flex items-center justify-between pt-1">
          <DadoSensivel valor={imovel ? formatValor(imovel.valor) : 'R$ 0'} tipo="valor" className="text-sm font-semibold text-primary" />
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

// Filtros aplicáveis ao funil — mantidos em um único objeto para o Reset
// ser trivial e o Sheet ficar controlado sem gambiarra.
type FunnelFilters = {
  interesse: 'TODOS' | TipoInteresse;
  alerta: 'TODOS' | 'COM' | 'SEM';
  ultimoContato: 'QUALQUER' | '7' | '30' | '90';
};

const FILTROS_INICIAIS: FunnelFilters = {
  interesse: 'TODOS',
  alerta: 'TODOS',
  ultimoContato: 'QUALQUER',
};

export default function FunilVendas({ embedded = false }: { embedded?: boolean }) {
  const { clientes, imoveis, alertas, updateClienteStatus, removeCliente } = useCRMStore();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const bloquearCliqueAposArraste = useRef(false);
  const [busca, setBusca] = useState('');
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [filtros, setFiltros] = useState<FunnelFilters>(FILTROS_INICIAIS);
  // Rascunho no Sheet — só aplicamos ao clicar em "Aplicar", como no Clix.
  const [rascunho, setRascunho] = useState<FunnelFilters>(FILTROS_INICIAIS);

  // Etapas do funil configuráveis via "Gerenciar etapas".
  const [columns, setColumns] = useState<FunnelColumn[]>(() => loadColumns());
  const [gerenciarOpen, setGerenciarOpen] = useState(false);

  // Vínculo cliente ↔ etapa custom (as canônicas seguem no `crmStore`).
  const [overrides, setOverrides] = useState<Record<string, string>>(() => loadOverrides());
  const persistOverrides = (next: Record<string, string>) => {
    setOverrides(next);
    try {
      window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
    } catch {
      /* silent */
    }
  };

  // "Selecionar vários" — modo simples: exibimos uma barra de contagem no topo
  // com "Cancelar". A UI de checkbox por card fica para uma iteração seguinte
  // (a estrutura de seleção já está pronta em `selecionados`).
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const etapaEmLote = getCommonSelectedStageId(selecionados, clientes, overrides);
  useEffect(() => {
    if (!modoSelecao) setSelecionados(new Set());
  }, [modoSelecao]);

  // Mouse: começa o drag após 8px (cliques simples continuam navegando).
  // Touch: segurar 250ms inicia o drag; toque rápido navega e o scroll funciona.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const hasAlert = (clienteId: string) => {
    return alertas.some((a) => a.cliente_id === clienteId && !a.lido);
  };

  // Aplica busca + filtros antes de particionar por status.
  const clientesFiltrados = clientes.filter((c) => {
    if (busca) {
      const q = busca.toLowerCase();
      if (!c.nome.toLowerCase().includes(q) && !c.telefone.includes(q)) return false;
    }
    if (filtros.interesse !== 'TODOS' && c.tipo_interesse !== filtros.interesse) return false;
    if (filtros.alerta === 'COM' && !hasAlert(c.id)) return false;
    if (filtros.alerta === 'SEM' && hasAlert(c.id)) return false;
    if (filtros.ultimoContato !== 'QUALQUER') {
      const dias = Number(filtros.ultimoContato);
      const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
      if (new Date(c.ultimo_contato).getTime() < limite) return false;
    }
    return true;
  });

  // Retorna os clientes que devem aparecer numa coluna, considerando:
  // — se a coluna é canônica: pega quem tem `status_funil` igual e não foi
  //   sequestrado por uma coluna custom;
  // — se a coluna é custom: pega quem foi explicitamente vinculado a ela.
  const getClientesByColumn = (col: FunnelColumn) => {
    if (col.canonical) {
      return clientesFiltrados.filter(
        (c) => c.status_funil === col.canonical && !overrides[c.id],
      );
    }
    return clientesFiltrados.filter((c) => overrides[c.id] === col.id);
  };

  const filtrosAtivos =
    (filtros.interesse !== 'TODOS' ? 1 : 0) +
    (filtros.alerta !== 'TODOS' ? 1 : 0) +
    (filtros.ultimoContato !== 'QUALQUER' ? 1 : 0);

  const getImovelPrincipal = (cliente: Cliente) => {
    if (cliente.imoveis_interesse.length === 0) return null;
    return imoveis.find((i) => i.id === cliente.imoveis_interesse[0]) || null;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    window.setTimeout(() => {
      bloquearCliqueAposArraste.current = false;
    }, 0);
    const { active, over } = event;
    if (!over) return;

    const clienteId = String(active.id);
    const targetColId = String(over.id);
    const targetCol = columns.find((c) => c.id === targetColId);
    const cliente = clientes.find((c) => c.id === clienteId);
    if (!targetCol || !cliente) return;

    if (targetCol.canonical) {
      // Volta para a canônica: atualiza o status e limpa override, se existir.
      if (cliente.status_funil !== targetCol.canonical) {
        updateClienteStatus(clienteId, targetCol.canonical);
      }
      if (overrides[clienteId]) {
        const rest = { ...overrides };
        delete rest[clienteId];
        persistOverrides(rest);
      }
    } else {
      // Move para uma coluna custom: mantém o status base e registra o override.
      if (overrides[clienteId] !== targetCol.id) {
        persistOverrides({ ...overrides, [clienteId]: targetCol.id });
      }
    }
  };

  const moverSelecionados = async (columnId: string) => {
    const destino = columns.find((column) => column.id === columnId);
    if (!destino || selecionados.size === 0) return;

    const nextOverrides = { ...overrides };
    await Promise.all([...selecionados].map(async (clienteId) => {
      if (destino.canonical) {
        delete nextOverrides[clienteId];
        await updateClienteStatus(clienteId, destino.canonical);
      } else {
        nextOverrides[clienteId] = destino.id;
      }
    }));
    persistOverrides(nextOverrides);
    setSelecionados(new Set());
  };

  const arquivarSelecionados = async () => {
    if (selecionados.size === 0) return;
    const nextOverrides = { ...overrides };
    await Promise.all([...selecionados].map(async (clienteId) => {
      delete nextOverrides[clienteId];
      await updateClienteStatus(clienteId, 'FECHADO_PERDIDO');
    }));
    persistOverrides(nextOverrides);
    setSelecionados(new Set());
  };

  const excluirSelecionados = async () => {
    if (selecionados.size === 0) return;
    if (!window.confirm(`Excluir ${selecionados.size} cliente(s) selecionado(s)? Esta ação não pode ser desfeita.`)) return;
    await Promise.all([...selecionados].map((clienteId) => removeCliente(clienteId)));
    setSelecionados(new Set());
  };

  return (
    // A página inteira do funil ocupa exatamente a altura útil do canvas
    // (viewport menos o padding vertical do AppLayout). Sem scroll de página:
    // a rolagem só aparece dentro das colunas.
    <div className={cn('animate-fade-in', embedded ? 'h-[calc(100vh-15rem)]' : 'h-[calc(100vh-4rem)]')}>
      <div className={cn(
        'h-full flex flex-col gap-4 min-h-0',
        !embedded && 'rounded-2xl border border-border bg-card shadow-sm p-5 md:p-6',
      )}>
        {!embedded && <h1 className="text-2xl font-semibold">Funil de Vendas</h1>}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, telefone…"
              className="pl-9"
            />
          </div>
          <Sheet
            open={filtrosOpen}
            onOpenChange={(o) => {
              setFiltrosOpen(o);
              if (o) setRascunho(filtros);
            }}
          >
            <SheetTrigger asChild>
              <Button variant="default" className="gap-2">
                <SlidersHorizontal className="w-4 h-4" />
                Filtros
                {filtrosAtivos > 0 && (
                  <Badge className="ml-1 h-5 px-2 rounded-full">{filtrosAtivos}</Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[340px] sm:w-[360px] p-0 flex flex-col">
              <SheetHeader className="px-5 pt-5 pb-4 border-b">
                <SheetTitle className="text-base font-semibold">Filtros</SheetTitle>
              </SheetHeader>

              {/* Corpo com scroll — cada seção segue o layout do Clix:
                  título em CAPS pequenininho, opções em linha com contagem à direita. */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
                <FilterSection title="Tipo de interesse">
                  {(
                    [
                      ['TODOS', 'Todos', clientes.length],
                      ['COMPRA', 'Compra', clientes.filter((c) => c.tipo_interesse === 'COMPRA').length],
                      ['LOCACAO', 'Locação', clientes.filter((c) => c.tipo_interesse === 'LOCACAO').length],
                      ['AMBOS', 'Ambos', clientes.filter((c) => c.tipo_interesse === 'AMBOS').length],
                    ] as const
                  ).map(([value, label, count]) => (
                    <FilterRow
                      key={value}
                      label={label}
                      count={count}
                      active={rascunho.interesse === value}
                      onClick={() =>
                        setRascunho((r) => ({ ...r, interesse: value as FunnelFilters['interesse'] }))
                      }
                    />
                  ))}
                </FilterSection>

                <FilterSection title="Alertas">
                  {(
                    [
                      ['TODOS', 'Todos os clientes', clientes.length],
                      ['COM', 'Com alerta pendente', clientes.filter((c) => hasAlert(c.id)).length],
                      ['SEM', 'Sem alerta', clientes.filter((c) => !hasAlert(c.id)).length],
                    ] as const
                  ).map(([value, label, count]) => (
                    <FilterRow
                      key={value}
                      label={label}
                      count={count}
                      active={rascunho.alerta === value}
                      onClick={() =>
                        setRascunho((r) => ({ ...r, alerta: value as FunnelFilters['alerta'] }))
                      }
                    />
                  ))}
                </FilterSection>

                <FilterSection title="Último contato">
                  <Select
                    value={rascunho.ultimoContato}
                    onValueChange={(v) =>
                      setRascunho((r) => ({
                        ...r,
                        ultimoContato: v as FunnelFilters['ultimoContato'],
                      }))
                    }
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QUALQUER">Qualquer data</SelectItem>
                      <SelectItem value="7">Últimos 7 dias</SelectItem>
                      <SelectItem value="30">Últimos 30 dias</SelectItem>
                      <SelectItem value="90">Últimos 90 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterSection>
              </div>

              <SheetFooter className="px-5 py-4 border-t flex-row gap-2 sm:justify-stretch">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setRascunho(FILTROS_INICIAIS);
                    setFiltros(FILTROS_INICIAIS);
                    setFiltrosOpen(false);
                  }}
                >
                  Limpar
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    setFiltros(rascunho);
                    setFiltrosOpen(false);
                  }}
                >
                  Aplicar
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
          {(busca || filtrosAtivos > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBusca('');
                setFiltros(FILTROS_INICIAIS);
              }}
              className="gap-1"
            >
              <X className="w-4 h-4" /> Limpar
            </Button>
          )}

          {/* Menu "..." — ações extras da tela, à direita, igual ao padrão do Clix. */}
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Mais opções">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setModoSelecao((v) => !v)}>
                  <SquareCheckBig className="w-4 h-4 mr-2" />
                  {modoSelecao ? 'Sair da seleção' : 'Selecionar vários'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGerenciarOpen(true)}>
                  <Settings2 className="w-4 h-4 mr-2" />
                  Gerenciar etapas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Barra de ações em lote */}
        {modoSelecao && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground shadow-sm">
            <span className="whitespace-nowrap font-semibold pr-1">
              {selecionados.size} selecionado(s)
            </span>
            <Select
              value={etapaEmLote}
              onValueChange={(value) => {
                void moverSelecionados(value);
              }}
            >
              <SelectTrigger className="h-8 w-[184px] border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground focus:ring-primary-foreground/40 [&_svg]:text-primary-foreground">
                <SelectValue placeholder="Mover para..." />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => (
                  <SelectItem key={column.id} value={column.id}>{column.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={selecionados.size === 0}
              onClick={() => void arquivarSelecionados()}
              className="h-8 bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
            >
              Arquivar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={selecionados.size === 0}
              onClick={() => void excluirSelecionados()}
              className="h-8"
            >
              Excluir
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => { setSelecionados(new Set()); setModoSelecao(false); }}
              className="ml-auto h-8 w-8 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              aria-label="Cancelar seleção"
              title="Cancelar seleção"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

      {/* Diálogo Gerenciar etapas — cor + nome + adicionar/remover etapas custom. */}
      <GerenciarEtapasDialog
        open={gerenciarOpen}
        onOpenChange={setGerenciarOpen}
        columns={columns}
        countByColumn={(col) =>
          col.canonical
            ? clientes.filter((c) => c.status_funil === col.canonical && !overrides[c.id]).length
            : clientes.filter((c) => overrides[c.id] === col.id).length
        }
        onSave={(next) => {
          setColumns(next);
          // Se uma coluna custom foi removida, joga seus clientes de volta à
          // primeira etapa canônica para não sumir com eles do funil.
          const removedIds = columns
            .filter((c) => !c.canonical)
            .filter((c) => !next.some((n) => n.id === c.id))
            .map((c) => c.id);
          if (removedIds.length) {
            const nextOverrides = { ...overrides };
            for (const [cid, colId] of Object.entries(nextOverrides)) {
              if (removedIds.includes(colId)) delete nextOverrides[cid];
            }
            persistOverrides(nextOverrides);
          }
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            /* silent */
          }
          setGerenciarOpen(false);
        }}
      />

      {/* Kanban Board — rolagem horizontal confinada ao próprio board.
          O board ocupa a altura restante do card (flex-1) e cada coluna
          herda essa altura via items-stretch. Nada rola na página. */}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => {
          bloquearCliqueAposArraste.current = true;
          setActiveDragId(String(e.active.id));
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDragId(null);
          window.setTimeout(() => {
            bloquearCliqueAposArraste.current = false;
          }, 0);
        }}
      >
        <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto items-stretch">
          {columns.map((column) => {
            const columnClientes = getClientesByColumn(column);
            const c = COLOR_CLASSES[column.color];
            const allSelected =
              columnClientes.length > 0 &&
              columnClientes.every((cl) => selecionados.has(cl.id));

            return (
              <DroppableColumn key={column.id} id={column.id}>
                {/* Column Header — bolinha + rótulo + contagem, com traço de cor abaixo.
                    A contagem tem largura mínima para os números alinharem entre colunas.
                    No modo seleção, um checkbox marca/desmarca a coluna inteira. */}
                <div className="px-3 pt-3 pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {modoSelecao && (
                        <input
                          type="checkbox"
                          checked={allSelected}
                          disabled={columnClientes.length === 0}
                          onChange={(e) => {
                            setSelecionados((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) {
                                columnClientes.forEach((cl) => next.add(cl.id));
                              } else {
                                columnClientes.forEach((cl) => next.delete(cl.id));
                              }
                              return next;
                            });
                          }}
                          className="h-4 w-4 rounded border-border accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Selecionar todos em ${column.label}`}
                        />
                      )}
                      <span className={cn('h-2 w-2 rounded-full flex-shrink-0', c.dot)} />
                      <h3 className={cn('font-semibold text-sm truncate', c.text)}>
                        {column.label}
                      </h3>
                    </div>
                    <Badge
                      variant="secondary"
                      className="rounded-full font-semibold text-xs h-5 min-w-[2rem] px-2 justify-center flex-shrink-0"
                    >
                      {columnClientes.length}
                    </Badge>
                  </div>
                </div>
                {/* Traço de cor separando o header do corpo */}
                <div className={cn('h-[2px] w-full opacity-70', c.accent)} />

                {/* Cards */}
                <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                  {columnClientes.map((cliente) => (
                    <DraggableCard
                      key={cliente.id}
                      cliente={cliente}
                      imovel={getImovelPrincipal(cliente)}
                      alert={hasAlert(cliente.id)}
                      selectionMode={modoSelecao}
                      selected={selecionados.has(cliente.id)}
                      bloquearCliqueRef={bloquearCliqueAposArraste}
                      arrasteAtivo={activeDragId === cliente.id}
                      onToggleSelect={() => {
                        setSelecionados((prev) => {
                          const next = new Set(prev);
                          if (next.has(cliente.id)) next.delete(cliente.id);
                          else next.add(cliente.id);
                          return next;
                        });
                      }}
                    />
                  ))}

                  {columnClientes.length === 0 && (
                    <div
                      className={cn(
                        'flex items-center justify-center text-center py-10 text-muted-foreground text-xs italic rounded-lg',
                        activeDragId && 'border-2 border-dashed border-primary/30 not-italic'
                      )}
                    >
                      {activeDragId ? 'Solte aqui' : 'Vazio. Arraste cards pra cá.'}
                    </div>
                  )}
                </div>
              </DroppableColumn>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null} zIndex={1000}>
          {activeDragId && (() => {
            const cliente = clientes.find((item) => item.id === activeDragId);
            return cliente ? (
              <CardEmArraste
                cliente={cliente}
                imovel={getImovelPrincipal(cliente)}
                alert={hasAlert(cliente.id)}
              />
            ) : null;
          })()}
        </DragOverlay>
      </DndContext>
      </div>{/* fim do card envolvente */}

    </div>
  );
}

/**
 * Dialog "Gerenciar etapas" — enxuto e direto: uma linha por etapa (bolinha de
 * cor + nome + contagem + lixeira), botão "Adicionar etapa" no rodapé.
 *
 * Etapas canônicas (as 4 padrão) não podem ser excluídas porque elas estão no
 * enum StatusFunil e são usadas por relatórios/edge functions. Etapas custom
 * (adicionadas pelo corretor) podem ser removidas — os clientes nelas voltam
 * para a primeira etapa canônica.
 */
function GerenciarEtapasDialog({
  open,
  onOpenChange,
  columns,
  countByColumn,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: FunnelColumn[];
  countByColumn: (col: FunnelColumn) => number;
  onSave: (next: FunnelColumn[]) => void;
}) {
  const [draft, setDraft] = useState<FunnelColumn[]>(columns);
  useEffect(() => {
    if (open) setDraft(columns);
  }, [open, columns]);

  const palette: StageColor[] = ['blue', 'amber', 'orange', 'emerald', 'violet', 'red', 'slate'];

  const addStage = () => {
    const id = `custom_${Date.now()}`;
    setDraft((d) => [...d, { id, canonical: null, label: 'Nova etapa', color: 'violet' }]);
  };

  const removeStage = (id: string) =>
    setDraft((d) => d.filter((s) => s.id !== id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Gerenciar etapas</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2 max-h-[60vh] overflow-y-auto pr-1">
          {draft.map((stage, i) => {
            const c = COLOR_CLASSES[stage.color];
            const count = countByColumn(stage);
            const isCanonical = stage.canonical !== null;
            return (
              <div
                key={stage.id}
                className="flex items-center gap-3 rounded-lg border bg-card/40 px-3 py-2.5"
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'h-6 w-6 rounded-full ring-2 ring-transparent hover:ring-border flex-shrink-0',
                        c.dot,
                      )}
                      aria-label="Escolher cor"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="p-2">
                    <div className="grid grid-cols-6 gap-1.5">
                      {palette.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() =>
                            setDraft((d) =>
                              d.map((s, idx) => (idx === i ? { ...s, color } : s)),
                            )
                          }
                          className={cn(
                            'h-6 w-6 rounded-full ring-2 transition',
                            COLOR_CLASSES[color].dot,
                            stage.color === color
                              ? 'ring-foreground'
                              : 'ring-transparent hover:ring-border',
                          )}
                          aria-label={color}
                        />
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Input
                  value={stage.label}
                  onChange={(e) =>
                    setDraft((d) =>
                      d.map((s, idx) => (idx === i ? { ...s, label: e.target.value } : s)),
                    )
                  }
                  className="flex-1"
                />

                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap min-w-[3rem] text-right">
                  {count} {count === 1 ? 'cliente' : 'clientes'}
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-30"
                  onClick={() => removeStage(stage.id)}
                  disabled={isCanonical}
                  title={
                    isCanonical
                      ? 'Etapa padrão — não pode ser removida'
                      : 'Remover etapa'
                  }
                  aria-label="Remover etapa"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>

        <Button
          variant="outline"
          onClick={addStage}
          className="w-full border-dashed gap-2"
        >
          <Plus className="w-4 h-4" />
          Adicionar etapa
        </Button>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(draft)}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cabeçalho de seção do painel de filtros — CAPS pequeno, cinza, igual Clix. */
function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

/** Linha de opção: rótulo à esquerda, contagem à direita. Clique alterna a
 *  seleção. O item ativo ganha texto em `primary` (mesmo padrão do Clix). */
function FilterRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-between py-2 px-1 rounded-md text-sm transition-colors',
        'hover:bg-accent/50',
        active ? 'text-primary font-medium' : 'text-foreground/80'
      )}
    >
      <span>{label}</span>
      <span className={cn('text-xs tabular-nums', active ? 'text-primary' : 'text-muted-foreground')}>
        {count}
      </span>
    </button>
  );
}

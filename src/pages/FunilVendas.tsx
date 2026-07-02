import { useRef, useState } from 'react';
import { useCRMStore } from '@/stores/crmStore';
import { StatusFunil, Cliente, Imovel } from '@/types/crm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle, GripVertical } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

const funnelColumns: { status: StatusFunil; label: string; color: string; bgColor: string }[] = [
  {
    status: 'QUALIFICACAO',
    label: 'Qualificação',
    color: 'text-primary',
    bgColor: 'bg-funnel-qualification'
  },
  {
    status: 'VISITA_PROPOSTA',
    label: 'Visita/Proposta',
    color: 'text-warning',
    bgColor: 'bg-funnel-visit'
  },
  {
    status: 'DOCUMENTACAO',
    label: 'Documentação',
    color: 'text-orange-500',
    bgColor: 'bg-funnel-documentation'
  },
  {
    status: 'FECHADO_GANHO',
    label: 'Fechamento',
    color: 'text-success',
    bgColor: 'bg-funnel-closing'
  },
];

const formatValor = (valor: number) =>
  valor > 10000
    ? `R$ ${(valor / 1000).toFixed(0)}k`
    : `R$ ${valor.toLocaleString('pt-BR')}/mês`;

function DroppableColumn({
  status,
  bgColor,
  children,
}: {
  status: StatusFunil;
  bgColor: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-lg p-3 min-h-[500px] transition-shadow',
        bgColor,
        isOver && 'ring-2 ring-primary/50'
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
}: {
  cliente: Cliente;
  imovel: Imovel | null;
  alert: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: cliente.id,
  });

  // Após um drag, o navegador ainda dispara o click no card — sem este guard
  // soltar o card navegaria para a página do cliente.
  const wasDragged = useRef(false);
  if (isDragging) wasDragged.current = true;

  return (
    <Link
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      to={`/clientes/${cliente.id}`}
      onClick={(e) => {
        if (wasDragged.current) {
          e.preventDefault();
          wasDragged.current = false;
        }
      }}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        touchAction: 'manipulation',
      }}
      className={cn(
        'block bg-card rounded-lg p-3 shadow-sm border cursor-grab active:cursor-grabbing',
        'hover:shadow-md transition-shadow',
        isDragging && 'opacity-80 shadow-lg relative z-50'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {alert && (
              <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
            )}
            <p className="font-medium text-sm truncate">
              {cliente.nome}
            </p>
          </div>
          {imovel && (
            <p className="text-xs text-muted-foreground truncate mt-1">
              {imovel.titulo}
            </p>
          )}
          {imovel && (
            <p className="text-xs font-medium text-primary mt-0.5">
              {formatValor(imovel.valor)}
            </p>
          )}
        </div>
        <GripVertical className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
      </div>
    </Link>
  );
}

export default function FunilVendas() {
  const { clientes, imoveis, alertas, updateClienteStatus } = useCRMStore();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Mouse: começa o drag após 8px (cliques simples continuam navegando).
  // Touch: segurar 250ms inicia o drag; toque rápido navega e o scroll funciona.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const getClientesByStatus = (status: StatusFunil) => {
    return clientes.filter((c) => c.status_funil === status);
  };

  const hasAlert = (clienteId: string) => {
    return alertas.some((a) => a.cliente_id === clienteId && !a.lido);
  };

  const getImovelPrincipal = (cliente: Cliente) => {
    if (cliente.imoveis_interesse.length === 0) return null;
    return imoveis.find((i) => i.id === cliente.imoveis_interesse[0]) || null;
  };

  const getValorColuna = (status: StatusFunil) => {
    return getClientesByStatus(status).reduce((total, cliente) => {
      const imovel = getImovelPrincipal(cliente);
      return total + (imovel?.valor || 0);
    }, 0);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const clienteId = String(active.id);
    const newStatus = over.id as StatusFunil;
    const cliente = clientes.find((c) => c.id === clienteId);

    if (cliente && cliente.status_funil !== newStatus) {
      updateClienteStatus(clienteId, newStatus);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Funil de Vendas</h1>
        <p className="text-muted-foreground">
          Arraste os cards para mover clientes entre etapas
        </p>
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setActiveDragId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {funnelColumns.map((column) => {
            const columnClientes = getClientesByStatus(column.status);
            const valorColuna = getValorColuna(column.status);

            return (
              <DroppableColumn
                key={column.status}
                status={column.status}
                bgColor={column.bgColor}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-1">
                  <h3 className={cn('font-semibold', column.color)}>
                    {column.label}
                  </h3>
                  <Badge variant="secondary" className="font-bold">
                    {columnClientes.length}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-4 h-4">
                  {valorColuna > 0 &&
                    `R$ ${valorColuna.toLocaleString('pt-BR')} em negociação`}
                </p>

                {/* Cards */}
                <div className="space-y-2">
                  {columnClientes.map((cliente) => (
                    <DraggableCard
                      key={cliente.id}
                      cliente={cliente}
                      imovel={getImovelPrincipal(cliente)}
                      alert={hasAlert(cliente.id)}
                    />
                  ))}

                  {columnClientes.length === 0 && (
                    <div
                      className={cn(
                        'text-center py-8 text-muted-foreground text-sm rounded-lg',
                        activeDragId && 'border-2 border-dashed border-primary/30'
                      )}
                    >
                      {activeDragId ? 'Solte aqui' : 'Nenhum cliente'}
                    </div>
                  )}
                </div>
              </DroppableColumn>
            );
          })}
        </div>
      </DndContext>

      {/* Closed Lost Section */}
      <Card className="bg-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-muted-foreground">
            Fechados Perdidos ({clientes.filter(c => c.status_funil === 'FECHADO_PERDIDO').length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {clientes
              .filter((c) => c.status_funil === 'FECHADO_PERDIDO')
              .map((cliente) => (
                <Badge
                  key={cliente.id}
                  variant="outline"
                  className="text-muted-foreground"
                >
                  {cliente.nome}
                </Badge>
              ))}
            {clientes.filter((c) => c.status_funil === 'FECHADO_PERDIDO').length === 0 && (
              <span className="text-sm text-muted-foreground">
                Nenhum cliente perdido
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

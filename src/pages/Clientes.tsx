import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, MoreVertical, Pencil, Trash, Upload, Filter,
  MessageCircle, Users, ExternalLink, List, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useCRMStore } from '@/stores/crmStore';
import { STATUS_FUNIL_LABELS, StatusFunil, Cliente } from '@/types/crm';
import { NovoClienteDialog } from '@/components/clientes/NovoClienteDialog';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard, StatusBadge, Avatar, EmptyState } from '@/components/shell/primitivos';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { dataBR, numero } from '@/lib/formato';
import { FLAGS } from '@/lib/flags';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { DadoSensivel } from '@/components/ui/dado-sensivel';

const ROTA_FUNIL = FLAGS.crm ? '/crm' : '/funil';
const POR_PAGINA = 6;

const TOM_STATUS: Record<StatusFunil, 'brand' | 'warning' | 'doc' | 'success' | 'destructive'> = {
  QUALIFICACAO: 'brand',
  VISITA_PROPOSTA: 'warning',
  DOCUMENTACAO: 'doc',
  FECHADO_GANHO: 'success',
  FECHADO_PERDIDO: 'destructive',
};

/**
 * Abas de contagem no topo.
 *
 * Não são um filtro a mais: são a leitura do funil que o corretor faz antes de
 * qualquer coisa — quantos estão parados, quantos fecharam, quantos sumiram.
 * "Sem retorno" é derivado, não existe como status no banco.
 */
type AbaCliente = 'todos' | 'qualificacao' | 'fechados' | 'sem_retorno';

/** 30 dias sem contato é o limite a partir do qual o lead esfria de fato. */
const DIAS_SEM_RETORNO = 30;

function semRetorno(cliente: Cliente, agora = new Date()): boolean {
  if (cliente.status_funil === 'FECHADO_GANHO' || cliente.status_funil === 'FECHADO_PERDIDO') {
    return false;
  }
  if (!cliente.ultimo_contato) return false;
  const dias = (agora.getTime() - new Date(cliente.ultimo_contato).getTime()) / 86_400_000;
  return dias > DIAS_SEM_RETORNO;
}

export default function Clientes() {
  const { clientes, removeCliente, updateClienteStatus, fetchImoveis } = useCRMStore();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState<string>('TODOS');
  const [aba, setAba] = useState<AbaCliente>('todos');
  const [pagina, setPagina] = useState(1);
  const [visao, setVisao] = useState<'lista' | 'grade'>('lista');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // Selecionar não levava a nada: marcava a linha e acabava ali.
  const [confirmarLote, setConfirmarLote] = useState(false);
  const [emLote, setEmLote] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clienteToEdit, setClienteToEdit] = useState<Cliente | null>(null);
  const [clienteToDelete, setClienteToDelete] = useState<Cliente | null>(null);

  useEffect(() => { fetchImoveis(); }, [fetchImoveis]);

  const contagens = useMemo(() => ({
    todos: clientes.length,
    qualificacao: clientes.filter((c) => c.status_funil === 'QUALIFICACAO').length,
    fechados: clientes.filter((c) => c.status_funil === 'FECHADO_GANHO').length,
    sem_retorno: clientes.filter((c) => semRetorno(c)).length,
  }), [clientes]);

  const filtrados = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return clientes.filter((cliente) => {
      const casaBusca =
        !termo ||
        cliente.nome.toLowerCase().includes(termo) ||
        cliente.telefone?.includes(termo) ||
        cliente.email?.toLowerCase().includes(termo);

      const casaStatus = statusFilter === 'TODOS' || cliente.status_funil === statusFilter;

      const casaAba =
        aba === 'todos' ||
        (aba === 'qualificacao' && cliente.status_funil === 'QUALIFICACAO') ||
        (aba === 'fechados' && cliente.status_funil === 'FECHADO_GANHO') ||
        (aba === 'sem_retorno' && semRetorno(cliente));

      return casaBusca && casaStatus && casaAba;
    });
  }, [clientes, search, statusFilter, aba]);

  const pagina1 = () => setPagina(1);
  const visiveis = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const comFiltro = !!search.trim() || statusFilter !== 'TODOS' || aba !== 'todos';

  const alternarSelecao = (id: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const handleDelete = async () => {
    if (!clienteToDelete) return;
    const { success, error } = await removeCliente(clienteToDelete.id);
    if (success) {
      toast({ title: 'Cliente excluído com sucesso.' });
    } else {
      console.error('Erro ao excluir:', error);
      toast({
        variant: 'destructive',
        title: 'Erro ao excluir cliente',
        description:
          'Este cliente possui dados vinculados (histórico, contratos) e não pode ser excluído.',
      });
    }
    setClienteToDelete(null);
  };

  const moverSelecionados = async (status: StatusFunil) => {
    setEmLote(true);
    for (const id of selecionados) await updateClienteStatus(id, status);
    setEmLote(false);
    setSelecionados(new Set());
    toast({ title: `Etapa alterada para ${STATUS_FUNIL_LABELS[status]}.` });
  };

  const excluirSelecionados = async () => {
    setEmLote(true);
    let falhas = 0;
    // Um a um, para que um cliente com histórico vinculado não derrube o resto.
    for (const id of selecionados) {
      const { success } = await removeCliente(id);
      if (!success) falhas += 1;
    }
    setEmLote(false);
    setConfirmarLote(false);
    setSelecionados(new Set());
    toast(falhas
      ? { variant: 'destructive', title: `${falhas} cliente(s) não puderam ser excluídos.`, description: 'Clientes com histórico ou contratos vinculados são preservados.' }
      : { title: 'Clientes excluídos.' });
  };

  const abas: { valor: AbaCliente; label: string; contagem: number }[] = [
    { valor: 'todos', label: 'Todos', contagem: contagens.todos },
    { valor: 'qualificacao', label: 'Qualificação', contagem: contagens.qualificacao },
    { valor: 'fechados', label: 'Fechados', contagem: contagens.fechados },
    { valor: 'sem_retorno', label: 'Sem retorno', contagem: contagens.sem_retorno },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        titulo="Clientes"
        subtitulo={`${numero(clientes.length)} cliente${clientes.length === 1 ? '' : 's'} cadastrado${clientes.length === 1 ? '' : 's'}`}
        comBusca
        comUtilitarios
        acoes={
          <>
            <Button
              variant="outline"
              className="h-control"
              onClick={() =>
                toast({
                  title: 'Importação de clientes',
                  description: 'Disponível em breve. Por enquanto, cadastre pelo botão "Novo cliente".',
                })
              }
            >
              <Upload className="mr-2 h-[18px] w-[18px]" />
              Importar
            </Button>
            <Button
              className="h-control"
              onClick={() => { setClienteToEdit(null); setDialogOpen(true); }}
            >
              <Plus className="mr-2 h-[18px] w-[18px]" />
              Novo cliente
            </Button>
          </>
        }
      />

      {/* Faixa de contagem. Cada aba é um filtro, e o número é a informação —
          por isso ele domina visualmente o rótulo. */}
      <div className="mb-5 grid grid-cols-2 rounded-card border border-border bg-card shadow-card sm:grid-cols-4">
        {abas.map((a, i) => (
          <button
            key={a.valor}
            type="button"
            onClick={() => { setAba(a.valor); pagina1(); }}
            aria-pressed={aba === a.valor}
            className={cn(
              'relative flex flex-col items-center gap-1 px-4 py-4 transition-colors duration-150',
              'hover:bg-muted focus-ring',
              i % 2 === 1 && 'border-l border-border',
              i < 2 && 'border-b border-border sm:border-b-0',
              i > 0 && 'sm:border-l sm:border-border',
            )}
          >
            <span className="text-sm text-muted-foreground">{a.label}</span>
            <span className="text-kpi tabular text-foreground">
              {a.contagem === 0 && a.valor === 'sem_retorno' ? '—' : numero(a.contagem)}
            </span>
            {aba === a.valor && (
              <span
                className="absolute inset-x-4 bottom-0 h-0.5 rounded-t-full bg-primary"
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou e-mail..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); pagina1(); }}
            className="h-control pl-11"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); pagina1(); }}>
          <SelectTrigger className="h-control w-full sm:w-48">
            <Filter className="mr-2 h-[18px] w-[18px] text-muted-foreground" />
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos os status</SelectItem>
            {Object.entries(STATUS_FUNIL_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

      </div>

      {/* Aviso de concentração: o mesmo número já aparece na aba, mas aqui ele
          vira ação — leva ao funil, onde dá para mover os leads. */}
      {contagens.qualificacao > 0 && aba === 'todos' && (
        <div className="mb-4 flex flex-col gap-3 rounded-card border border-border bg-card px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2.5 text-sm text-foreground">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-primary">
              <Users className="h-4 w-4" />
            </span>
            {numero(contagens.qualificacao)} cliente(s) ainda na etapa de qualificação
          </p>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link to={ROTA_FUNIL}>
              Abrir funil
              <ExternalLink className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}

      {/* Marcar linhas não levava a nada. Com seleção, aparecem as ações que
          só fazem sentido em conjunto: mover de etapa e excluir. */}
      {selecionados.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-sm font-medium">
            {selecionados.size} selecionado{selecionados.size > 1 ? 's' : ''}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select disabled={emLote} onValueChange={(v) => void moverSelecionados(v as StatusFunil)}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue placeholder="Mover para etapa..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_FUNIL_LABELS).map(([valor, rotulo]) => (
                  <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={emLote} className="text-destructive" onClick={() => setConfirmarLote(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Excluir
            </Button>
            <Button variant="ghost" size="sm" disabled={emLote} onClick={() => setSelecionados(new Set())}>
              <X className="mr-1.5 h-4 w-4" />
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {filtrados.length === 0 ? (
        <SectionCard>
          <EmptyState
            icone={<Users className="h-6 w-6" />}
            titulo={comFiltro ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
            descricao={
              comFiltro
                ? 'Ajuste a busca ou limpe os filtros para ver mais resultados.'
                : 'Seus próximos negócios começam aqui. Cadastre um contato ou prepare uma importação revisada para começar.'
            }
            acao={
              comFiltro ? (
                <Button
                  variant="outline"
                  onClick={() => { setSearch(''); setStatusFilter('TODOS'); setAba('todos'); pagina1(); }}
                >
                  Limpar filtros
                </Button>
              ) : (
                <>
                  <Button onClick={() => { setClienteToEdit(null); setDialogOpen(true); }}>
                    <Plus className="mr-2 h-[18px] w-[18px]" />
                    Cadastrar cliente
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/onboarding?etapa=entrada_dados">
                      <Upload className="mr-2 h-4 w-4" />
                      Importar leads
                    </Link>
                  </Button>
                </>
              )
            }
          />
        </SectionCard>
      ) : visao === 'lista' ? (
        <>
          <SectionCard semPadding>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={visiveis.length > 0 && visiveis.every((c) => selecionados.has(c.id))}
                        onCheckedChange={(marcado) =>
                          setSelecionados(marcado ? new Set(visiveis.map((c) => c.id)) : new Set())
                        }
                        aria-label="Selecionar todos da página"
                      />
                    </TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="hidden md:table-cell">Contato</TableHead>
                    <TableHead>Etapa</TableHead>
                    <TableHead className="hidden lg:table-cell">Último contato</TableHead>
                    <TableHead className="text-right">Próxima ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((cliente) => (
                    <TableRow key={cliente.id}>
                      <TableCell>
                        <Checkbox
                          checked={selecionados.has(cliente.id)}
                          onCheckedChange={() => alternarSelecao(cliente.id)}
                          aria-label={`Selecionar ${cliente.nome}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar nome={cliente.nome} className="h-8 w-8" />
                          <Link
                            to={`/clientes/${cliente.id}`}
                            className="truncate text-sm font-medium hover:underline focus-ring rounded"
                          >
                            {cliente.nome}
                          </Link>
                          {cliente.is_sample_data && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-700">Demo</span>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-sm text-muted-foreground">
                          <DadoSensivel valor={cliente.telefone || cliente.email} tipo={cliente.telefone ? 'telefone' : 'email'} />
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tom={TOM_STATUS[cliente.status_funil] ?? 'neutro'}>
                          {STATUS_FUNIL_LABELS[cliente.status_funil]}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {dataBR(cliente.ultimo_contato)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {cliente.telefone && (
                            <Button
                              variant="ghost" size="icon" className="h-9 w-9"
                              asChild aria-label={`WhatsApp de ${cliente.nome}`}
                            >
                              <a
                                href={`https://wa.me/${cliente.telefone.replace(/\D/g, '')}`}
                                target="_blank" rel="noopener noreferrer"
                              >
                                <MessageCircle className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={`/clientes/${cliente.id}`}>Ver cliente</Link>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-9 w-9"
                                aria-label={`Ações para ${cliente.nome}`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => { setClienteToEdit(cliente); setDialogOpen(true); }}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setClienteToDelete(cliente)}
                              >
                                <Trash className="mr-2 h-4 w-4" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="border-t border-border px-4 py-3">
              <PaginacaoAdmin
                pagina={pagina}
                porPagina={POR_PAGINA}
                total={filtrados.length}
                aoMudarPagina={setPagina}
              />
            </div>
          </SectionCard>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visiveis.map((cliente) => (
              <SectionCard key={cliente.id}>
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar nome={cliente.nome} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/clientes/${cliente.id}`}
                      className="block truncate text-sm font-medium hover:underline focus-ring rounded"
                    >
                      {cliente.nome}
                    </Link>
                    {cliente.is_sample_data && <span className="mt-1 inline-flex rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-700">Demonstração</span>}
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      <DadoSensivel valor={cliente.telefone || cliente.email} tipo={cliente.telefone ? 'telefone' : 'email'} />
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge tom={TOM_STATUS[cliente.status_funil] ?? 'neutro'}>
                        {STATUS_FUNIL_LABELS[cliente.status_funil]}
                      </StatusBadge>
                      <span className="text-xs text-muted-foreground">
                        {dataBR(cliente.ultimo_contato)}
                      </span>
                    </div>
                  </div>
                </div>
              </SectionCard>
            ))}
          </div>
          <div className="mt-4">
            <PaginacaoAdmin
              pagina={pagina}
              porPagina={POR_PAGINA}
              total={filtrados.length}
              aoMudarPagina={setPagina}
            />
          </div>
        </>
      )}

      <NovoClienteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clienteToEdit={clienteToEdit}
      />

      <AlertDialog
        open={!!clienteToDelete}
        onOpenChange={(aberto) => !aberto && setClienteToDelete(null)}
      >
        <AlertDialogContent>
      <AlertDialog open={confirmarLote} onOpenChange={setConfirmarLote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selecionados.size} cliente(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem tiver histórico ou contratos vinculados é preservado, e você verá quantos ficaram. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emLote}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={emLote} onClick={(e) => { e.preventDefault(); void excluirSelecionados(); }}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              {clienteToDelete?.nome} será removido permanentemente. Clientes com histórico,
              contratos ou documentos vinculados não podem ser excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

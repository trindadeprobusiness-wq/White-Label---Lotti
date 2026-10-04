import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Download, MoreHorizontal, Ban, RotateCcw } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { DialogoConfirmacao } from '@/components/admin/DialogoConfirmacao';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useUsuarios, useDefinirStatusCorretor, ITENS_POR_PAGINA,
} from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import { dataBR, dataHoraBR, numero } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';
import { cn } from '@/lib/utils';
import type { UsuarioAdmin } from '@/integrations/supabase/admin-types';
import { rotuloAssinatura, rotuloAtividade, rotuloStatusConta } from '@/lib/admin/saas';
import { useOpcoesParceiros } from '@/hooks/admin/useAtendimento';
import { AbrirPainelUsuario } from '@/components/admin/AbrirPainelUsuario';

const COR_STATUS: Record<string, string> = {
  ativo: 'bg-success/10 text-success border-success/20',
  suspenso: 'bg-destructive/10 text-destructive border-destructive/20',
  inativo: 'bg-muted text-muted-foreground border-border',
};

const TODOS = 'TODOS';

export default function AdminUsuarios() {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState(TODOS);
  const [atividade, setAtividade] = useState(TODOS);
  const [parceiroId, setParceiroId] = useState(TODOS);
  const [pagina, setPagina] = useState(1);
  const [alvo, setAlvo] = useState<{ usuario: UsuarioAdmin; novoStatus: string } | null>(null);

  const { podeExecutar } = usePapeis();
  const definirStatus = useDefinirStatusCorretor();
  const { data: parceiros } = useOpcoesParceiros();

  const { data, isLoading, error, refetch } = useUsuarios({
    busca: busca.trim() || undefined,
    status: status === TODOS ? undefined : status,
    atividade: atividade === TODOS ? undefined : atividade,
    parceiroId: parceiroId === TODOS ? undefined : parceiroId,
    pagina,
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const comFiltro = !!busca.trim() || status !== TODOS || atividade !== TODOS || parceiroId !== TODOS;

  const aoFiltrar = (fn: () => void) => {
    fn();
    setPagina(1); // trocar filtro na página 5 mostraria "nenhum resultado" sem motivo
  };

  const exportar = () => {
    baixarCsv(
      montarCsv(itens, [
        { cabecalho: 'Nome', valor: (u) => u.nome },
        { cabecalho: 'E-mail', valor: (u) => u.email },
        { cabecalho: 'Telefone', valor: (u) => u.telefone },
        { cabecalho: 'CRECI', valor: (u) => u.creci },
        { cabecalho: 'Status da conta', valor: (u) => rotuloStatusConta(u.status) },
        { cabecalho: 'Atividade', valor: (u) => rotuloAtividade(u.atividade) },
        { cabecalho: 'Cadastro', valor: (u) => dataBR(u.criado_em) },
        { cabecalho: 'Último acesso', valor: (u) => dataHoraBR(u.ultimo_acesso_em) },
        { cabecalho: 'Plano', valor: (u) => u.plano_nome },
        { cabecalho: 'Assinatura', valor: (u) => rotuloAssinatura(u.assinatura_status) },
        { cabecalho: 'Parceiro', valor: (u) => u.parceiro_nome },
        { cabecalho: 'Clientes', valor: (u) => u.total_clientes },
        { cabecalho: 'Imóveis', valor: (u) => u.total_imoveis },
      ]),
      nomeArquivoCsv('usuarios'),
    );
  };

  return (
    <>
      <CabecalhoAdmin
        titulo="Usuários"
        descricao="Contas de corretores da plataforma."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Usuários' }]}
        acoes={
          podeExecutar('exportar_dados') && itens.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportar}>
              <Download className="mr-2 h-4 w-4" />
              Exportar página
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="busca-usuarios" className="text-xs text-muted-foreground">
            Buscar
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="busca-usuarios"
              value={busca}
              onChange={(e) => aoFiltrar(() => setBusca(e.target.value))}
              placeholder="Nome, e-mail, telefone ou CRECI"
              className="pl-10"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-status" className="text-xs text-muted-foreground">
            Conta
          </Label>
          <Select value={status} onValueChange={(v) => aoFiltrar(() => setStatus(v))}>
            <SelectTrigger id="filtro-status" className="w-full sm:w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value="ativo">{rotuloStatusConta('ativo')}</SelectItem>
              <SelectItem value="suspenso">{rotuloStatusConta('suspenso')}</SelectItem>
              <SelectItem value="inativo">{rotuloStatusConta('inativo')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-parceiro" className="text-xs text-muted-foreground">
            Origem
          </Label>
          <Select value={parceiroId} onValueChange={(v) => aoFiltrar(() => setParceiroId(v))}>
            <SelectTrigger id="filtro-parceiro" className="w-full sm:w-[190px]">
              <SelectValue placeholder="Todos os parceiros" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as origens</SelectItem>
              {(parceiros ?? []).map((parceiro) => (
                <SelectItem key={parceiro.id} value={parceiro.id}>{parceiro.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-atividade" className="text-xs text-muted-foreground">
            Atividade
          </Label>
          <Select value={atividade} onValueChange={(v) => aoFiltrar(() => setAtividade(v))}>
            <SelectTrigger id="filtro-atividade" className="w-full sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              <SelectItem value="ativo">{rotuloAtividade('ativo')}</SelectItem>
              <SelectItem value="inativo">{rotuloAtividade('inativo')}</SelectItem>
              <SelectItem value="sem_dados">{rotuloAtividade('sem_dados')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      ) : isLoading && itens.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : itens.length === 0 ? (
        <EstadoVazio
          titulo={comFiltro ? 'Nenhum usuário com esses filtros' : 'Nenhum usuário cadastrado'}
          descricao={
            comFiltro
              ? 'Ajuste a busca ou limpe os filtros para ver mais resultados.'
              : 'Assim que alguém criar uma conta na Lotti, ela aparece aqui.'
          }
          acao={
            comFiltro ? (
              <Button
                variant="outline"
                onClick={() =>
                  aoFiltrar(() => {
                    setBusca('');
                    setStatus(TODOS);
                    setAtividade(TODOS);
                    setParceiroId(TODOS);
                  })
                }
              >
                Limpar filtros
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <Card>
            {/* Tabela larga rola dentro do próprio container: o body da página
                nunca rola na horizontal. */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="hidden md:table-cell">Contato</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead className="hidden md:table-cell">Plano</TableHead>
                    <TableHead className="hidden lg:table-cell">Atividade</TableHead>
                    <TableHead className="hidden lg:table-cell">Cadastro</TableHead>
                    <TableHead className="hidden xl:table-cell">Parceiro</TableHead>
                    <TableHead>Atendimento</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itens.map((u) => (
                    <TableRow key={u.corretor_id}>
                      <TableCell>
                        <Link
                          to={`/admin/usuarios/${u.corretor_id}`}
                          className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {u.nome}
                        </Link>
                        <p className="text-xs text-muted-foreground md:hidden">{u.email}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <p className="text-sm">{u.email}</p>
                        {u.telefone && (
                          <p className="text-xs text-muted-foreground">{u.telefone}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(COR_STATUS[u.status])}>
                          {rotuloStatusConta(u.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <p className="text-sm">{u.plano_nome ?? 'Sem plano'}</p>
                        <p className="text-xs text-muted-foreground">{rotuloAssinatura(u.assinatura_status)}</p>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span
                          className={cn(
                            'text-sm',
                            u.atividade === 'sem_dados' && 'text-muted-foreground',
                          )}
                        >
                          {rotuloAtividade(u.atividade)}
                        </span>
                        {u.ultimo_acesso_em && (
                          <p className="text-xs text-muted-foreground">
                            {dataBR(u.ultimo_acesso_em)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {dataBR(u.criado_em)}
                      </TableCell>
                      <TableCell className="hidden text-sm xl:table-cell">
                        {u.parceiro_nome ?? '—'}
                      </TableCell>
                      <TableCell>
                        <AbrirPainelUsuario corretorId={u.corretor_id} ativo={u.status === 'ativo'} />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Ações para ${u.nome}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/admin/usuarios/${u.corretor_id}`}>Ver detalhes</Link>
                            </DropdownMenuItem>
                            {u.status !== 'suspenso' && podeExecutar('suspender_usuario') && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setAlvo({ usuario: u, novoStatus: 'suspenso' })}
                              >
                                <Ban className="mr-2 h-4 w-4" />
                                Suspender conta
                              </DropdownMenuItem>
                            )}
                            {u.status === 'suspenso' && podeExecutar('reativar_usuario') && (
                              <DropdownMenuItem
                                onClick={() => setAlvo({ usuario: u, novoStatus: 'ativo' })}
                              >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Reativar conta
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <div className="mt-4">
            <PaginacaoAdmin
              pagina={pagina}
              porPagina={ITENS_POR_PAGINA}
              total={total}
              aoMudarPagina={setPagina}
            />
          </div>
        </>
      )}

      <DialogoConfirmacao
        aberto={!!alvo}
        aoFechar={() => setAlvo(null)}
        titulo={alvo?.novoStatus === 'suspenso' ? 'Suspender conta?' : 'Reativar conta?'}
        descricao={
          alvo?.novoStatus === 'suspenso'
            ? `${alvo?.usuario.nome} perderá acesso a todos os dados da conta enquanto a suspensão durar. Os dados são preservados e nada é excluído.`
            : `${alvo?.usuario.nome} volta a ter acesso normal à plataforma.`
        }
        rotuloConfirmar={alvo?.novoStatus === 'suspenso' ? 'Suspender' : 'Reativar'}
        destrutivo={alvo?.novoStatus === 'suspenso'}
        exigirMotivo
        aoConfirmar={async (motivo) => {
          if (!alvo) return;
          await definirStatus.mutateAsync({
            corretorId: alvo.usuario.corretor_id,
            status: alvo.novoStatus,
            motivo,
          });
        }}
      />

      {total > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {numero(total)} conta(s) no total.
        </p>
      )}
    </>
  );
}

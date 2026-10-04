import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, RotateCcw, Loader2 } from 'lucide-react';
import { useAtendimento, useOpcoesParceiros } from '@/hooks/admin/useAtendimento';
import { AbrirPainelUsuario } from './AbrirPainelUsuario';
import { EstadoErro, EstadoVazio } from './Estados';
import { PaginacaoAdmin } from './PaginacaoAdmin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dataBR, dataHoraBR, moeda, numero } from '@/lib/formato';
import { rotuloAssinatura, rotuloStatusConta } from '@/lib/admin/saas';

const INICIAL = { busca: '', status: 'ativo', origem: 'todos', campanha: '', pagina: 1 };

export function ContasAtendimento() {
  const [filtros, setFiltros] = useState(INICIAL);
  const { data, error, isLoading, isFetching, refetch } = useAtendimento(filtros);
  const parceiros = useOpcoesParceiros();
  const mudar = (valores: Partial<typeof filtros>) => setFiltros(atual => ({ ...atual, ...valores, pagina: 1 }));
  return <section aria-label="Contas para atendimento" className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_150px_220px_190px_auto]">
      <div className="space-y-1.5"><Label htmlFor="atendimento-busca">Usuário</Label><div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input id="atendimento-busca" placeholder="Nome ou e-mail" className="pl-9" value={filtros.busca} onChange={e => mudar({ busca: e.target.value })} />
      </div></div>
      <div className="space-y-1.5"><Label htmlFor="atendimento-status">Conta</Label>
        <Select value={filtros.status} onValueChange={status => mudar({ status })}><SelectTrigger id="atendimento-status"><SelectValue /></SelectTrigger>
          <SelectContent>{['ativo', 'todos', 'suspenso', 'inativo'].map(status => <SelectItem value={status} key={status}>{status === 'todos' ? 'Todas' : rotuloStatusConta(status)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5"><Label htmlFor="atendimento-origem">Parceiro / origem</Label>
        <Select value={filtros.origem} onValueChange={origem => mudar({ origem })}><SelectTrigger id="atendimento-origem"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todas as origens</SelectItem><SelectItem value="direta">Sem parceiro atribuído</SelectItem>
            {(parceiros.data ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5"><Label htmlFor="atendimento-campanha">Campanha</Label><Input id="atendimento-campanha" value={filtros.campanha} placeholder="Todas as campanhas" onChange={e => mudar({ campanha: e.target.value })} /></div>
      <Button variant="outline" className="self-end" size="icon" aria-label="Atualizar contas" title="Atualizar contas" disabled={isFetching} onClick={() => void refetch()}><RotateCcw className="h-4 w-4" /></Button>
    </div>
    {parceiros.error && <EstadoErro erro={parceiros.error} aoTentarNovamente={() => void parceiros.refetch()} />}
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <p>{numero(data?.total ?? 0)} contas{filtros.status === 'ativo' ? ' ativas' : ''}</p>
      {isFetching && <Loader2 className="h-4 w-4 animate-spin" aria-label="Atualizando" />}
    </div>
    {error ? <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} /> : isLoading ?
      <div className="border-y py-12 text-center text-muted-foreground" role="status">Carregando contas...</div> : !data?.itens.length ?
      <EstadoVazio titulo="Nenhuma conta encontrada" acao={<Button variant="outline" onClick={() => setFiltros({ ...INICIAL, status: 'todos' })}>Limpar filtros</Button>} /> :
      <div className="overflow-x-auto border-y">
        <Table><TableHeader><TableRow>
          <TableHead>Usuário</TableHead><TableHead>Conta</TableHead><TableHead>Origem</TableHead><TableHead>Cliques</TableHead>
          <TableHead>Assinatura / receita</TableHead><TableHead>Cadastro / último acesso</TableHead><TableHead>Atendimento</TableHead>
        </TableRow></TableHeader><TableBody>{data.itens.map(c => <TableRow key={c.corretor_id}>
          <TableCell className="min-w-[200px]"><Link className="font-medium hover:underline" to={`/admin/usuarios/${c.corretor_id}`}>{c.nome}</Link><p className="break-all text-xs text-muted-foreground">{c.email}</p></TableCell>
          <TableCell><Badge variant="outline">{rotuloStatusConta(c.status)}</Badge></TableCell>
          <TableCell className="min-w-[160px]">{c.parceiro_id ? <Link className="hover:underline" to={`/admin/parceiros/${c.parceiro_id}`}>{c.parceiro_nome}</Link> : 'Sem parceiro atribuído'}
            {c.campanha && <p className="text-xs text-muted-foreground">{c.campanha}</p>}</TableCell>
          <TableCell className="tabular-nums">{c.parceiro_id ? numero(c.total_cliques) : '—'}
            {c.primeiro_clique_em && <p className="whitespace-nowrap text-xs text-muted-foreground">{dataBR(c.primeiro_clique_em)}</p>}</TableCell>
          <TableCell className="min-w-[160px]"><p>{c.plano_nome ?? 'Sem plano'}</p><p className="text-xs text-muted-foreground">{rotuloAssinatura(c.assinatura_status)}</p><p className="text-xs tabular-nums">{moeda(c.receita_confirmada)} confirmados</p></TableCell>
          <TableCell className="min-w-[180px] text-xs"><p>{dataBR(c.criado_em)}</p><p className="text-muted-foreground">{c.ultimo_acesso_em ? dataHoraBR(c.ultimo_acesso_em) : 'Sem acesso registrado'}</p></TableCell>
          <TableCell className="whitespace-nowrap"><AbrirPainelUsuario corretorId={c.corretor_id} ativo={c.status === 'ativo'} /></TableCell>
        </TableRow>)}</TableBody></Table>
      </div>}
    <PaginacaoAdmin pagina={filtros.pagina} porPagina={25} total={data?.total ?? 0} aoMudarPagina={pagina => setFiltros(atual => ({ ...atual, pagina }))} />
  </section>;
}

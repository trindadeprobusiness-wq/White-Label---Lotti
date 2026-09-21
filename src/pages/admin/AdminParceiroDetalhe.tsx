import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Pencil, Plus, Link2, Ban, Percent } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { CartaoMetrica } from '@/components/admin/CartaoMetrica';
import { EstadoErro } from '@/components/admin/Estados';
import { DialogoConfirmacao } from '@/components/admin/DialogoConfirmacao';
import { FormularioParceiro } from '@/components/admin/FormularioParceiro';
import { DialogoPercentual } from '@/components/admin/DialogoPercentual';
import { DialogoNovoLink } from '@/components/admin/DialogoNovoLink';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useParceiro, useRevogarLink } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import { dataBR, dataHoraBR, moeda, numero, percentual } from '@/lib/formato';
import { getParceiroLinkUrl } from '@/lib/publicBaseUrl';
import { ROTULO_BASE } from '@/lib/admin/comissao';
import { cn } from '@/lib/utils';

const COR_STATUS: Record<string, string> = {
  ativo: 'bg-success/10 text-success border-success/20',
  inativo: 'bg-muted text-muted-foreground border-border',
  suspenso: 'bg-warning/10 text-warning border-warning/20',
  encerrado: 'bg-destructive/10 text-destructive border-destructive/20',
};

const COR_ATRIBUICAO: Record<string, string> = {
  convertida: 'bg-success/10 text-success border-success/20',
  pendente: 'bg-muted text-muted-foreground border-border',
  expirada: 'bg-muted text-muted-foreground border-border',
  invalidada: 'bg-destructive/10 text-destructive border-destructive/20',
};

export default function AdminParceiroDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [editando, setEditando] = useState(false);
  const [novoPercentual, setNovoPercentual] = useState(false);
  const [novoLink, setNovoLink] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);

  const { podeExecutar } = usePapeis();
  const revogarLink = useRevogarLink();
  const { data, isLoading, error, refetch } = useParceiro(id ?? null);

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success('Link copiado.');
    } catch {
      // clipboard exige contexto seguro (https) e pode ser negado. Melhor dizer
      // do que deixar o clique sem resposta nenhuma.
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.');
    }
  };

  if (error) {
    return (
      <>
        <CabecalhoAdmin titulo="Parceiro" migalhas={[{ label: 'Parceiros', href: '/admin/parceiros' }]} />
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <>
        <CabecalhoAdmin titulo="Carregando..." />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    );
  }

  const { parceiro, percentuais, links, atribuicoes } = data;
  const vigente = percentuais.find((p) => p.vigencia_fim === null) ?? null;
  const convertidas = atribuicoes.filter((a) => a.status === 'convertida');

  return (
    <>
      <CabecalhoAdmin
        titulo={parceiro.nome}
        descricao={parceiro.empresa ?? parceiro.email}
        migalhas={[
          { label: 'Back office', href: '/admin' },
          { label: 'Parceiros', href: '/admin/parceiros' },
          { label: parceiro.nome },
        ]}
        acoes={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/parceiros">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar
              </Link>
            </Button>
            {podeExecutar('editar_parceiro') && (
              <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant="outline" className={cn(COR_STATUS[parceiro.status])}>
          {parceiro.status}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Parceria desde {dataBR(parceiro.data_inicio)}
        </span>
        <span className="text-sm text-muted-foreground">
          Janela de {numero(parceiro.janela_atribuicao_dias)} dias
        </span>
      </div>

      {!vigente && (
        <Card className="mb-6 border-warning/50 bg-warning/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Nenhum percentual vigente</p>
              <p className="text-sm text-muted-foreground">
                Sem uma regra vigente, nenhuma receita deste parceiro gera comissão.
              </p>
            </div>
            {podeExecutar('alterar_percentual') && (
              <Button size="sm" onClick={() => setNovoPercentual(true)}>
                <Percent className="mr-2 h-4 w-4" />
                Definir percentual
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CartaoMetrica
          titulo="Percentual vigente"
          valor={vigente ? percentual(vigente.percentual) : '—'}
          detalhe={vigente ? ROTULO_BASE[vigente.base_calculo] : 'Sem regra definida'}
        />
        <CartaoMetrica titulo="Cliques" valor={numero(atribuicoes.length)} />
        <CartaoMetrica
          titulo="Cadastros originados"
          valor={numero(convertidas.length)}
          ajuda="Atribuições que viraram conta dentro da janela."
        />
        <CartaoMetrica
          titulo="Contato"
          valor={parceiro.telefone ?? parceiro.email}
          detalhe={parceiro.responsavel ? `Responsável: ${parceiro.responsavel}` : undefined}
        />
      </div>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Links exclusivos</CardTitle>
          {podeExecutar('gerar_link') && (
            <Button variant="outline" size="sm" onClick={() => setNovoLink(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Gerar link
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum link gerado. Sem link, não há como atribuir cadastros a este parceiro.
            </p>
          ) : (
            <div className="space-y-3">
              {links.map((link) => {
                const url = getParceiroLinkUrl(link.slug);
                const inativo = !link.ativo || !!link.revogado_em;
                return (
                  <div
                    key={link.id}
                    className={cn(
                      'flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between',
                      inativo && 'opacity-60',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        <code className="break-all text-sm">{url}</code>
                        {link.principal && (
                          <Badge variant="outline" className="text-xs">Principal</Badge>
                        )}
                        {inativo && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Revogado
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {link.campanha ? `Campanha: ${link.campanha} · ` : ''}
                        Criado em {dataBR(link.criado_em)}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void copiar(url)}
                        aria-label={`Copiar link ${link.slug}`}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {!inativo && podeExecutar('revogar_link') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevogando(link.id)}
                          aria-label={`Revogar link ${link.slug}`}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Histórico de percentuais</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Alterar o percentual abre uma nova vigência. As comissões já geradas mantêm o
              valor com que nasceram.
            </p>
          </div>
          {podeExecutar('alterar_percentual') && (
            <Button variant="outline" size="sm" onClick={() => setNovoPercentual(true)}>
              <Percent className="mr-2 h-4 w-4" />
              Alterar
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {percentuais.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma regra definida ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vigência</TableHead>
                    <TableHead className="text-right">Percentual</TableHead>
                    <TableHead>Base de cálculo</TableHead>
                    <TableHead className="hidden md:table-cell">Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {percentuais.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">
                        {dataBR(p.vigencia_inicio)} —{' '}
                        {p.vigencia_fim ? (
                          dataBR(p.vigencia_fim)
                        ) : (
                          <span className="font-medium text-success">vigente</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.base_calculo === 'valor_fixo'
                          ? moeda(p.valor_fixo)
                          : percentual(p.percentual)}
                      </TableCell>
                      <TableCell className="text-sm">{ROTULO_BASE[p.base_calculo]}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {p.motivo ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Clientes atribuídos</CardTitle>
        </CardHeader>
        <CardContent>
          {atribuicoes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum visitante atribuído a este parceiro ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="hidden md:table-cell">Primeiro clique</TableHead>
                    <TableHead className="hidden lg:table-cell">Conversão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atribuicoes.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        {a.corretor_id ? (
                          <Link
                            to={`/admin/usuarios/${a.corretor_id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {a.corretor_nome ?? 'Ver conta'}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Visitante sem cadastro
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(COR_ATRIBUICAO[a.status])}>
                          {a.status}
                        </Badge>
                        {a.motivo_invalidacao && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {a.motivo_invalidacao}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {dataHoraBR(a.primeiro_clique_em)}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {a.convertido_em ? dataHoraBR(a.convertido_em) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <FormularioParceiro
        aberto={editando}
        aoFechar={() => setEditando(false)}
        parceiro={parceiro}
      />
      <DialogoPercentual
        aberto={novoPercentual}
        aoFechar={() => setNovoPercentual(false)}
        parceiroId={parceiro.id}
        vigenteAtual={vigente}
      />
      <DialogoNovoLink
        aberto={novoLink}
        aoFechar={() => setNovoLink(false)}
        parceiroId={parceiro.id}
        temPrincipal={links.some((l) => l.principal && !l.revogado_em)}
      />
      <DialogoConfirmacao
        aberto={!!revogando}
        aoFechar={() => setRevogando(null)}
        titulo="Revogar link?"
        descricao="O link para de atribuir novos cadastros imediatamente. As atribuições já feitas por ele são preservadas, e quem já converteu continua contando para este parceiro."
        rotuloConfirmar="Revogar"
        destrutivo
        aoConfirmar={async () => {
          if (revogando) await revogarLink.mutateAsync(revogando);
        }}
      />
    </>
  );
}

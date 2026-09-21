import { useMemo, useState } from 'react';
import { Download, FileText, Ban, CheckCircle2 } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { PaginacaoAdmin } from '@/components/admin/PaginacaoAdmin';
import { EstadoErro, EstadoVazio } from '@/components/admin/Estados';
import { DialogoConfirmacao } from '@/components/admin/DialogoConfirmacao';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useElegiveisRepasse, useGerarLote, useLotes, useLote,
  useMarcarLoteExportado, useMarcarLotePago, useCancelarLote,
} from '@/hooks/admin/useSaasDados';
import { ITENS_POR_PAGINA } from '@/hooks/admin/useAdminDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import {
  ROTULO_LOTE, COR_LOTE, TIPOS_CHAVE_PIX,
  resumoSelecao, podeSelecionar, motivoInelegivel,
  type StatusLote, type ParceiroElegivel,
} from '@/lib/admin/saas';
import { dataBR, moeda, numero } from '@/lib/formato';
import { montarCsv, baixarCsv, nomeArquivoCsv } from '@/lib/admin/csv';
import { cn } from '@/lib/utils';
import { paraISO } from '@/lib/admin/periodo';

const rotuloChave = (tipo: string | null) =>
  TIPOS_CHAVE_PIX.find((t) => t.valor === tipo)?.label ?? tipo ?? '—';

export default function AdminRepasses() {
  const [saldoMinimo, setSaldoMinimo] = useState<string>('');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(1);
  const [confirmarGeracao, setConfirmarGeracao] = useState(false);
  const [lotePagar, setLotePagar] = useState<string | null>(null);
  const [loteCancelar, setLoteCancelar] = useState<string | null>(null);
  const [loteAberto, setLoteAberto] = useState<string | null>(null);
  const [referencia, setReferencia] = useState('');
  const [pagoEm, setPagoEm] = useState(() => paraISO(new Date()));

  const { podeExecutar } = usePapeis();

  const minimoNumero = saldoMinimo.trim() === '' ? null : Number(saldoMinimo);
  const elegiveis = useElegiveisRepasse(
    Number.isFinite(minimoNumero) ? minimoNumero : null,
  );
  const lotes = useLotes({ pagina });
  const detalhe = useLote(loteAberto);

  const gerar = useGerarLote();
  const marcarExportado = useMarcarLoteExportado();
  const marcarPago = useMarcarLotePago();
  const cancelar = useCancelarLote();

  const itens: ParceiroElegivel[] = useMemo(
    () => elegiveis.data?.itens ?? [],
    [elegiveis.data],
  );
  const minimoAplicado = elegiveis.data?.saldo_minimo ?? 0;
  const selecionaveis = useMemo(() => itens.filter(podeSelecionar), [itens]);

  // Uma única fonte para os números do rodapé E para a conferência do CSV.
  const resumo = useMemo(
    () => resumoSelecao(itens, selecionados),
    [itens, selecionados],
  );

  const alternar = (id: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const todosMarcados =
    selecionaveis.length > 0 && selecionaveis.every((i) => selecionados.has(i.parceiro_id));

  const alternarTodos = () => {
    setSelecionados(
      todosMarcados ? new Set() : new Set(selecionaveis.map((i) => i.parceiro_id)),
    );
  };

  const exportarLote = (loteId: string) => {
    const d = detalhe.data;
    if (!d || d.lote.id !== loteId) return;
    baixarCsv(
      montarCsv(d.itens, [
        { cabecalho: 'Nome', valor: (i) => i.nome },
        { cabecalho: 'Documento', valor: (i) => i.documento },
        { cabecalho: 'Tipo da chave PIX', valor: (i) => rotuloChave(i.tipo_chave_pix) },
        { cabecalho: 'Chave PIX', valor: (i) => i.chave_pix },
        // Duas casas fixas: é o formato que o banco espera na importação e o
        // que faz a soma da planilha bater com o total do lote.
        { cabecalho: 'Valor', valor: (i) => i.valor.toFixed(2) },
        { cabecalho: 'Comissoes', valor: (i) => i.comissoes },
      ]),
      nomeArquivoCsv(`repasse-${d.lote.referencia}`),
    );
    if (d.lote.status === 'rascunho') marcarExportado.mutate(loteId);
  };

  return (
    <>
      <CabecalhoAdmin
        titulo="Repasses"
        descricao="Monta o lote de pagamento aos parceiros e exporta o arquivo para o banco. O PIX continua sendo feito por fora."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Repasses' }]}
      />

      <Tabs defaultValue="gerar">
        <TabsList className="mb-4">
          <TabsTrigger value="gerar">Gerar lote</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        {/* ── Geração ─────────────────────────────────────────────────── */}
        <TabsContent value="gerar">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="saldo-minimo" className="text-xs text-muted-foreground">
                Saldo mínimo
              </Label>
              <Input
                id="saldo-minimo"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className="w-full sm:w-[180px]"
                placeholder={moeda(minimoAplicado)}
                value={saldoMinimo}
                onChange={(e) => {
                  setSaldoMinimo(e.target.value);
                  setSelecionados(new Set());
                }}
              />
            </div>
            <p className="pb-2 text-sm text-muted-foreground">
              Mínimo aplicado: <strong>{moeda(minimoAplicado)}</strong>
              {elegiveis.data && elegiveis.data.hold_dias > 0 && (
                <>
                  {' · '}comissões liberadas após {numero(elegiveis.data.hold_dias)} dia(s)
                </>
              )}
            </p>
          </div>

          {elegiveis.error ? (
            <EstadoErro erro={elegiveis.error} aoTentarNovamente={() => void elegiveis.refetch()} />
          ) : elegiveis.isLoading ? (
            <Card>
              <CardContent className="space-y-3 py-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : itens.length === 0 ? (
            <EstadoVazio
              titulo="Nenhuma comissão aguardando repasse"
              descricao="Só entram no lote comissões aprovadas, de parceiros ativos e com chave PIX cadastrada, já fora do prazo de liberação."
            />
          ) : (
            <>
              <Card>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={todosMarcados}
                            onCheckedChange={alternarTodos}
                            aria-label="Selecionar todos os parceiros elegíveis"
                            disabled={selecionaveis.length === 0}
                          />
                        </TableHead>
                        <TableHead>Parceiro</TableHead>
                        <TableHead className="hidden lg:table-cell">Chave PIX</TableHead>
                        <TableHead className="text-right">Comissões</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itens.map((i) => {
                        const habilitado = podeSelecionar(i);
                        const motivo = motivoInelegivel(i, minimoAplicado);
                        return (
                          <TableRow
                            key={i.parceiro_id}
                            className={cn(!habilitado && 'opacity-60')}
                          >
                            <TableCell>
                              {habilitado ? (
                                <Checkbox
                                  checked={selecionados.has(i.parceiro_id)}
                                  onCheckedChange={() => alternar(i.parceiro_id)}
                                  aria-label={`Incluir ${i.nome} no lote`}
                                />
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span tabIndex={0} aria-label={motivo ?? 'Inelegível'}>
                                      <Ban className="h-4 w-4 text-muted-foreground" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{motivo}</TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell>
                              <p className="text-sm font-medium">{i.nome}</p>
                              <p className="text-xs text-muted-foreground">{i.email}</p>
                            </TableCell>
                            <TableCell className="hidden text-sm lg:table-cell">
                              {i.chave_pix ? (
                                <>
                                  <span className="block">{i.chave_pix}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {rotuloChave(i.tipo_chave_pix)}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">Sem chave</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {numero(i.comissoes)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {moeda(i.valor)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {numero(resumo.parceiros)} parceiro(s) · {numero(resumo.comissoes)} comissão(ões)
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{moeda(resumo.total)}</p>
                </div>
                <Button
                  disabled={resumo.parceiros === 0 || !podeExecutar('gerar_lote')}
                  onClick={() => setConfirmarGeracao(true)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Gerar lote
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Histórico ───────────────────────────────────────────────── */}
        <TabsContent value="historico">
          {lotes.error ? (
            <EstadoErro erro={lotes.error} aoTentarNovamente={() => void lotes.refetch()} />
          ) : lotes.isLoading ? (
            <Card>
              <CardContent className="space-y-3 py-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : (lotes.data?.itens.length ?? 0) === 0 ? (
            <EstadoVazio
              titulo="Nenhum lote gerado"
              descricao="Os lotes aparecem aqui depois da primeira geração, com o arquivo para o banco e a baixa do pagamento."
            />
          ) : (
            <>
              <Card>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Referência</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Parceiros</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="hidden lg:table-cell">Criado</TableHead>
                        <TableHead className="w-56" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(lotes.data?.itens ?? []).map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-mono text-sm">{l.referencia}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(COR_LOTE[l.status as StatusLote])}
                            >
                              {ROTULO_LOTE[l.status as StatusLote] ?? l.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {numero(l.total_parceiros)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {moeda(l.valor_total)}
                          </TableCell>
                          <TableCell className="hidden text-sm lg:table-cell">
                            {dataBR(l.criado_em)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {/* Abrir, nao exportar: o CSV depende do
                                  detalhe carregado, e um botao que so
                                  funciona no segundo clique parece quebrado.
                                  A exportacao vive no cartao de detalhe, onde
                                  os dados estao garantidos. */}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setLoteAberto(l.id)}
                              >
                                {loteAberto === l.id ? 'Aberto' : 'Abrir'}
                              </Button>
                              {l.status !== 'pago' && l.status !== 'cancelado' && (
                                <>
                                  {podeExecutar('marcar_lote_pago') && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setLotePagar(l.id);
                                        setReferencia('');
                                        setPagoEm(paraISO(new Date()));
                                      }}
                                    >
                                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                      Pago
                                    </Button>
                                  )}
                                  {podeExecutar('cancelar_lote') && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setLoteCancelar(l.id)}
                                    >
                                      Cancelar
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
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
                  total={lotes.data?.total ?? 0}
                  aoMudarPagina={setPagina}
                />
              </div>
            </>
          )}

          {/* Detalhe do lote selecionado, por parceiro — é como o PIX é feito. */}
          {loteAberto && detalhe.data && (
            <Card className="mt-6">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  Lote {detalhe.data.lote.referencia}
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => exportarLote(loteAberto)}>
                  <Download className="mr-2 h-4 w-4" />
                  Baixar CSV
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Parceiro</TableHead>
                        <TableHead>Chave PIX</TableHead>
                        <TableHead className="text-right">Comissões</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detalhe.data.itens.map((i) => (
                        <TableRow key={i.parceiro_id}>
                          <TableCell className="text-sm">{i.nome}</TableCell>
                          <TableCell className="text-sm">
                            {i.chave_pix}
                            <span className="block text-xs text-muted-foreground">
                              {rotuloChave(i.tipo_chave_pix)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {numero(i.comissoes)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {moeda(i.valor)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-4 text-right text-sm text-muted-foreground">
                  Total do lote:{' '}
                  <span className="text-base font-semibold text-foreground tabular-nums">
                    {moeda(detalhe.data.lote.valor_total)}
                  </span>
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <DialogoConfirmacao
        aberto={confirmarGeracao}
        aoFechar={() => setConfirmarGeracao(false)}
        titulo="Gerar lote de repasse?"
        descricao={`Serão incluídas ${numero(resumo.comissoes)} comissão(ões) de ${numero(
          resumo.parceiros,
        )} parceiro(s), somando ${moeda(
          resumo.total,
        )}. As comissões ficam reservadas ao lote e não entram em outro. Nenhum PIX é enviado agora.`}
        rotuloConfirmar="Gerar lote"
        aoConfirmar={async () => {
          await gerar.mutateAsync({
            parceiroIds: [...selecionados],
            saldoMinimo: minimoNumero,
          });
          setSelecionados(new Set());
        }}
      />

      <DialogoConfirmacao
        aberto={!!lotePagar}
        aoFechar={() => setLotePagar(null)}
        titulo="Marcar lote como pago?"
        descricao="Registra o repasse e marca as comissões do lote como pagas. Confirme apenas depois que o PIX tiver saído de fato — desfazer exige estorno individual."
        rotuloConfirmar="Confirmar pagamento"
        conteudoExtra={
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lote-pago-em">Data do pagamento</Label>
              <Input
                id="lote-pago-em"
                type="date"
                value={pagoEm}
                onChange={(e) => setPagoEm(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lote-referencia">Referência ou comprovante</Label>
              <Input
                id="lote-referencia"
                placeholder="ID da transferência, protocolo do banco…"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            </div>
          </div>
        }
        confirmarDesabilitado={referencia.trim().length < 3}
        aoConfirmar={async () => {
          if (!lotePagar) return;
          await marcarPago.mutateAsync({
            loteId: lotePagar,
            pagoEm,
            referencia: referencia.trim(),
          });
        }}
      />

      <DialogoConfirmacao
        aberto={!!loteCancelar}
        aoFechar={() => setLoteCancelar(null)}
        titulo="Cancelar lote?"
        descricao="As comissões voltam a ficar disponíveis para um novo lote. O lote fica registrado como cancelado, com o motivo."
        rotuloConfirmar="Cancelar lote"
        destrutivo
        exigirMotivo
        aoConfirmar={async (motivo) => {
          if (!loteCancelar) return;
          await cancelar.mutateAsync({ loteId: loteCancelar, motivo: motivo ?? '' });
        }}
      />
    </>
  );
}

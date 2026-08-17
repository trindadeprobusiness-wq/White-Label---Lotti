import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Users, Building2, UserPlus, TrendingUp, AlertTriangle, X, Eye,
  FileText, QrCode, Sparkles, ArrowRight, ExternalLink, MapPin, Scale,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/PageHeader';
import {
  SectionCard, MetricStrip, QuickActionRow, StatusBadge, Avatar, EmptyState,
} from '@/components/shell/primitivos';
import { useCRMStore } from '@/stores/crmStore';
import { FLAGS } from '@/lib/flags';
import { moeda, numero, dataBR } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { Alerta } from '@/types/crm';

const ROTA_FUNIL = FLAGS.crm ? '/crm' : '/funil';

function saudacao(agora = new Date()): string {
  const h = agora.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function primeiroNome(nome?: string | null): string {
  if (!nome?.trim()) return 'Corretor';
  return nome.trim().split(/\s+/)[0];
}

/**
 * Um imóvel está "incompleto" quando falta o que impede de anunciá-lo:
 * preço ou endereço. É um critério verificável nos dados — não um palpite —,
 * e é o mesmo usado no card de prioridades e na lista de atenção, para os dois
 * nunca discordarem.
 */
function cadastroIncompleto(imovel: { valor?: number | null; endereco?: string | null }) {
  return !imovel.valor || imovel.valor <= 0 || !imovel.endereco?.trim();
}

/**
 * Cor sólida por etapa, NÃO os tokens --funnel-*.
 *
 * Aqueles são fundos pastéis (ex.: 210 40% 96%), pensados para preencher a
 * coluna do kanban. Usados no círculo numerado com texto branco resultavam em
 * branco sobre quase-branco — o número sumia. Aqui a cor precisa ser forte o
 * bastante para o texto branco por cima ter contraste.
 */
const ETAPAS = [
  { chave: 'QUALIFICACAO', label: 'Qualificação', cor: 'bg-info' },
  { chave: 'VISITA_PROPOSTA', label: 'Visita/Proposta', cor: 'bg-warning' },
  { chave: 'DOCUMENTACAO', label: 'Documentação', cor: 'bg-doc' },
  { chave: 'FECHADO_GANHO', label: 'Fechamento', cor: 'bg-primary' },
] as const;

export default function Dashboard() {
  const {
    clientes, alertas, imoveis, corretor, loading,
    fetchCorretor, marcarAlertaLido,
  } = useCRMStore();
  const [alertaSelecionado, setAlertaSelecionado] = useState<Alerta | null>(null);

  useEffect(() => { fetchCorretor(); }, [fetchCorretor]);

  const alertasNaoLidos = useMemo(() => alertas.filter((a) => !a.lido), [alertas]);

  const contagemEtapas = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const e of ETAPAS) {
      mapa[e.chave] = clientes.filter((c) => c.status_funil === e.chave).length;
    }
    return mapa;
  }, [clientes]);

  const incompletos = useMemo(() => imoveis.filter(cadastroIncompleto), [imoveis]);

  const proximosContatos = useMemo(
    () =>
      [...clientes]
        .filter((c) => c.status_funil !== 'FECHADO_PERDIDO')
        .sort((a, b) => {
          // Quem tem follow-up marcado vem primeiro, do mais próximo ao mais
          // distante. Depois, quem está há mais tempo sem contato.
          const fa = a.proximo_followup ? new Date(a.proximo_followup).getTime() : Infinity;
          const fb = b.proximo_followup ? new Date(b.proximo_followup).getTime() : Infinity;
          if (fa !== fb) return fa - fb;
          const ua = a.ultimo_contato ? new Date(a.ultimo_contato).getTime() : 0;
          const ub = b.ultimo_contato ? new Date(b.ultimo_contato).getTime() : 0;
          return ua - ub;
        })
        .slice(0, 3),
    [clientes],
  );

  const imoveisAtencao = useMemo(
    () => [...incompletos, ...imoveis.filter((i) => !cadastroIncompleto(i))].slice(0, 3),
    [incompletos, imoveis],
  );

  const hoje = format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="animate-fade-in">
      <PageHeader
        titulo={`${saudacao()}, ${primeiroNome(corretor?.nome)}`}
        subtitulo={hoje.charAt(0).toUpperCase() + hoje.slice(1)}
        comBusca
        comUtilitarios
        acoes={
          <>
            <Button variant="outline" className="h-control" asChild>
              <Link to="/imoveis">
                <Building2 className="mr-2 h-[18px] w-[18px]" />
                Novo imóvel
              </Link>
            </Button>
            <Button className="h-control" asChild>
              <Link to="/clientes">
                <UserPlus className="mr-2 h-[18px] w-[18px]" />
                Novo cliente
              </Link>
            </Button>
          </>
        }
      />

      <MetricStrip
        carregando={loading}
        className="mb-5"
        itens={[
          {
            id: 'clientes',
            valor: numero(clientes.length),
            label: 'Clientes',
            icone: <Users className="h-5 w-5" />,
            tom: 'brand',
          },
          {
            id: 'imoveis',
            valor: numero(imoveis.length),
            label: 'Imóveis',
            icone: <Building2 className="h-5 w-5" />,
            tom: 'brand',
          },
          {
            id: 'leads',
            valor: numero(contagemEtapas.QUALIFICACAO ?? 0),
            label: 'Leads ativos',
            icone: <UserPlus className="h-5 w-5" />,
            tom: 'warning',
          },
          {
            id: 'vendas',
            valor: numero(contagemEtapas.FECHADO_GANHO ?? 0),
            label: 'Venda fechada',
            icone: <TrendingUp className="h-5 w-5" />,
            tom: 'success',
          },
        ]}
      />

      {alertasNaoLidos.length > 0 && (
        <SectionCard
          className="mb-5 border-destructive/40 bg-destructive-surface"
          titulo={
            <h2 className="flex items-center gap-2 text-section text-destructive">
              <AlertTriangle className="h-[18px] w-[18px]" />
              Ações críticas ({alertasNaoLidos.length})
            </h2>
          }
        >
          <div className="space-y-2">
            {alertasNaoLidos.slice(0, 4).map((alerta) => (
              <div
                key={alerta.id}
                className="group flex flex-col gap-2 rounded-lg border border-destructive/20 bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                {/* Sem truncate no mobile: numa linha só, a mensagem virava
                    "Contrato de loc..." e deixava de dizer o que é. Com a
                    ação embaixo, cabe em duas linhas. */}
                <p className="min-w-0 flex-1 text-sm font-medium sm:truncate">
                  {alerta.mensagem}
                </p>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setAlertaSelecionado(alerta)}>
                    <Eye className="mr-1.5 h-4 w-4" />
                    Detalhes
                  </Button>
                  {alerta.cliente_id && (
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/clientes/${alerta.cliente_id}`}>Ver cliente</Link>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => marcarAlertaLido(alerta.id)}
                    aria-label={`Dispensar alerta: ${alerta.mensagem}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <SectionCard titulo="Prioridades de hoje" semPadding>
          <div className="px-2 pb-3">
            <QuickActionRow
              tom="brand"
              icone={<Users className="h-[18px] w-[18px]" />}
              titulo="Leads aguardando avanço"
              descricao={
                (contagemEtapas.QUALIFICACAO ?? 0) > 0
                  ? `${numero(contagemEtapas.QUALIFICACAO)} leads na etapa de qualificação`
                  : 'Nenhum lead parado na qualificação'
              }
              acao={
                <Button variant="outline" size="sm" asChild>
                  <Link to={ROTA_FUNIL}>
                    Ver leads
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              }
            />
            <QuickActionRow
              tom="warning"
              icone={<FileText className="h-[18px] w-[18px]" />}
              titulo="Imóveis com cadastro incompleto"
              descricao={
                incompletos.length > 0
                  ? `${numero(incompletos.length)} sem preço ou endereço`
                  : 'Todos os cadastros estão completos'
              }
              acao={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/imoveis">
                    Completar cadastros
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              }
            />
            <QuickActionRow
              tom="doc"
              icone={<Scale className="h-[18px] w-[18px]" />}
              titulo="Documentos e contratos para revisar"
              descricao="Revise pendências e prazos importantes"
              acao={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/juridico">
                    Revisar
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              }
            />
          </div>
        </SectionCard>

        <SectionCard titulo="Atalhos rápidos" semPadding>
          <div className="px-2 pb-3">
            <QuickActionRow
              icone={<UserPlus className="h-[18px] w-[18px]" />}
              titulo="Adicionar cliente"
              href="/clientes"
            />
            <QuickActionRow
              icone={<Building2 className="h-[18px] w-[18px]" />}
              titulo="Cadastrar imóvel"
              href="/imoveis"
            />
            <QuickActionRow
              icone={<QrCode className="h-[18px] w-[18px]" />}
              titulo="Criar fachada"
              href="/fachadas"
            />
            <QuickActionRow
              icone={<Sparkles className="h-[18px] w-[18px]" />}
              titulo="Gerar contrato com IA"
              href="/juridico"
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        className="mb-5"
        titulo="Funil de vendas"
        acao={
          <Button variant="ghost" size="sm" asChild>
            <Link to={ROTA_FUNIL}>
              Abrir funil
              <ExternalLink className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-y-6 sm:grid-cols-4">
          {ETAPAS.map((etapa, i) => (
            <div key={etapa.chave} className="relative flex flex-col items-center text-center">
              {/* Conector pontilhado entre as etapas. Fica atrás do círculo e
                  some na última — e some também na coluna par do mobile, onde
                  a linha cairia no vazio da quebra. */}
              {i < ETAPAS.length - 1 && (
                <span
                  className={cn(
                    'absolute left-1/2 top-4 hidden h-px w-full border-t border-dashed border-border sm:block',
                    i % 2 === 1 && 'max-sm:hidden',
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  'relative z-10 flex h-8 w-8 items-center justify-center rounded-full',
                  'text-xs font-semibold text-primary-foreground',
                  etapa.cor,
                )}
              >
                {i + 1}
              </span>
              <p className="mt-2 text-sm text-muted-foreground">{etapa.label}</p>
              <p className="mt-1 text-kpi tabular text-foreground">
                {numero(contagemEtapas[etapa.chave] ?? 0)}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          titulo="Próximos contatos"
          acao={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/clientes">Ver todos</Link>
            </Button>
          }
          semPadding
        >
          {proximosContatos.length === 0 ? (
            <EmptyState
              icone={<Users className="h-6 w-6" />}
              titulo="Nenhum cliente cadastrado"
              descricao="Assim que você cadastrar clientes, os próximos contatos aparecem aqui."
              acao={
                <Button variant="outline" asChild>
                  <Link to="/clientes">Cadastrar cliente</Link>
                </Button>
              }
            />
          ) : (
            <ul className="px-2 pb-3">
              {proximosContatos.map((cliente) => (
                <li key={cliente.id}>
                  <Link
                    to={`/clientes/${cliente.id}`}
                    className="flex min-w-0 items-center gap-3.5 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-muted focus-ring"
                  >
                    <Avatar nome={cliente.nome} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {cliente.nome}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {cliente.telefone || cliente.email || 'Sem contato registrado'}
                      </span>
                    </span>
                    <StatusBadge tom="info">
                      {ETAPAS.find((e) => e.chave === cliente.status_funil)?.label ?? 'Qualificação'}
                    </StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          titulo="Imóveis que pedem atenção"
          acao={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/imoveis">Ver todos</Link>
            </Button>
          }
          semPadding
        >
          {imoveisAtencao.length === 0 ? (
            <EmptyState
              icone={<Building2 className="h-6 w-6" />}
              titulo="Nenhum imóvel cadastrado"
              descricao="Cadastre um imóvel para acompanhar o que ainda falta preencher."
              acao={
                <Button variant="outline" asChild>
                  <Link to="/imoveis">Cadastrar imóvel</Link>
                </Button>
              }
            />
          ) : (
            <ul className="px-2 pb-3">
              {imoveisAtencao.map((imovel) => {
                const incompleto = cadastroIncompleto(imovel);
                return (
                  <li key={imovel.id}>
                    <Link
                      to={`/imoveis/${imovel.id}`}
                      className="flex min-w-0 items-center gap-3.5 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-muted focus-ring"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-brand text-primary">
                        <Building2 className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {imovel.titulo || imovel.endereco || 'Imóvel sem título'}
                        </span>
                        <span className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {[imovel.cidade, imovel.valor ? moeda(imovel.valor, true) : null]
                            .filter(Boolean)
                            .join(' • ') || 'Sem localização'}
                        </span>
                      </span>
                      <StatusBadge tom={incompleto ? 'warning' : 'success'} comPonto>
                        {incompleto ? 'Dados incompletos' : 'Cadastro completo'}
                      </StatusBadge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <Dialog
        open={!!alertaSelecionado}
        onOpenChange={(aberto) => !aberto && setAlertaSelecionado(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Detalhes do alerta
            </DialogTitle>
            <DialogDescription>
              Revise as informações e tome a ação necessária.
            </DialogDescription>
          </DialogHeader>

          {alertaSelecionado && (
            <div className="space-y-3">
              <p className="text-sm">{alertaSelecionado.mensagem}</p>
              <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted p-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Tipo</dt>
                  <dd className="mt-0.5 text-sm">{alertaSelecionado.tipo ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Data</dt>
                  <dd className="mt-0.5 text-sm">{dataBR(alertaSelecionado.created_at)}</dd>
                </div>
              </dl>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAlertaSelecionado(null)}>
              Fechar
            </Button>
            {alertaSelecionado && (
              <Button
                onClick={() => {
                  marcarAlertaLido(alertaSelecionado.id);
                  setAlertaSelecionado(null);
                }}
              >
                Marcar como lido
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

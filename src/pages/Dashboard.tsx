import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Users, Building2, UserPlus, AlertTriangle, X, Eye,
  FileText, QrCode, Sparkles, ArrowRight, MapPin, Scale, MessageCircle,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DadoSensivel } from '@/components/ui/dado-sensivel';
import { mascararValoresNoTexto } from '@/lib/privacidade';
import { usePrivacidade } from '@/stores/privacidadeStore';
import {
  SectionCard, QuickActionRow, StatusBadge, Avatar, EmptyState,
} from '@/components/shell/primitivos';
import type { TomBadge } from '@/components/shell/primitivos';
import { useCRMStore } from '@/stores/crmStore';
import { useFachadas } from '@/hooks/useFachadas';
import { linkDoInbox } from '@/features/whatsapp-inbox/deepLink';
import { useConversasEsperando } from '@/hooks/useConversasEsperando';
import { contratosVencendo, tempoDeEspera } from '@/lib/inicio';
import { FLAGS } from '@/lib/flags';
import { moeda, numero, dataBR } from '@/lib/formato';
import type { Alerta } from '@/types/crm';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';

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
    clientes, alertas, imoveis, contratos, corretor, loading,
    fetchCorretor, marcarAlertaLido,
  } = useCRMStore();
  const [alertaSelecionado, setAlertaSelecionado] = useState<Alerta | null>(null);
  // Lead de fachada entra pelo QR do imóvel e não passa pelo funil até virar
  // cliente. Sem ele aqui, quem escaneou a placa some no meio dos follow-ups.
  const { leads: leadsFachada, fachadas, fetchLeads, fetchFachadas } = useFachadas();
  useEffect(() => { fetchLeads(); fetchFachadas(); }, [fetchLeads, fetchFachadas]);
  const { data: espera } = useConversasEsperando();

  const clientesReais = useMemo(() => clientes.filter((item) => !item.is_sample_data), [clientes]);
  const imoveisReais = useMemo(() => imoveis.filter((item) => !item.is_sample_data), [imoveis]);

  useEffect(() => { fetchCorretor(); }, [fetchCorretor]);

  const alertasNaoLidos = useMemo(() => alertas.filter((a) => !a.lido), [alertas]);
  // As acoes criticas repetem a mensagem do alerta, que ja vem do webhook
  // com o valor embutido no texto. Sem isto, o modo privado esconderia o
  // numero do cartao e o deixaria exposto na frase logo ao lado.
  const valoresOcultos = usePrivacidade((s) => s.valoresOcultos);
  const textoAlerta = (m: string) => (valoresOcultos ? mascararValoresNoTexto(m) : m);
  // Quatro contatos esbarrando no mesmo plano viravam quatro linhas idênticas,
  // e a tela parecia quatro problemas. É um só, com quatro afetados.
  const gruposDeAlerta = useMemo(() => {
    const porTexto = new Map<string, { texto: string; alertas: typeof alertasNaoLidos }>();
    for (const alerta of alertasNaoLidos) {
      const texto = textoAlerta(alerta.mensagem);
      const grupo = porTexto.get(texto) ?? { texto, alertas: [] };
      grupo.alertas.push(alerta);
      porTexto.set(texto, grupo);
    }
    return [...porTexto.values()];
  }, [alertasNaoLidos, valoresOcultos]);

  const contagemEtapas = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const e of ETAPAS) {
      mapa[e.chave] = clientesReais.filter((c) => c.status_funil === e.chave).length;
    }
    return mapa;
  }, [clientesReais]);

  const incompletos = useMemo(() => imoveisReais.filter(cadastroIncompleto), [imoveisReais]);
  const vencendo = useMemo(() => contratosVencendo(contratos), [contratos]);
  // De qual imóvel veio cada lead: "chegou pela fachada da Santos Dumont"
  // decide a ação; "Novo pelo QR" sozinho não diz nada.
  const imovelDaFachada = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const fachada of fachadas) {
      const nome = fachada.imovel?.titulo;
      if (nome) mapa.set(fachada.id, nome);
    }
    return mapa;
  }, [fachadas]);

  const proximosContatos = useMemo(
    () =>
      [...clientesReais]
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
    [clientesReais],
  );

  // Só entra quem tem pendência. Completar a lista com cadastro completo fazia
  // o bloco exibir "Cadastro completo" sob o título "pedem atenção".
  const imoveisAtencao = useMemo(() => incompletos.slice(0, 3), [incompletos]);

  const hoje = format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

  // A lista já ordenava pelo follow-up sem nunca mostrá-lo: não dava para saber
  // se o contato estava atrasado, que é justamente o que decide a ação.
  const followup = (iso?: string | null): { texto: string; tom: TomBadge } | null => {
    if (!iso) return null;
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) return null;
    const zerar = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dias = Math.round((zerar(data) - zerar(new Date())) / 86_400_000);
    if (dias < 0) return { texto: `Atrasado ${Math.abs(dias)}d`, tom: 'destructive' };
    if (dias === 0) return { texto: 'Contato hoje', tom: 'warning' };
    return { texto: format(data, "d 'de' MMM", { locale: ptBR }), tom: 'info' };
  };

  // Uma fila só de quem espera resposta: primeiro quem chegou pelo QR e ainda
  // não virou cliente, depois o follow-up marcado — do mais atrasado ao mais
  // distante. Eram dois blocos concorrendo pela mesma decisão.
  const esperandoResposta = useMemo(() => {
    const doQr = leadsFachada
      .filter((lead) => !lead.convertido)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((lead) => {
        const origem = imovelDaFachada.get(lead.fachada_id);
        const espera = tempoDeEspera(lead.created_at);
        return {
          id: `lead-${lead.id}`,
          nome: lead.nome,
          contato: [origem ? `QR · ${origem}` : 'QR da fachada', lead.telefone].filter(Boolean).join(' · '),
          href: linkDoInbox(lead.telefone),
          selo: { texto: espera ? `Espera ${espera}` : 'Novo pelo QR', tom: 'brand' as TomBadge },
        };
      });

    const comFollowup = proximosContatos.map((cliente) => {
      const prazo = followup(cliente.proximo_followup);
      return {
        id: `cliente-${cliente.id}`,
        nome: cliente.nome,
        contato: cliente.telefone || cliente.email || 'Sem contato registrado',
        href: linkDoInbox(cliente.telefone),
        selo: prazo ?? {
          texto: ETAPAS.find((e) => e.chave === cliente.status_funil)?.label ?? 'Qualificação',
          tom: 'neutro' as TomBadge,
        },
      };
    });

    return [...doQr, ...comFollowup].slice(0, 5);
  }, [leadsFachada, proximosContatos, imovelDaFachada]);

  return (
    <div className="animate-fade-in">
      {/* Cabeçalho de verdade no lugar da antiga barra de ferramentas, que
          só levava três ícones e deixava o topo parecendo vazio. A saudação e
          a data já existiam no código e nunca chegavam à tela. */}
      <header className="mb-5">
        <p className="text-group uppercase text-muted-strong">Hoje</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          {saudacao()}, {primeiroNome(corretor?.nome)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {hoje.charAt(0).toUpperCase() + hoje.slice(1)} · o que precisa de você agora.
        </p>
      </header>

      <OnboardingChecklist />

      {alertasNaoLidos.length > 0 && (
        <SectionCard
          className="mb-5 border-destructive/25"
          titulo={
            <h2 className="flex items-center gap-2 text-section text-destructive">
              <AlertTriangle className="h-[18px] w-[18px]" />
              Ações críticas ({alertasNaoLidos.length})
            </h2>
          }
        >
          <ul className="-my-1">
            {gruposDeAlerta.slice(0, 4).map((grupo) => {
              const primeiro = grupo.alertas[0];
              // Só faz sentido abrir um cliente quando o grupo tem um só.
              const clienteUnico = grupo.alertas.length === 1 ? primeiro.cliente_id : undefined;
              return <li key={grupo.texto} className="flex items-center gap-3 border-b border-border/60 py-2 last:border-0">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                <p className="min-w-0 flex-1 truncate text-sm">
                  {grupo.texto}
                  {grupo.alertas.length > 1 && <span className="ml-2 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">{grupo.alertas.length}</span>}
                </p>
                <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => setAlertaSelecionado(primeiro)}>
                  <Eye className="mr-1.5 h-4 w-4" />
                  Detalhes
                </Button>
                {clienteUnico && (
                  <Button variant="ghost" size="sm" className="shrink-0 text-primary" asChild>
                    <Link to={`/clientes/${clienteUnico}`}>Ver cliente</Link>
                  </Button>
                )}
              </li>;
            })}
          </ul>
        </SectionCard>
      )}

      <div id="prioridades-do-dia" className="mb-5 grid scroll-mt-5 gap-5 lg:grid-cols-[1.35fr_1fr]">
        <SectionCard titulo="Prioridades de hoje" semPadding>
          <div className="px-2 pb-3">
            {/* Atendimento vem primeiro: é o que tem alguém do outro lado
                esperando agora. A conta é a mesma do Inbox. */}
            {!!espera?.esperando && (
              <QuickActionRow
                tom="warning"
                icone={<MessageCircle className="h-[18px] w-[18px]" />}
                titulo="Conversas esperando resposta"
                descricao={
                  espera.urgentes
                    ? `${numero(espera.esperando)} sem resposta · ${numero(espera.urgentes)} há mais de 1 h`
                    : `${numero(espera.esperando)} sem resposta`
                }
                acao={
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/whatsapp">
                      Responder
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                }
              />
            )}
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
            {!!vencendo.length && (
              <QuickActionRow
                tom="doc"
                icone={<Scale className="h-[18px] w-[18px]" />}
                titulo="Contratos perto do fim da vigência"
                descricao={`${numero(vencendo.length)} nos próximos 60 dias`}
                acao={
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/juridico">
                      Revisar
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                }
              />
            )}
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
            <QuickActionRow
              icone={<Scale className="h-[18px] w-[18px]" />}
              titulo="Revisar documentos e contratos"
              href="/juridico"
            />
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          titulo="Quem espera resposta"
          acao={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/clientes">Ver todos</Link>
            </Button>
          }
          semPadding
        >
          {esperandoResposta.length === 0 ? (
            <EmptyState
              icone={<Users className="h-6 w-6" />}
              titulo="Ninguém esperando"
              descricao="Leads que chegarem pelo QR da fachada e contatos com follow-up marcado aparecem aqui."
              acao={
                <Button variant="outline" asChild>
                  <Link to="/fachadas">Criar fachada</Link>
                </Button>
              }
            />
          ) : (
            <ul className="px-2 pb-3">
              {esperandoResposta.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.href}
                    className="flex min-w-0 items-center gap-3.5 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-muted focus-ring"
                  >
                    <Avatar nome={item.nome} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.nome}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {item.contato}
                      </span>
                    </span>
                    <StatusBadge tom={item.selo.tom} comPonto>{item.selo.texto}</StatusBadge>
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
                          <span className="truncate">{imovel.cidade || 'Sem localização'}</span>
                          {imovel.valor > 0 && (
                            <>
                              <span aria-hidden="true">•</span>
                              <DadoSensivel valor={moeda(imovel.valor, true)} tipo="valor" />
                            </>
                          )}
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
              <p className="text-sm">{textoAlerta(alertaSelecionado.mensagem)}</p>
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

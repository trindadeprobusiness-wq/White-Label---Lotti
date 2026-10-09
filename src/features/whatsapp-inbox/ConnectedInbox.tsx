import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Bot, FileText, Filter, Menu, MessageCircle, Pause, Pencil, Play, Plus, Search, Sparkles, Timer, UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { conversationTitle, formatContactPhone, filterLiveConversations, latestByConversation, liveUrgency, type LatestMessage, type QuickFilter } from './liveInboxFilters';
import { MessageComposer } from './MessageComposer';
import { ConversationStatusDialog, NewConversationDialog, RenameContactDialog } from './InboxActionDialogs';
import { optOutState, type OptOutState } from './optOut';
import { STATUS_FUNIL_LABELS, type StatusFunil } from '@/types/crm';
import { useCRMStore } from '@/stores/crmStore';
import { crmKeys } from '@/hooks/crm/useCrm';
import { FLAGS } from '@/lib/flags';
import { EtapaDoFunil } from './EtapaDoFunil';
import { codigoDoErro, registroDoErro } from '@/lib/crm/duplicidade';
import { functionErrorCode, mergeErrorText, renameErrorText, startErrorText } from './inboxRequests';
import { mesmoTelefone } from './deepLink';
import { temperaturaLegivel, valorLegivel, type Temperatura } from './qualificacaoLegivel';
import { ENVIO_SEM_CONFIRMACAO, ESPERA_DA_IA, MOTIVO_DA_PARADA, estadoDaIa, quandoAIaVolta, rotuloDaIa } from './estadoDaIa';
import { apiDisponivel } from '@/lib/api';
import { toast } from 'sonner';
import { obterClienteApi } from '@/lib/api/crm';
import { baixarInboxApi } from '@/lib/api/arquivos';
import { CartaoChamada, ehAudio, ehChamada, PlayerAudio } from './MidiaDaConversa';
import { atualizarContatoApi, contarConversasApi, eventosApi, limparOptOutApi, listarConversasApi, mensagensApi, mesclarConversasApi, modoApi, reconciliarApi, statusConversaApi, ultimasMensagensApi, whatsappBridgeApi } from '@/lib/api/whatsapp';

type ClienteDaConversa = { nome: string; email: string | null; telefone: string; created_at: string | null; status_funil: string; tipo_interesse: string };

// Additive runtime tables have separate typed projections until schema regeneration.
const db = supabase as unknown as SupabaseClient;
type Qualification = { stage?: string; temperature?: string; priority?: string; reason?: string; profile?: Record<string, string | null> };
type Conversation = { id: string; phone: string | null; contact_name?: string | null; clientes?: { nome: string } | null; cliente_id: string | null; mode: 'ai' | 'human' | 'paused'; status: 'open' | 'closed'; updated_at: string; qualification: Qualification; last_error: string | null; opted_out_at?: string | null; pausa_ia_ate?: string | null; closed_by?: string | null; closed_at?: string | null; closed_reason?: string | null; last_message_at?: string | null };
const CONVERSATION_FIELDS = 'id,phone,cliente_id,mode,status,updated_at,qualification,last_error,clientes(nome)';
// Como no Clix: o Inbox abre nas Abertas; Fechadas é o outro lado do botão. Fechar não pausa a IA e a
// conversa volta sozinha para as Abertas quando o cliente escreve (gatilho no banco).
type StatusLista = 'open' | 'closed';
/** Quem fechou (closed_by): vendedor pelo botão, cliente quando ele encerrou e a IA fechou (como no Clix), silêncio do acompanhamento. */
const FECHADA_POR: Record<string, string> = { humano: 'Vendedor', silencio: 'Sem resposta', ia: 'IA', cliente: 'Cliente pediu' };
const porQuem = (valor?: string | null) => (valor && FECHADA_POR[valor] ? ` · ${FECHADA_POR[valor]}` : '');
// Archived conversations belong to a WhatsApp number that is no longer connected.
async function fetchConversations(status: StatusLista) {
  if (apiDisponivel()) return listarConversasApi<Conversation>(status);
  const recent = (fields: string, scoped: boolean) => {
    let query = db.from('lotti_agent_conversations').select(fields).eq('status', status);
    if (scoped) query = query.is('archived_at', null);
    return query.order('updated_at', { ascending: false }).limit(100);
  };
  let { data, error } = await recent(`${CONVERSATION_FIELDS},contact_name,opted_out_at,pausa_ia_ate`, true);
  // `pausa_ia_ate` é a coluna mais nova: banco sem ela cai no degrau seguinte.
  if (error?.code === '42703') ({ data, error } = await recent(`${CONVERSATION_FIELDS},contact_name,opted_out_at`, true));
  // Each migration adds columns; older databases fall back one step at a time.
  if (error?.code === '42703') ({ data, error } = await recent(`${CONVERSATION_FIELDS},contact_name`, true));
  if (error?.code === '42703') ({ data, error } = await recent(CONVERSATION_FIELDS, false));
  if (error) throw error;
  return data as unknown as Conversation[];
}
type Message = { id: string; direction: 'in' | 'out'; sender: 'lead' | 'human' | 'ai'; content: string; media_path: string | null; created_at: string; preview_kind?: 'file' | 'audio' };
type InboxEvent = { id: string; kind: 'mode' | 'stage' | 'status' | 'consent' | 'pausa'; from_label: string | null; to_label: string; subject_label: string | null; actor_label: string; created_at: string };
function eventText(event: InboxEvent) {
  if (event.kind === 'consent') return event.to_label === 'Contato liberado' ? `Contato liberado por ${event.actor_label}` : 'Contato pediu para não receber mensagens';
  if (event.kind === 'status') return `Conversa ${event.to_label === 'Fechada' ? 'fechada' : 'reaberta'} por ${event.actor_label}`;
  if (event.kind === 'pausa') return 'IA em espera porque a equipe respondeu pelo WhatsApp';
  if (event.kind === 'mode') return `${event.to_label === 'IA' ? 'IA ligada' : event.to_label === 'Pausada' ? 'IA pausada' : 'IA desligada'} por ${event.actor_label}`;
  const doCadastro = (rotulo: string | null) => rotulo && rotulo in STATUS_FUNIL_LABELS ? STATUS_FUNIL_LABELS[rotulo as StatusFunil] : null;
  if (!event.subject_label && doCadastro(event.to_label)) return `Status do cadastro mudou de ${doCadastro(event.from_label) ?? 'sem status'} para ${doCadastro(event.to_label)} por ${event.actor_label}`;
  return `${event.subject_label ? `Negócio ${event.subject_label} movido` : 'Movido'} de ${event.from_label || 'sem etapa'} para ${event.to_label} por ${event.actor_label}`;
}
// A IA parou porque alguém da equipe respondeu (banco: lotti_inbox_record_mode/lotti_inbox_record_pausa).
// Como no Clix: ícone de pausa e o que importa em negrito. Pelo celular o WhatsApp não diz quem do time
// respondeu, por isso "a equipe".
function eventoComMotivo(event: InboxEvent): React.ReactNode {
  const forte = (texto: string) => <strong className="font-semibold text-foreground">{texto}</strong>;
  if (event.kind === 'pausa') return <>IA {forte('em espera')} porque a equipe respondeu pelo WhatsApp</>;
  if (event.kind === 'mode' && event.subject_label === 'assumiu_inbox') return <>IA {forte('desligada')}: {forte(event.actor_label)} assumiu a conversa</>;
  if (event.kind === 'mode' && event.subject_label === 'respondeu_whatsapp') return <>IA {forte('desligada')} porque a equipe respondeu pelo WhatsApp</>;
  return null;
}
function OptOutNotice({ state, since, pending, failed, onRelease }: { state: Exclude<OptOutState, 'none'>; since: string; pending: boolean; failed: boolean; onRelease: () => void }) {
  return <div role="status" className="shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    <p><strong>Contato pediu para não receber mensagens</strong> em {new Date(since).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: inboxTimeZone })}. {state === 'blocked' ? 'Você pode responder quando ele escrever de novo.' : 'Ele voltou a escrever, então você pode responder. A IA continua desligada.'}</p>
    <p className="mt-1"><button type="button" disabled={pending} onClick={onRelease} className="font-semibold underline disabled:opacity-50">Liberar contato</button> <span className="text-amber-800/80">— use se foi engano ou se ele pediu para voltar a receber.</span></p>
    {failed && <p role="alert" className="mt-1 text-destructive">Não foi possível liberar o contato. Tente novamente.</p>}
  </div>;
}
function ContactAvatar({ name, className }: { name: string; className: string }) {
  const initial = name.trim().match(/^\p{L}/u)?.[0].toLocaleUpperCase('pt-BR');
  return <span aria-label={initial ? `Inicial de ${name}` : 'Contato sem nome'} className={className}>{initial || <UserRound className="h-4 w-4" />}</span>;
}
const contactPhoneLabel = (value: string | null) => (value ? formatContactPhone(value) : 'Número oculto pelo WhatsApp');
// Antes o link só aparecia se o arquivo já tivesse sido buscado com sucesso; quando a busca
// falhava, ficava só o nome, sem explicação. Agora o botão busca na hora do clique e diz
// claramente quando o arquivo não foi salvo.
function BaixarArquivo({ nome, caminho, urlPronta }: { nome: string; caminho: string | null; urlPronta: string }) {
  const [estado, setEstado] = useState<'pronto' | 'baixando' | 'indisponivel'>('pronto');
  if (!caminho || caminho.split('/').length < 3) return <span className="shrink-0 text-[11px] opacity-75">Arquivo indisponível</span>;
  const baixar = async () => {
    setEstado('baixando');
    try {
      let href = urlPronta;
      let temporaria = false;
      if (!href) {
        if (apiDisponivel()) { href = await baixarInboxApi('lotti-inbox-files', caminho); temporaria = true; }
        else {
          const { data } = await supabase.storage.from('lotti-inbox-files').createSignedUrl(caminho, 3600, { download: nome });
          href = data?.signedUrl ?? '';
        }
      }
      if (!href) throw new Error('sem_url');
      const a = document.createElement('a');
      a.href = href; a.download = nome; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      if (temporaria) window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setEstado('pronto');
    } catch {
      setEstado('indisponivel');
    }
  };
  if (estado === 'indisponivel') return <span className="shrink-0 text-[11px] opacity-75">Arquivo indisponível</span>;
  return <button type="button" onClick={() => void baixar()} disabled={estado === 'baixando'}
    className="shrink-0 rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-white/15 disabled:opacity-60">
    {estado === 'baixando' ? 'Baixando…' : 'Baixar'}
  </button>;
}
function MessageBody({ message }: { message: Message }) {
  const [url, setUrl] = useState('');
  // Áudio e ligação vêm antes do arquivo: o áudio recebido também tem media_path com 3 partes.
  const isAudio = message.preview_kind === 'audio' || ehAudio(message.content);
  const isCall = !isAudio && ehChamada(message.content);
  // Foto, vídeo ou documento recebidos: com o arquivo guardado (media_path) ou só com o texto
  // ("📷 Foto", "📄 nome") enquanto a mídia não foi recuperada — aí o cartão avisa que não está aqui.
  const semArquivo = !message.media_path && /^(📷 Foto|🎥 Vídeo|📄 )/u.test(message.content);
  const isFile = !isAudio && !isCall && (message.preview_kind === 'file' || (!!message.media_path && message.media_path.split('/').length >= 3) || semArquivo);
  useEffect(() => {
    if (!isFile || !message.media_path || message.preview_kind) return;
    let live = true;
    // Com a API ligada, baixa do Garage pela API (token no cabeçalho) como object URL,
    // revogada no cleanup. Sem a API, segue a signed URL do Supabase, renovada em ciclo.
    if (apiDisponivel()) {
      let objetoUrl = '';
      baixarInboxApi('lotti-inbox-files', message.media_path)
        .then((u) => { if (live) { objetoUrl = u; setUrl(u); } else { URL.revokeObjectURL(u); } })
        .catch(() => { if (live) setUrl(''); });
      return () => { live = false; if (objetoUrl) URL.revokeObjectURL(objetoUrl); };
    }
    const refresh = () => {
      void supabase.storage.from('lotti-inbox-files').createSignedUrl(message.media_path!, 3600)
        .then(({ data }) => { if (live) setUrl(data?.signedUrl || ''); })
        .catch(() => { if (live) setUrl(''); });
    };
    refresh();
    const timer = window.setInterval(refresh, 50 * 60 * 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [isFile, message.media_path, message.preview_kind]);
  if (isAudio) return <PlayerAudio caminho={message.preview_kind ? null : message.media_path} />;
  if (isCall) return <CartaoChamada texto={message.content} direcao={message.direction} />;
  if (!isFile) return <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.4]">{message.content}</p>;
  // A extensão vem do arquivo guardado ("…/foto.jpg"): o texto da foto recebida é só "📷 Foto", e
  // por isso ela aparecia como cartão de arquivo em vez de imagem.
  const nomeGuardado = message.media_path && !message.preview_kind ? message.media_path.split('/').pop() ?? '' : '';
  const extension = (nomeGuardado || message.content).match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  const tipo = message.content.startsWith('📷') ? 'Foto' : message.content.startsWith('🎥') ? 'Vídeo' : 'Arquivo';
  const nomeVisivel = message.content.replace(/^(📷 |🎥 |📄 )/u, '');
  // Foto virava cartão de arquivo, como se fosse planilha: para ver, era preciso
  // baixar. Com a URL assinada em mãos, ela aparece na conversa.
  // Como no Clix: moldura de tamanho fixo e a imagem inteira dentro dela (object-contain). Com
  // object-cover a foto em pé do celular era cortada e o balão mudava de tamanho a cada foto.
  const moldura = `flex h-[300px] w-[280px] max-w-full items-center justify-center overflow-hidden rounded-[10px] ${message.direction === 'out' ? 'bg-white/15' : 'bg-[#eef0f4]'}`;
  if (url && ['JPG', 'JPEG', 'PNG', 'WEBP', 'GIF'].includes(extension ?? '')) {
    return <a href={url} target="_blank" rel="noopener noreferrer" className={moldura}>
      <img src={url} alt={nomeVisivel} loading="lazy" className="max-h-full max-w-full object-contain" />
    </a>;
  }
  if (url && ['MP4', 'MOV', 'WEBM', '3GP'].includes(extension ?? '')) {
    return <div className={moldura}><video src={url} controls preload="metadata" aria-label={nomeVisivel} className="max-h-full max-w-full bg-black" /></div>;
  }
  return <div className="flex min-w-[180px] max-w-full items-center gap-2.5 rounded-lg border border-current/20 bg-white/10 px-3 py-2.5 text-sm">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15"><FileText className="h-5 w-5" /></span>
    <span className="min-w-0 flex-1"><span className="block text-[10px] font-medium opacity-75">{tipo}{extension ? ` ${extension}` : ''}</span>
      <span className="block break-all font-medium">{nomeVisivel}</span>
    </span>
    <BaixarArquivo nome={nomeGuardado || nomeVisivel} caminho={message.media_path} urlPronta={url} />
  </div>;
}
// Cada bloco do painel inventava o seu espaçamento (mt-2.5, mt-4, mt-5) e o seu
// tamanho de título. Com a remoção dos campos que não funcionavam, o que sobrou
// ficou sem ritmo. Uma seção só, usada por todos.
/**
 * Linha do tempo do contato.
 *
 * O fio entre as bolinhas ia de `top-3` até `bottom-0` do próprio item:
 * começava em cima da primeira bolinha e parava 14px antes da seguinte,
 * deixando um pedaço solto no ar — foi o que o corretor viu como defeito.
 *
 * A ordem é do mais antigo para o mais novo: "Lead criado" depois de uma
 * conversa de ontem lia-se como se o lead tivesse nascido hoje.
 */
function LinhaDoTempo({ eventos }: { eventos: { titulo: string; quando?: string | null }[] }) {
  const lista = eventos
    .map((evento) => ({ ...evento, instante: evento.quando ? Date.parse(evento.quando) : NaN }))
    .filter((evento) => Number.isFinite(evento.instante))
    .sort((a, b) => a.instante - b.instante);
  if (!lista.length) return <p className="text-[11px] text-muted-foreground">Sem eventos ainda.</p>;

  return <ol>
    {lista.map((evento, indice) => <li key={evento.titulo} className="relative flex gap-2.5">
      {/* O fio nasce onde a bolinha acaba (mt-1.5 + 7px de altura = 13px) e
          desce 6px além do item, que é exatamente o mt-1.5 da bolinha
          seguinte. Antes ia de `top-3` a `bottom-0`: cobria o pé da primeira
          bolinha e parava 14px antes da outra, no vazio. */}
      {indice < lista.length - 1 && <span aria-hidden="true" className="absolute -bottom-1.5 left-[3px] top-[13px] w-px bg-border" />}
      <span aria-hidden="true" className="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-primary" />
      <div className={`min-w-0 ${indice < lista.length - 1 ? 'pb-4' : ''}`}>
        <strong className="block text-[11px] font-medium leading-tight text-foreground">{evento.titulo}</strong>
        <time dateTime={evento.quando ?? undefined} className="text-[11px] text-muted-foreground">
          {new Date(evento.instante).toLocaleString('pt-BR')}
        </time>
      </div>
    </li>)}
  </ol>;
}

function SecaoPerfil({ titulo, acessorio, children }: { titulo: string; acessorio?: React.ReactNode; children: React.ReactNode }) {
  // Seções separadas por uma linha fina, sem caixa em volta de cada uma: com um quadro por bloco o
  // painel virava uma pilha de caixas grandes.
  return <section className="border-t py-4 first:border-t-0">
    <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}{acessorio && <span className="ml-auto">{acessorio}</span>}</h3>
    <div className="mt-2.5 space-y-2.5">{children}</div>
  </section>;
}

function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === 'out';
  return <article className={`w-fit max-w-[78%] rounded-[15px] px-3 py-1.5 text-[14px] leading-[1.4] shadow-[0_5px_16px_rgba(16,19,31,0.08)] ${outbound ? 'ml-auto rounded-tr-[4px] bg-primary text-primary-foreground' : 'rounded-tl-[4px] border border-[#e9ebf3] bg-white text-[#10131f]'}`}>
    <p className={`mb-1 text-[11px] font-medium ${outbound ? 'text-primary-foreground/75' : 'text-[#929aae]'}`}>{message.sender === 'ai' ? 'Lotti IA' : message.sender === 'human' ? 'Corretor' : 'Cliente'}</p>
    <MessageBody message={message} />
    <time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString('pt-BR', { timeZone: inboxTimeZone })} className={`mt-1 block text-right text-[10px] ${outbound ? 'text-primary-foreground/75' : 'text-[#929aae]'}`}>
      {new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: inboxTimeZone })}
    </time>
  </article>;
}
// O banco registra por que a conversa saiu do automático. Até aqui os cinco
// motivos viravam a mesma frase genérica, escondida no painel do contato: o
// corretor via a IA desligar sozinha e concluía que era defeito.

const stages: Record<string, string> = { pre_qualificacao: 'Pré-qualificação', qualificando: 'Em qualificação', qualificado_busca: 'Qualificado para busca', qualificado_visita: 'Qualificado para visita' };
const labels: Record<string, string> = { intent: 'Interesse', region: 'Região', budget: 'Orçamento', needs: 'Essenciais', nextStep: 'Próximo passo', timeframe: 'Prazo', payment: 'Pagamento', communication: 'Preferência de conversa' };
const inboxTimeZone = 'America/Sao_Paulo';
const CHAVE_CONVERSA_ABERTA = 'lotti:inbox:conversa-aberta';
const TOM_TEMPERATURA: Record<Temperatura['tom'], string> = {
  frio: 'bg-sky-50 text-sky-700',
  morno: 'bg-amber-50 text-amber-700',
  quente: 'bg-rose-50 text-rose-700',
  neutro: 'bg-muted text-muted-foreground',
};
function listTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: inboxTimeZone });
  if (day(date) === day(new Date())) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: inboxTimeZone });
  return date.toLocaleDateString('pt-BR', { timeZone: inboxTimeZone });
}

export default function ConnectedInbox({ connected = true, preview = false }: { connected?: boolean | 'unknown'; preview?: boolean }) {
  const { user } = useAuth();
  const demoTime = new Date().toISOString();
  const demoConversation: Conversation = { id: 'preview-conversation', phone: '5511999990000', contact_name: 'Rafael', cliente_id: null, mode: 'ai', status: 'open', updated_at: demoTime, qualification: { stage: 'qualificando', reason: 'Cliente procura um imóvel para comprar.' }, last_error: null };
  const cache = useQueryClient();
  // A conversa aberta sobrevive a sair da aba e voltar. Era estado local puro:
  // ao remontar, sumia, e `selected` caía em `filtered[0]` — a primeira da
  // lista, não a que o corretor estava lendo. sessionStorage é por aba do
  // navegador e some ao fechar, que é o tamanho certo de memória para isso.
  const [selectedId, setSelectedIdState] = useState<string | undefined>(() => {
    if (preview) return undefined;
    try { return sessionStorage.getItem(CHAVE_CONVERSA_ABERTA) ?? undefined; } catch { return undefined; }
  });
  const setSelectedId = useCallback((id: string | undefined) => {
    setSelectedIdState(id);
    if (preview || !id) return;
    try { sessionStorage.setItem(CHAVE_CONVERSA_ABERTA, id); } catch { /* armazenamento bloqueado: segue sem lembrar */ }
  }, [preview]);
  // Vir do funil ou do cadastro e cair na lista genérica obrigava a procurar
  // de novo quem você acabou de clicar. Com ?cliente= ou ?telefone= a conversa
  // já abre selecionada — uma vez só, para não brigar com quem troca de
  // conversa depois.
  const [parametrosDaUrl] = useSearchParams();
  const clienteNaUrl = parametrosDaUrl.get('cliente');
  const telefoneNaUrl = parametrosDaUrl.get('telefone');
  const alvoAplicado = useRef(false);
  // No celular a lista vira gaveta, como no Clix: a conversa ocupa a tela e a
  // lista desliza por cima. Empilhada, era preciso rolar dezenas de conversas
  // para alcançar a mensagem.
  const [listaAberta, setListaAberta] = useState(false);
  const limparFiltros = () => { setQuery(''); setQuick('all'); setModeFilter(''); setStageFilter(''); setPeriodFilter(''); setStatusLista('open'); };
  // /whatsapp?telefone=... abre direto no chat de quem veio da tela inicial.
  // Só vale enquanto ninguém escolheu outra conversa na lista.
  const telefoneAlvo = new URLSearchParams(useLocation().search).get('telefone');
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modeFilter, setModeFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [statusLista, setStatusLista] = useState<StatusLista>('open');
  // Link do funil para uma conversa que está fechada: troca para Fechadas uma vez e acha lá.
  const tentouFechadas = useRef(false);
  const [infoVisible, setInfoVisible] = useState(() => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 1536px)').matches);
  const [newOpen,setNewOpen]=useState(false),[renameOpen,setRenameOpen]=useState(false),[statusOpen,setStatusOpen]=useState(false);
  // Last "Nova conversa" outcome per request_id (the dialog keeps the id while it is unknown)
  // and a one-line notice for the open conversation (unconfirmed send, relinked client).
  const [startOutcome,setStartOutcome]=useState<{requestId:string;status:string}>();
  const [notice,setNotice]=useState<{id:string;text:string}>();
  const list = useQuery({
    // Na prévia a lista é uma só (filtrada aqui); de verdade, cada lado do botão é uma consulta.
    queryKey: preview ? ['lotti-agent-conversations', user?.id, true] : ['lotti-agent-conversations', user?.id, false, statusLista],
    enabled: !!user && !preview, refetchInterval: preview ? false : 3000,
    queryFn: () => fetchConversations(statusLista),
    // Trocar Abertas/Fechadas não pode apagar a tela enquanto a outra lista chega.
    placeholderData: (anterior) => anterior,
    initialData: preview ? [demoConversation] : undefined,
  });
  // A lista do outro lado vem por trás, mais devagar: clicar em Fechadas mostrava a tela parada até a
  // consulta voltar.
  const outroLado: StatusLista = statusLista === 'open' ? 'closed' : 'open';
  const outraLista = useQuery({
    queryKey: ['lotti-agent-conversations', user?.id, false, outroLado],
    enabled: !!user && !preview, refetchInterval: preview ? false : 15000,
    queryFn: () => fetchConversations(outroLado),
  });
  // A lista traz no máximo 100 conversas, e o rodapé dizia "100 de 100" mesmo
  // com 104 existindo: o denominador era o tamanho da página, não o total.
  // Contagem à parte, sem trazer linha nenhuma.
  const totalDeConversas = useQuery({
    queryKey: ['lotti-agent-conversation-count', user?.id, preview], enabled: !!user && !preview, refetchInterval: preview ? false : 30000,
    queryFn: async (): Promise<{ total: number; abertas?: number; fechadas?: number } | null> => {
      if (apiDisponivel()) return await contarConversasApi();
      const contar = (status?: StatusLista) => {
        const consulta = db.from('lotti_agent_conversations').select('id', { count: 'exact', head: true }).is('archived_at', null);
        return status ? consulta.eq('status', status) : consulta;
      };
      const [todas, abertas, fechadas] = await Promise.all([contar(), contar('open'), contar('closed')]);
      if (todas.error || todas.count === null) return null;
      return { total: todas.count, abertas: abertas.error ? undefined : abertas.count ?? undefined, fechadas: fechadas.error ? undefined : fechadas.count ?? undefined };
    },
  });
  const previews = useQuery({
    queryKey: ['lotti-agent-message-previews', user?.id, preview], enabled: !!user && !preview, refetchInterval: preview ? false : 3000,
    initialData: preview ? [{ conversation_id: demoConversation.id, direction: 'in' as const, content: 'Olá, gostaria de conhecer o imóvel.', created_at: demoTime }] : undefined,
    queryFn: async () => {
      if (apiDisponivel()) return ultimasMensagensApi<LatestMessage>();
      const { data, error } = await db.from('lotti_agent_latest_messages')
        .select('conversation_id,direction,created_at,content');
      if (error) throw error;
      return data as LatestMessage[];
    },
  });
  const latest = latestByConversation(previews.data ?? []);
  const now = Date.now();
  const filtered = filterLiveConversations(list.data ?? [], latest, { query, quick, mode: modeFilter, stage: stageFilter, period: periodFilter, now })
    .filter(c => (c.status === 'closed') === (statusLista === 'closed'));
  const contagem = totalDeConversas.data;
  // Cada lado vem inteiro quando tem menos de 100 conversas: aí a própria lista é a contagem, sempre
  // em dia com o que aparece. A contagem à parte (a cada 30 s) só vale acima disso — antes o botão
  // dizia "Fechadas 0" com uma conversa fechada na tela.
  const contarLado = (s: StatusLista) => {
    const dados = s === statusLista ? (list.isPlaceholderData ? undefined : list.data) : outraLista.data;
    if (dados && dados.length < 100) return dados.filter(c => (c.status === 'closed') === (s === 'closed')).length;
    return s === 'open' ? contagem?.abertas : contagem?.fechadas;
  };
  const totalDoLado = contarLado(statusLista);
  // A tela de "primeira conversa" só quando não existe conversa nenhuma, aberta ou fechada.
  const semConversas = list.isSuccess && !list.data?.length && statusLista === 'open' && (contagem?.total ?? 0) === 0;
  const selected = filtered.find(c => c.id === selectedId)
    ?? (telefoneAlvo ? filtered.find(c => mesmoTelefone(c.phone, telefoneAlvo)) : undefined)
    ?? filtered[0];
  const count = (kind: QuickFilter) => (list.data ?? []).filter(c => liveUrgency(c, latest.get(c.id), now) === kind).length;
  const messages = useQuery({
    queryKey: ['lotti-agent-messages', user?.id, selected?.id, preview], enabled: !!user && !!selected && !preview, refetchInterval: preview ? false : 1500,
    initialData: preview ? [{ id: 'demo-message-1', direction: 'in' as const, sender: 'lead' as const, content: 'Olá, gostaria de conhecer o imóvel.', media_path: null, created_at: demoTime }, { id: 'demo-message-2', direction: 'out' as const, sender: 'human' as const, content: 'Olá, Rafael! Posso te ajudar com os detalhes.', media_path: null, created_at: demoTime }] : undefined,
    queryFn: async () => {
      if (apiDisponivel()) return mensagensApi<Message>(selected!.id);
      const { data, error } = await db.from('lotti_agent_messages').select('id,direction,sender,content,media_path,created_at')
        .eq('conversation_id', selected!.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as Message[]).reverse();
    },
  });
  const events = useQuery({
    queryKey: ['lotti-inbox-events', user?.id, selected?.id, preview], enabled: !!user && !!selected && !preview, refetchInterval: preview ? false : 3000,
    initialData: preview ? [{ id: 'demo-event', kind: 'mode' as const, from_label: 'Equipe', to_label: 'IA', subject_label: null, actor_label: 'Corretor', created_at: demoTime }] : undefined,
    queryFn: async () => {
      if (apiDisponivel()) return eventosApi<InboxEvent>(selected!.id);
      const { data, error } = await db.from('lotti_inbox_events').select('id,kind,from_label,to_label,subject_label,actor_label,created_at')
        .eq('conversation_id', selected!.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as InboxEvent[]).reverse();
    },
  });
  const client = useQuery({
    queryKey: ['lotti-inbox-client', user?.id, selected?.cliente_id], enabled: !!user && !!selected?.cliente_id && !preview,
    queryFn: async () => {
      if (apiDisponivel()) {
        // Qualquer erro (inclusive 404) deixa a query em erro e a tela usa os fallbacks.
        const c = await obterClienteApi(selected!.cliente_id!);
        return { nome: c.nome, email: c.email, telefone: c.telefone, created_at: c.created_at, status_funil: c.status_funil, tipo_interesse: c.tipo_interesse } as ClienteDaConversa;
      }
      const { data, error } = await db.from('clientes').select('nome,email,telefone,created_at,status_funil,tipo_interesse')
        .eq('id', selected!.cliente_id!).single();
      if (error) throw error;
      return data as ClienteDaConversa;
    },
  });
  const mode = useMutation({
    mutationFn: async (nextMode: Conversation['mode']) => {
      if (apiDisponivel()) { await modoApi(selected!.id,nextMode); return; }
      const { data, error } = await db.rpc('lotti_agent_set_mode', { p_id: selected!.id, p_mode: nextMode });
      if (error || data !== true) throw error ?? new Error('mode_update_failed');
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ['lotti-agent-conversations', user?.id] }),
  });
  // O envio sem confirmação é a única pergunta que o sistema não consegue
  // responder sozinho: só quem abre o WhatsApp sabe se a mensagem chegou.
  const reconciliar = useMutation({
    mutationFn: async (chegou: boolean) => {
      if (apiDisponivel()) { await reconciliarApi(selected!.id,chegou); return; }
      const { error } = await db.rpc('lotti_agent_reconciliar_envio', { p_id: selected!.id, p_chegou: chegou });
      if (error) throw error;
    },
    onSuccess: () => Promise.all([
      cache.invalidateQueries({ queryKey: ['lotti-agent-conversations', user?.id] }),
      cache.invalidateQueries({ queryKey: ['lotti-agent-messages', user?.id] }),
    ]),
  });
  const clearOptOut=useMutation({mutationFn:async()=>{if(apiDisponivel()){await limparOptOutApi(selected!.id);return;}const {error}=await db.rpc('lotti_inbox_clear_opt_out',{p_conversation:selected!.id});if(error)throw error},onSuccess:async()=>{await Promise.all([cache.invalidateQueries({queryKey:['lotti-agent-conversations',user?.id]}),cache.invalidateQueries({queryKey:['lotti-inbox-events',user?.id]})])}});
  const refreshConversation=async(id?:string)=>{if(id)setSelectedId(id);await Promise.all([cache.invalidateQueries({queryKey:['lotti-agent-conversations',user?.id]}),cache.invalidateQueries({queryKey:['lotti-agent-message-previews',user?.id]}),cache.invalidateQueries({queryKey:['lotti-inbox-client',user?.id]})])};
  // The conversation already exists when the send is unconfirmed (bridge timeout): it opens with a
  // notice instead of an error, because trying again with a new id could deliver the message twice.
  const startConversation=useMutation({mutationFn:async(data:{phone:string;name?:string;text:string;request_id:string})=>{let result:Record<string,unknown>|null=null;if(apiDisponivel())result=await whatsappBridgeApi({action:'start',...data});else{const fallback=await supabase.functions.invoke('lotti-whatsapp',{body:{action:'start',...data}});if(fallback.error)throw new Error(await functionErrorCode(fallback.error));result=fallback.data as Record<string,unknown>|null;}if(!result?.conversationId)throw new Error('start_failed');if(result.sendStatus==='busy'||result.sendStatus==='failed')throw new Error(String(result.sendStatus));return {conversationId:result.conversationId as string,sendStatus:String(result.sendStatus)}},
    onSettled:(result,error,data)=>setStartOutcome({requestId:data.request_id,status:result?.sendStatus??(error instanceof Error?error.message:'start_failed')}),
    onSuccess:async({conversationId,sendStatus})=>{setNewOpen(false);if(sendStatus!=='sent')setNotice({id:conversationId,text:'Envio sem confirmação. Confira no WhatsApp antes de mandar de novo.'});await refreshConversation(conversationId)}});
  // A phone that is already another client of the CRM links the conversation to that client (relinked).
  const renameContact=useMutation({mutationFn:async(contact:{id:string;name:string;phone:string})=>{if(apiDisponivel())return atualizarContatoApi<{relinked?:boolean}|null>(contact.id,contact.name,contact.phone);const {data,error}=await db.rpc('lotti_inbox_update_contact',{p_conversation:contact.id,p_name:contact.name,p_phone:contact.phone});if(error)throw error;return data as {relinked?:boolean}|null},onSuccess:async(result,contact)=>{setRenameOpen(false);if(result?.relinked)setNotice({id:contact.id,text:'Este telefone já era de outro cliente do CRM. A conversa foi vinculada a esse cadastro.'});await Promise.all([refreshConversation(),useCRMStore.getState().fetchClientes(),cache.invalidateQueries({queryKey:crmKeys.todos})])}});
  // "Unir conversas": the typed phone is the line of another conversation. The server keeps the one
  // WhatsApp identifies (LID or received messages), whatever the order. The name typed in the dialog
  // is then saved on the kept conversation (the typed phone has its key, so the number stays); the merge itself stands even if that save fails.
  const mergeConversations=useMutation({mutationFn:async(pair:{keep:string;drop:string;name?:string;phone?:string})=>{const merged=apiDisponivel()?await mesclarConversasApi<{conversation_id:string;merged_id:string}>(pair.keep,pair.drop):await (async()=>{const {data,error}=await db.rpc('lotti_inbox_merge_conversations',{p_keep:pair.keep,p_drop:pair.drop});if(error)throw error;return data as {conversation_id:string;merged_id:string};})();if(pair.name){try{if(apiDisponivel())await atualizarContatoApi(merged.conversation_id,pair.name,pair.phone??'');else{const {error}=await db.rpc('lotti_inbox_update_contact',{p_conversation:merged.conversation_id,p_name:pair.name,p_phone:pair.phone??''});if(error)throw error;}}catch{setNotice({id:merged.conversation_id,text:'As conversas foram unidas, mas o nome não foi salvo. Edite o contato de novo.'})}}return merged},onSuccess:async result=>{setRenameOpen(false);renameContact.reset();await Promise.all([refreshConversation(result.conversation_id),cache.invalidateQueries({queryKey:['lotti-agent-messages',user?.id]}),cache.invalidateQueries({queryKey:['lotti-inbox-events',user?.id]})])}});
  const otherConversation=registroDoErro(renameContact.error,'phone_in_other_conversation');
  // History conversations are not CRM clients until the broker adds them. The
  // CRM screens read clients from their own store, refreshed after adding.
  const changeStatus=useMutation({retry:1,retryDelay:1500,mutationFn:async(status:'open'|'closed')=>{if(apiDisponivel())return statusConversaApi(selected!.id,status);const {data,error}=await db.rpc('lotti_inbox_set_status',{p_conversation:selected!.id,p_status:status});if(error)throw error;return data},onSuccess:async(_d,status)=>{setStatusOpen(false);if(status!==statusLista)toast.success(status==='closed'?'Conversa fechada. Ela fica em "Fechadas" e volta sozinha se o cliente escrever.':'Conversa reaberta. Ela voltou para "Abertas".');await Promise.all([refreshConversation(),cache.invalidateQueries({queryKey:['lotti-agent-conversation-count',user?.id]})])}});
  const demoListKey=['lotti-agent-conversations',user?.id,true];
  const updateDemoConversation=(id:string,change:Partial<Conversation>)=>cache.setQueryData<Conversation[]>(demoListKey,current=>(current??[]).map(item=>item.id===id?{...item,...change}:item));
  const appendDemoMessage=(id:string,kind:'text'|'file'|'audio',content:string)=>{
    const created_at=new Date().toISOString();
    const message:Message={id:crypto.randomUUID(),direction:'out',sender:'human',content,media_path:null,created_at,...(kind==='text'?{}:{preview_kind:kind})};
    cache.setQueryData<Message[]>(['lotti-agent-messages',user?.id,id,true],current=>[...(current??[]),message]);
    cache.setQueryData<LatestMessage[]>(['lotti-agent-message-previews',user?.id,true],current=>[{conversation_id:id,direction:'out',content,created_at},...(current??[]).filter(item=>item.conversation_id!==id)]);
    updateDemoConversation(id,{updated_at:created_at});
  };
  const appendDemoEvent=(id:string,to_label:string,from_label:string)=>cache.setQueryData<InboxEvent[]>(['lotti-inbox-events',user?.id,id,true],current=>[...(current??[]),{id:crypto.randomUUID(),kind:'mode',from_label,to_label,subject_label:null,actor_label:'Corretor',created_at:new Date().toISOString()}]);
  const appendDemoStatusEvent=(id:string,status:'open'|'closed')=>cache.setQueryData<InboxEvent[]>(['lotti-inbox-events',user?.id,id,true],current=>[...(current??[]),{id:crypto.randomUUID(),kind:'status',from_label:status==='closed'?'Aberta':'Fechada',to_label:status==='closed'?'Fechada':'Aberta',subject_label:null,actor_label:'Corretor',created_at:new Date().toISOString()}]);
  const demoStart=(data:{phone:string;name?:string;text:string})=>{
    const id=crypto.randomUUID(),created_at=new Date().toISOString();
    const conversation:Conversation={id,phone:data.phone,contact_name:data.name||null,cliente_id:null,mode:'human',status:'open',updated_at:created_at,qualification:{},last_error:null};
    cache.setQueryData<Conversation[]>(demoListKey,current=>[conversation,...(current??[])]);
    cache.setQueryData<Message[]>(['lotti-agent-messages',user?.id,id,true],[{id:crypto.randomUUID(),direction:'out',sender:'human',content:data.text,media_path:null,created_at}]);
    cache.setQueryData<InboxEvent[]>(['lotti-inbox-events',user?.id,id,true],[]);
    cache.setQueryData<LatestMessage[]>(['lotti-agent-message-previews',user?.id,true],current=>[{conversation_id:id,direction:'out',content:data.text,created_at},...(current??[])]);
    setSelectedId(id);setNewOpen(false);
  };
  const q = selected?.qualification;
  const temperatura = temperaturaLegivel(q?.temperature);
  const optOut = preview ? 'none' : optOutState(selected?.opted_out_at, messages.data ?? []);
  // `mode` continua 'ai' durante a pausa — é por isso que o interruptor dizia
  // "IA ligada" com a IA calada. O estado real soma o modo e o prazo.
  const estadoIa = estadoDaIa(selected ?? { mode: 'human' });
  // undefined = eventos ainda não carregados; null = carregados, sem nenhum de etapa. Separar os dois faz
  // o PRIMEIRO movimento do negócio (null → id) recarregar a pílula.
  const ultimoEventoDeEtapa = events.data ? (events.data.filter(e => e.kind === 'stage').at(-1)?.id ?? null) : undefined;
  const timeline = [...(messages.data ?? []).map(message => ({ type: 'message' as const, value: message })),
    ...(events.data ?? []).map(event => ({ type: 'event' as const, value: event }))]
    .sort((a, b) => new Date(a.value.created_at).getTime() - new Date(b.value.created_at).getTime());
  const connectionKnown = connected !== 'unknown';
  // Open each conversation at the latest message and follow new ones while the
  // reader is at the bottom; scrolling up to read history is not interrupted.
  useEffect(() => {
    if (alvoAplicado.current || (!clienteNaUrl && !telefoneNaUrl)) return;
    const conversas = list.data ?? [];
    if (!conversas.length) return;
    const digitos = (valor: string | null | undefined) => (valor ?? '').replace(/\D/g, '');
    const finalAlvo = digitos(telefoneNaUrl).slice(-8);
    const achada = conversas.find(conversa =>
      (clienteNaUrl && conversa.cliente_id === clienteNaUrl) ||
      (!!finalAlvo && digitos(conversa.phone).endsWith(finalAlvo)));
    if (achada) {
      alvoAplicado.current = true;
      setSelectedId(achada.id);
    } else if (statusLista === 'open' && !tentouFechadas.current && !list.isPlaceholderData) {
      tentouFechadas.current = true;
      setStatusLista('closed');
    }
  }, [list.data, list.isPlaceholderData, clienteNaUrl, telefoneNaUrl, setSelectedId, statusLista]);

  const timelineRef = useRef<HTMLDivElement>(null);
  const conteudoRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  // Até quando um gesto da pessoa (rodinha, toque, teclado, barra de rolagem) vale como "foi ela que rolou".
  // Só isso desliga o acompanhar o fim. Antes o onScroll decidia sozinho: o aviso de rolagem do nosso
  // próprio scrollTop chega um quadro depois, quando fotos e eventos já aumentaram a conversa — a tela
  // concluía que a pessoa tinha subido e parava no meio ao abrir.
  const gestoAte = useRef(0);
  const marcarGesto = () => { gestoAte.current = Date.now() + 1200; };
  // Mensagens já enviadas e ainda sem confirmação da ponte. Aparecem na conversa
  // na hora: esperar três segundos olhando a tela parada era o custo de uma
  // garantia que vem do request_id, não da espera.
  const [pendentes, setPendentes] = useState<{ key: string; kind: 'text' | 'file' | 'audio'; content: string; incerto?: boolean }[]>([]);
  useEffect(() => { setPendentes([]); }, [selected?.id]);
  // Qual conversa já foi desenhada. O reset de `followLatest` morava num
  // useEffect, que roda DEPOIS do useLayoutEffect abaixo: quem tivesse subido
  // numa conversa abria a seguinte no topo.
  const conversaDesenhada = useRef<string | undefined>(undefined);
  // Pelo comprimento não serve: a consulta devolve no máximo 200 mensagens, e no
  // teto a mensagem nova entra enquanto a antiga sai. A identidade do último
  // item muda sempre que chega algo, com ou sem corte.
  const ultimoDaLista = timeline.length ? timeline[timeline.length - 1].value.id : '';
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    if (conversaDesenhada.current !== selected?.id) {
      conversaDesenhada.current = selected?.id;
      followLatest.current = true;
    }
    if (followLatest.current) el.scrollTop = el.scrollHeight;
  }, [selected?.id, ultimoDaLista, pendentes.length]);
  // A régua de escrever muda de altura quando os botões quebram em duas linhas,
  // e a conversa encolhe junto — a rolagem parava algumas dezenas de pixels
  // antes do fim. Quem está acompanhando o fim continua no fim.
  // O conteúdo também cresce depois de desenhado (foto que termina de carregar, eventos da linha do
  // tempo que chegam depois): observando só a caixa, a conversa abria no meio. E o efeito liga a cada
  // conversa aberta: com deps [] ele rodava antes de existir a caixa e nunca observava nada.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => { if (followLatest.current) el.scrollTop = el.scrollHeight; });
    observador.observe(el);
    if (conteudoRef.current) observador.observe(conteudoRef.current);
    return () => observador.disconnect();
  }, [selected?.id]);
  // A altura é travada em QUALQUER largura, não só a partir de `lg`.
  // Com `min-h` e sem teto, a lista de mensagens crescia até o tamanho do
  // conteúdo: `scrollHeight` virava igual a `clientHeight`, não havia rolagem
  // interna nenhuma e quem rolava era a página. Daí a conversa abrir no topo
  // por mais que o efeito mandasse ir para o fim — não havia fim para onde ir.
  return <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden lg:h-dvh" data-testid="connected-inbox">
    <h1 className="sr-only">Inbox</h1>
    {preview && <p className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">Prévia interativa com dados fictícios. Nada é enviado ou salvo; recarregar desfaz as mudanças.</p>}
    {list.isError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">Não foi possível carregar as conversas. <button className="underline" onClick={() => list.refetch()}>Tentar novamente</button></p>}
    {list.isPending && <p role="status">Carregando conversas…</p>}
    {semConversas && <div className="rounded-xl border bg-card p-8 text-center">
      <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">Aguardando a primeira conversa</h2>
      <p className="mt-2 text-sm text-muted-foreground">Envie uma mensagem nova de um contato de teste depois de conectar. Conversas antigas do celular não são importadas automaticamente.</p>
    </div>}
    {list.isSuccess && !semConversas && <div data-testid="clix-inbox-shell" className={`grid min-h-0 min-w-0 flex-1 gap-[10px] bg-[#f4f8f5] p-[10px] lg:grid-cols-[214px_minmax(0,1fr)] max-lg:grid-cols-1 ${infoVisible ? '2xl:grid-cols-[272px_minmax(0,1fr)_288px]' : '2xl:grid-cols-[272px_minmax(0,1fr)]'}`}>
      {/* Sobreposição só existe com a gaveta aberta; fechar tocando fora é o
          gesto esperado de quem abriu. */}
      {listaAberta && (
        <button
          type="button"
          aria-label="Fechar lista de conversas"
          onClick={() => setListaAberta(false)}
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
        />
      )}
      <nav
        aria-label="Conversas conectadas"
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-[#e9ebf3] bg-white shadow-sm max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[86vw] max-lg:max-w-[310px] max-lg:rounded-none max-lg:transition-transform max-lg:duration-200 ${listaAberta ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-[104%]'}`}
      >
        <div className="space-y-2 border-b border-[#e9ebf3] bg-gradient-to-b from-white to-[#fbfcfe] px-[14px] pb-[13px] pt-[15px]">
          <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Conversas <span className="font-normal text-muted-foreground">· {list.data.length}</span></h2><Button size="sm" className="ml-auto h-7 bg-primary px-2.5 text-[11px] text-primary-foreground hover:bg-primary/90" onClick={()=>{startConversation.reset();setNewOpen(true)}}><Plus className="mr-1 h-3 w-3" />Nova</Button></div>
          <div role="group" aria-label="Situação das conversas" className="grid grid-cols-2 gap-1 rounded-lg bg-[#eef3ef] p-0.5">
            {(['open', 'closed'] as const).map(s => {
              const n = contarLado(s);
              // O lado escolhido precisa saltar aos olhos: branco sobre cinza-claro não dizia onde se estava.
              return <button key={s} type="button" aria-pressed={statusLista === s} onClick={() => setStatusLista(s)} className={`h-8 rounded-md border text-[12px] transition-colors ${statusLista === s ? 'border-primary bg-white font-semibold text-primary shadow-sm' : 'border-transparent font-medium text-[#565e76] hover:bg-white hover:text-foreground'}`}>{s === 'open' ? 'Abertas' : 'Fechadas'}{typeof n === 'number' && <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${statusLista === s ? 'bg-primary text-primary-foreground' : 'bg-white text-muted-foreground'}`}>{n}</span>}</button>;
            })}
          </div>
          <Input aria-label="Buscar conversas" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar nome, telefone ou texto" className="h-9 rounded-xl border-[#e3e7ef] bg-white px-3 text-[13px] placeholder:text-[#9aa1b5]" />
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setFiltersOpen(true)}><Filter className="mr-1 h-3 w-3" />Filtros</Button><span className="flex-1 text-[11px] text-muted-foreground" title={(totalDoLado ?? 0) > list.data.length ? `Mostrando as ${list.data.length} mais recentes` : undefined}>{filtered.length} de {totalDoLado ?? list.data.length}</span><button className="text-[11px] text-destructive" onClick={limparFiltros}>Limpar</button></div>
          {/* Sem contagem os atalhos continuam clicáveis: desabilitar em zero
              faz o corretor ler defeito onde só há fila vazia. Clicar mostra o
              estado vazio, que já traz o caminho de volta para "Todas". */}
          <div className="grid grid-cols-3 gap-1"><Button size="sm" className={`h-7 px-1 text-[11px] ${quick === 'all' ? 'border border-primary bg-primary/10 text-primary hover:bg-primary/15' : 'bg-white text-[#565e76]'}`} variant="outline" onClick={() => setQuick('all')}>Todas</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-amber-700" variant={quick === 'late' ? 'secondary' : 'outline'} onClick={() => setQuick('late')} aria-label={`Atrasando: ${count('late')} conversas`}><Timer className="h-3 w-3" />{count('late')}</Button><Button size="sm" className="h-7 gap-1 px-1 text-[11px] text-red-600" variant={quick === 'urgent' ? 'secondary' : 'outline'} onClick={() => setQuick('urgent')} aria-label={`Urgente: ${count('urgent')} conversas`}><AlertTriangle className="h-3 w-3" />{count('urgent')}</Button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-[5px]">
        {filtered.map(c => <button key={c.id} onClick={() => { setSelectedId(c.id); mode.reset(); clearOptOut.reset(); setListaAberta(false); if (notice?.id !== c.id) setNotice(undefined); }} className={`mx-[6px] my-[2px] flex min-h-[64px] w-[calc(100%-12px)] items-center gap-[10px] rounded-[10px] border px-[10px] py-3 text-left text-xs transition-colors ${selected?.id === c.id ? 'border-primary/30 border-l-[3px] border-l-primary bg-primary/10 shadow-sm' : 'border-transparent hover:bg-primary/5'}`}>
          <ContactAvatar name={conversationTitle(c, c.clientes?.nome)} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[#dfe8e1] bg-[#eef3ef] text-xs font-semibold text-[#3f5a48]" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="block truncate text-[13px] font-semibold text-[#10131f]">{conversationTitle(c, c.clientes?.nome)}</span><time dateTime={c.last_message_at ?? latest.get(c.id)?.created_at ?? c.updated_at} className="ml-auto text-[10px] text-[#929aae]">{listTimestamp(c.last_message_at ?? latest.get(c.id)?.created_at ?? c.updated_at)}</time></span><span className="mt-1 block truncate text-xs text-[#565e76]">{latest.get(c.id)?.content || stages[c.qualification.stage ?? ''] || 'Novo contato'}</span><span className="mt-1 block text-[10px] text-[#929aae]">{c.status === 'closed' ? `Fechada${porQuem(c.closed_by)}` : c.opted_out_at ? 'Não quer receber' : c.mode === 'human' ? 'Equipe' : rotuloDaIa(estadoDaIa(c))}</span></span>
        </button>)}
        {!filtered.length && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {list.data.some(c => (c.status === 'closed') === (statusLista === 'closed'))
              ? <>
                  <p>Nenhuma conversa neste filtro.</p>
                  <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={limparFiltros}>Ver todas as conversas</Button>
                </>
              : <p>{statusLista === 'closed' ? 'Nenhuma conversa fechada.' : 'Nenhuma conversa aberta.'}</p>}
          </div>
        )}
        {list.data.length === 100 && <p className="p-2 text-xs text-muted-foreground">Exibindo as 100 conversas mais recentes.</p>}
        </div>
      </nav>
      {selected ? <section aria-label="Histórico conectado" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-[#e9ebf3] bg-white shadow-sm">
        <header data-testid="conversation-header" className="flex min-h-[68px] flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
          {/* Só no celular: é o único caminho de volta para a lista quando ela
              vira gaveta. Alvo de 44px, que é o mínimo confortável no toque. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 lg:hidden"
            aria-label="Ver conversas"
            onClick={() => setListaAberta(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 flex-1 basis-[150px] items-center gap-2">
            <ContactAvatar name={conversationTitle(selected, client.data?.nome || selected.clientes?.nome)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-secondary text-xs font-semibold" />
            <div className="min-w-0"><div className="flex items-center gap-1"><strong className="block truncate text-sm">{conversationTitle(selected, client.data?.nome || selected.clientes?.nome)}</strong><button type="button" aria-label="Editar nome" onClick={()=>{renameContact.reset();mergeConversations.reset();setRenameOpen(true)}} className="rounded p-1 text-muted-foreground hover:bg-muted"><Pencil className="h-3 w-3" /></button></div><p className="whitespace-nowrap text-[11px] text-muted-foreground">{contactPhoneLabel(selected.phone)}</p></div>
          </div>
          <div data-testid="conversation-header-actions" className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
            {/* Com o CRM ligado, a etapa é a do negócio no Funil (a mesma do cartão); sem ele, o status do cadastro. */}
            {FLAGS.crm && !preview
              ? <EtapaDoFunil key={selected.id} clienteId={selected.cliente_id} ultimoEventoDeEtapa={ultimoEventoDeEtapa} />
              : <span data-testid="conversation-stage-pill" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium"><span className="font-semibold uppercase text-muted-foreground">Etapa</span><span className="h-2 w-2 rounded-full bg-primary" /><span>{preview ? 'Qualificação' : selected.cliente_id ? (client.data?.status_funil ? STATUS_FUNIL_LABELS[client.data.status_funil as StatusFunil] : 'Sem etapa definida') : 'Sem cliente vinculado'}</span></span>}
            <button type="button" title={selected.status==='closed'&&selected.closed_reason?`Motivo: ${selected.closed_reason}`:undefined} onClick={()=>{changeStatus.reset();setStatusOpen(true)}} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium hover:bg-primary/10"><span className={`h-2 w-2 rounded-full ${selected.status==='closed'?'bg-muted-foreground':'bg-emerald-600'}`} />{selected.status==='closed'?`Fechada${porQuem(selected.closed_by)}`:'Aberta'}</button>
            <button type="button" role="switch" aria-label="IA" aria-checked={selected.mode === 'ai'} disabled={mode.isPending || optOut !== 'none'} title={optOut !== 'none' ? 'O contato pediu para não receber mensagens' : undefined} onClick={() => {if(preview){const next=selected.mode==='ai'?'human':'ai';updateDemoConversation(selected.id,{mode:next});appendDemoEvent(selected.id,next==='ai'?'IA':'Equipe',selected.mode==='ai'?'IA':'Equipe');}else mode.mutate(selected.mode === 'ai' ? 'human' : 'ai')}} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium hover:bg-primary/10 disabled:opacity-50"><Bot className={`h-3.5 w-3.5 ${selected.mode==='ai'?'text-primary':'text-muted-foreground'}`} /><span>{optOut!=='none'?'IA bloqueada':rotuloDaIa(estadoIa)}</span><span aria-hidden className="mx-0.5 h-3.5 w-px bg-border" />{selected.mode==='ai'?<Play aria-hidden className="h-3 w-3 fill-primary text-primary" />:<Pause aria-hidden className="h-3 w-3 fill-muted-foreground text-muted-foreground" />}</button>
            <Button size="sm" className="h-8 shrink-0 border-primary px-2 text-[11px] text-primary hover:bg-primary/10" variant="outline" onClick={() => setInfoVisible(v => !v)}>{infoVisible ? 'Ocultar info' : 'Mostrar info'}</Button>
          </div>
        </header>
        {/* Antes não havia nada aqui: a IA simplesmente parava de responder e
            o corretor ficava ligando e desligando o interruptor. */}
        {estadoIa.tipo === 'em-espera' && optOut === 'none' && <p role="status" data-testid="ia-em-espera" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>IA em espera até {quandoAIaVolta(estadoIa.ate)}, porque esta conversa foi respondida fora do Inbox. Ela volta sozinha.</span>
          <button type="button" className="font-semibold underline underline-offset-2 disabled:opacity-50" disabled={mode.isPending} onClick={() => mode.mutate('ai')}>Reativar agora</button>
        </p>}
        {notice?.id === selected.id && <p role="status" className="border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice.text}</p>}
        {mode.isError && <p role="alert" className="p-3 text-sm text-destructive">{String((mode.error as { message?: string } | null)?.message ?? '').includes('contact_opted_out') ? 'Este contato pediu para não receber mensagens. Libere o contato antes de religar a IA.' : 'Não foi possível alterar o atendimento. Se houver entrega incerta, revise-a antes de retomar a IA.'}</p>}
        {messages.isError && <p role="alert" className="p-3 text-sm text-destructive">Não foi possível carregar o histórico.</p>}
        {/* Com a IA desligada, a faixa só dizia "A conversa está com a equipe." — o botão de IA já mostra isso. */}
        {selected.mode === 'ai' && selected.last_error && ESPERA_DA_IA[selected.last_error] && <p role="status" data-testid="espera-da-ia" className="border-b bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
          {ESPERA_DA_IA[selected.last_error]}
        </p>}
        {selected.last_error && !ESPERA_DA_IA[selected.last_error] && <div role="status" data-testid="motivo-da-parada" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>{MOTIVO_DA_PARADA[selected.last_error] ?? 'Esta conversa precisa de revisão operacional. O histórico foi preservado.'}</span>
          {/* Sem estes dois botões a conversa ficava morta até alguém mexer no
              banco: nada limpa `uncertain` sozinho, e enquanto ele existe a
              fila não entrega a conversa nem deixa religar a IA. */}
          {ENVIO_SEM_CONFIRMACAO.has(selected.last_error) && <span className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={reconciliar.isPending} onClick={() => reconciliar.mutate(true)} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold hover:border-amber-500 disabled:opacity-50">A mensagem chegou</button>
            <button type="button" disabled={reconciliar.isPending} onClick={() => reconciliar.mutate(false)} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold hover:border-amber-500 disabled:opacity-50">Não chegou</button>
          </span>}
          {reconciliar.isError && <span className="text-destructive">Não foi possível concluir. Tente de novo.</span>}
        </div>}
        <div ref={timelineRef} onWheel={marcarGesto} onTouchMove={marcarGesto} onKeyDown={marcarGesto} onPointerDown={marcarGesto} onScroll={event => {
          const el = event.currentTarget;
          const noFim = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (noFim) followLatest.current = true;
          else if (Date.now() < gestoAte.current) followLatest.current = false;
        }} data-testid="message-timeline" className="min-h-0 flex-1 overflow-y-auto bg-[#f4f8f5] bg-[radial-gradient(circle_at_1px_1px,rgba(119,153,130,0.14)_1px,transparent_0)] bg-[length:24px_24px] px-[clamp(10px,1.5vw,18px)] py-3">
          {/* O aviso fala do histórico cortado, que fica no começo da lista.
              No fim, junto da mensagem mais nova, ele não descrevia nada e
              ainda disputava espaço com o compositor. */}
          <div ref={conteudoRef} className="space-y-2">
          {messages.data?.length === 200 && <p className="pb-2 text-center text-[11px] text-muted-foreground">Exibindo as 200 mensagens mais recentes.</p>}
          {timeline.map(item => {
            if (item.type !== 'event') return <MessageBubble key={item.value.id} message={item.value} />;
            const hora = new Date(item.value.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const motivo = eventoComMotivo(item.value);
            return <div key={`event-${item.value.id}`} className="flex justify-center py-0.5"><span className="rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
              {motivo
                ? <span data-testid="evento-com-motivo" className="inline-flex items-center gap-1.5"><Pause aria-hidden className="h-3 w-3 fill-muted-foreground/60 text-muted-foreground/60" /><span>{motivo}</span><span className="opacity-60">· {hora}</span></span>
                : <>{eventText(item.value)} · {hora}</>}
            </span></div>;
          })}
          {pendentes.map(pendente => <article key={pendente.key} data-testid="mensagem-pendente" className="ml-auto w-fit max-w-[78%] rounded-[15px] rounded-tr-[4px] border border-primary/40 bg-primary/10 px-3 py-1.5 text-[14px] leading-[1.4] text-[#10131f]">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Corretor</p>
            <p className="whitespace-pre-wrap break-words">{pendente.kind === 'audio' ? '🎤 Áudio' : pendente.content}</p>
            <p className="mt-1 text-right text-[10px] text-muted-foreground">{pendente.incerto ? 'sem confirmação' : 'enviando…'}</p>
          </article>)}
          </div>
        </div>
        {connected === true || preview
          ? <>{optOut !== 'none' && selected.opted_out_at && <OptOutNotice state={optOut} since={selected.opted_out_at} pending={clearOptOut.isPending} failed={clearOptOut.isError} onRelease={() => clearOptOut.mutate()} />}
            {optOut !== 'blocked' && <MessageComposer key={selected.id} conversationId={selected.id} preview={preview} onPreviewSend={message=>appendDemoMessage(selected.id,message.kind,message.content)} onPending={entrada => setPendentes(atual => [...atual, entrada])}
              onPendingEnd={(chave, estado) => setPendentes(atual => estado === 'incerto' ? atual.map(item => item.key === chave ? { ...item, incerto: true } : item) : atual.filter(item => item.key !== chave))}
              onSent={() => { void cache.invalidateQueries({ queryKey: ['lotti-agent-messages', user?.id, selected.id] }); void cache.invalidateQueries({ queryKey: ['lotti-agent-conversations', user?.id] }); }} />}</>
          : <footer className="shrink-0 border-t p-3 text-xs text-muted-foreground">{connectionKnown ? <>Conecte o WhatsApp na página de <Link className="underline" to="/whatsapp/conexao">Conexão</Link> para responder por aqui.</> : <>Não foi possível confirmar a conexão. <Link className="underline" to="/whatsapp/conexao">Verificar conexão</Link> antes de responder.</>}</footer>}
      </section> : <div className="grid place-items-center rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        {filtered.length
          ? <p>Selecione uma conversa</p>
          : list.data.length
            ? <div>
                <p>Nenhuma conversa neste filtro.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={limparFiltros}>Ver todas as conversas</Button>
              </div>
            : <p>Nenhuma conversa ainda.</p>}
      </div>}
      {/* Sem conversa aberta (lista vazia em Fechadas, Atrasadas, Com erro): o quadro do perfil fica no
          lugar, vazio, em vez de a tela terminar num vão cinza. */}
      {!selected && infoVisible && <aside aria-label="Perfil do contato vazio" className="hidden min-h-0 rounded-[14px] border border-[#e9ebf3] bg-white p-[14px] shadow-sm 2xl:block">
        <h2 className="border-b pb-2.5 text-[11px] font-bold uppercase">Perfil do contato</h2>
        <p className="mt-4 text-[12px] text-muted-foreground">Selecione uma conversa para ver o perfil do contato.</p>
      </aside>}
      {selected && infoVisible && <aside aria-label="Perfil do contato" className="fixed bottom-3 right-3 top-16 z-30 min-h-0 w-[min(330px,calc(100vw-24px))] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex flex-col rounded-[14px] border border-[#e9ebf3] bg-white p-4 shadow-xl 2xl:static 2xl:w-auto 2xl:shadow-sm">
        <button type="button" onClick={() => setInfoVisible(false)} className="self-end rounded px-2 py-1 text-xs text-primary 2xl:hidden">Fechar perfil</button>
        <h2 className="sr-only">Perfil do contato</h2>

        {/* Contato no topo, sem caixa: avatar, nome, telefone e o atalho para o cadastro. */}
        <div className="flex items-center gap-3 pb-4">
          <ContactAvatar name={conversationTitle(selected, client.data?.nome || selected.clientes?.nome)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-secondary text-xs font-semibold" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">{conversationTitle(selected, client.data?.nome || selected.clientes?.nome)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{contactPhoneLabel(selected.phone)}</p>
            {client.data?.email && <p className="truncate text-[11px] text-muted-foreground">{client.data.email}</p>}
          </div>
        </div>

        <SecaoPerfil titulo="Qualificação comercial">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{stages[q?.stage ?? ''] ?? 'Novo contato'}</Badge>
            {temperatura && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TOM_TEMPERATURA[temperatura.tom]}`}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{temperatura.rotulo}
            </span>}
            {q?.priority === 'alta' && <Badge>Prioridade alta</Badge>}
          </div>
          {/* Rótulo e valor na mesma linha: empilhados, cinco campos ocupavam a
              altura do painel inteiro e obrigavam a rolar para ver o botão. */}
          {Object.entries(labels).some(([key]) => q?.profile?.[key]) && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[12.5px]">
            {Object.entries(labels).filter(([key]) => q?.profile?.[key]).map(([key, label]) => <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words font-medium leading-snug">{valorLegivel(key, q!.profile![key]!)}</dd>
            </div>)}
          </dl>}
        </SecaoPerfil>

        <SecaoPerfil titulo="Resumo do caso" acessorio={<Badge variant="secondary" className="gap-1 text-[9px]"><Sparkles className="h-2.5 w-2.5" />IA</Badge>}>
          <p className="text-[12px] leading-[1.45] text-muted-foreground">{q?.reason || 'Ainda sem qualificação. A IA preenche conforme conversa com o cliente.'}</p>
        </SecaoPerfil>

        <SecaoPerfil titulo="Linha do tempo">
          <LinhaDoTempo eventos={[
            { titulo: 'Lead criado', quando: client.data?.created_at },
            { titulo: 'Conversou no WhatsApp', quando: selected.updated_at },
          ]} />
        </SecaoPerfil>

        {/* O atalho para o cadastro fica no pé do painel: no topo, sobrava um vão grande embaixo. */}
        {selected?.cliente_id && !preview && <div className="mt-auto pt-4"><Link className="flex h-9 w-full items-center justify-center rounded-lg border border-primary text-[12px] font-medium text-primary transition-colors hover:bg-primary/10" to={`/clientes/${selected.cliente_id}`}>Abrir cadastro do cliente</Link></div>}
      </aside>}
    </div>}
    <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} onSubmit={data=>preview?demoStart(data):startConversation.mutate(data)} pending={!preview&&startConversation.isPending} outcome={startOutcome} error={!preview&&startConversation.isError?startErrorText(startConversation.error instanceof Error?startConversation.error.message:''):undefined} />
      {selected&&<><RenameContactDialog open={renameOpen} initialName={client.data?.nome??selected.contact_name??''} initialPhone={selected.phone ?? ''} phoneHidden={!selected.phone} onOpenChange={setRenameOpen} onSubmit={contact=>{if(preview){updateDemoConversation(selected.id,{contact_name:contact.name,phone:contact.phone});setRenameOpen(false)}else{mergeConversations.reset();renameContact.mutate({id:selected.id,...contact})}}} pending={!preview&&renameContact.isPending} error={preview?undefined:mergeConversations.isError?mergeErrorText(codigoDoErro(mergeConversations.error)):renameContact.isError?renameErrorText(codigoDoErro(renameContact.error)):undefined} action={!preview&&otherConversation&&!mergeConversations.isError?{label:'Unir conversas',pending:mergeConversations.isPending,onClick:()=>mergeConversations.mutate({keep:selected.id,drop:otherConversation,name:renameContact.variables?.name,phone:renameContact.variables?.phone})}:undefined} /><ConversationStatusDialog open={statusOpen} status={selected.status??'open'} onOpenChange={setStatusOpen} onConfirm={status=>{if(preview){updateDemoConversation(selected.id,{status,closed_by:status==='closed'?'humano':null});appendDemoStatusEvent(selected.id,status);setStatusOpen(false)}else changeStatus.mutate(status)}} pending={!preview&&changeStatus.isPending} error={!preview&&changeStatus.isError?'Não foi possível alterar o estado da conversa.':undefined} /></>}
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}><SheetContent side="left" className="space-y-5"><SheetTitle>Filtros</SheetTitle><SheetDescription>Filtre as conversas já recebidas.</SheetDescription>
      <label className="block text-sm">Atendimento<select className="mt-1 w-full rounded-md border bg-background p-2" value={modeFilter} onChange={e => setModeFilter(e.target.value)}><option value="">Todos</option><option value="human">Humano</option><option value="ai">IA</option><option value="paused">Pausado</option></select></label>
      <label className="block text-sm">Qualificação (IA)<select className="mt-1 w-full rounded-md border bg-background p-2" value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="">Todas</option>{Object.entries(stages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="block text-sm">Última atividade<select className="mt-1 w-full rounded-md border bg-background p-2" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}><option value="">Qualquer período</option><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label>
      <Button onClick={() => setFiltersOpen(false)}>Ver {filtered.length} conversas</Button>
    </SheetContent></Sheet>
  </div>;
}

import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { EstadoErro } from '@/components/admin/Estados';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { diagnosticStatusLabels, useDiagnosticDetail } from '@/hooks/admin/useDiagnostics';
import { formatAnswer, getQuestion, segmentLabel } from '../../../supabase/functions/_shared/diagnostic/engine';

const eventLabels: Record<string, string> = { diagnostic_started: 'Diagnóstico iniciado', name_submitted: 'Nome informado', contact_submitted: 'Contato capturado', question_answered: 'Resposta salva', diagnostic_completed: 'Diagnóstico concluído', cta_clicked: 'Conversa solicitada', diagnostic_abandoned: 'Sessão sem atividade', session_resumed: 'Conversa retomada' };
const nextSteps: Record<string, string> = { strategy_call: 'Conversa estratégica', send_diagnostic: 'Enviar análise', nurture: 'Acompanhar momento da operação' };
const dateTime = (value: string) => new Date(value).toLocaleString('pt-BR');

export default function AdminDiagnosticDetail() {
  const { id } = useParams();
  const query = useDiagnosticDetail(id);
  if (query.isLoading) return <p role="status">Carregando conversa…</p>;
  if (query.error || !query.data) return <EstadoErro erro={query.error} aoTentarNovamente={() => void query.refetch()} />;
  const { session, answers, events, summary, notifications } = query.data;
  const answer = (questionId: string) => {
    const entry = answers.find(item => item.question_id === questionId);
    const question = getQuestion(questionId);
    return entry ? question ? formatAnswer(question, entry.answer) : String(entry.answer) : 'Não informado';
  };
  const status = session.status !== 'completed' && Date.now() - new Date(session.last_activity_at).getTime() > 86_400_000 ? 'abandoned' : session.status;
  return <>
    <CabecalhoAdmin titulo={session.lead?.company || session.lead?.name || 'Diagnóstico iniciado'} descricao={`Iniciado em ${dateTime(session.started_at)}`}
      migalhas={[{ label: 'Diagnósticos', href: '/admin/diagnosticos' }, { label: 'Conversa' }]}
      acoes={<Button variant="outline" asChild><Link to="/admin/diagnosticos"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>} />
    <div className="mb-5 flex flex-wrap gap-2"><Badge>{session.temperature || 'Sem avaliação'}{session.score !== null ? ` · ${session.score} pontos` : ''}</Badge><Badge variant="outline">{diagnosticStatusLabels[status]}</Badge><Badge variant="secondary">{session.lead?.segment ? segmentLabel(session.lead.segment) : 'Segmento não informado'}</Badge></div>
    <section className="mb-6 rounded-xl border bg-card p-5">
      <h2 className="font-serif text-xl">Leitura comercial</h2>
      <p className="mt-3 max-w-4xl whitespace-pre-wrap text-sm leading-7">{summary?.summary || 'A conversa ainda está em andamento. Os dados capturados já estão disponíveis abaixo.'}</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[
        ['Gargalo principal', summary?.primary_bottleneck || answer('bottleneck')], ['Gargalo secundário', summary?.secondary_bottleneck || '—'], ['Próximo passo', summary ? nextSteps[summary.recommended_next_step] || summary.recommended_next_step : 'Aguardar diagnóstico'],
        ['Investimento em mídia', answer('paid_budget')], ['Urgência', answer('urgency')], ['Decisor', answer('decision')],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}</dl>
      {summary && <p className="mt-4 text-xs text-muted-foreground">Resumo {summary.source === 'ai' ? 'assistido por IA; revise antes do contato' : 'calculado pelas regras do diagnóstico'}.</p>}
    </section>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(250px,1fr)]">
      <section className="min-w-0 rounded-xl border bg-card p-5"><h2 className="mb-5 font-serif text-xl">Conversa completa</h2><ol className="space-y-5">{answers.map(entry => <li key={entry.id}><p className="max-w-[92%] rounded-2xl rounded-bl-sm bg-muted px-4 py-3 text-sm">{entry.question}</p><p className="ml-auto mt-2 max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm text-primary-foreground">{getQuestion(entry.question_id) ? formatAnswer(getQuestion(entry.question_id), entry.answer) : String(entry.answer)}</p><p className="mt-1 text-right text-[11px] text-muted-foreground">{dateTime(entry.created_at)}</p></li>)}</ol>{!answers.length && <p className="text-sm text-muted-foreground">Ainda sem respostas.</p>}</section>
      <aside className="min-w-0 space-y-6">
        <section className="rounded-xl border p-5"><h2 className="font-serif text-lg">Contato</h2><dl className="mt-3 space-y-3 text-sm">{[['Nome', session.lead?.name || answer('name')], ['Empresa', session.lead?.company], ['WhatsApp', session.lead?.phone], ['E-mail', session.lead?.email], ['Cidade', session.lead?.city]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{value || 'Não informado'}</dd></div>)}</dl></section>
        <section className="rounded-xl border p-5"><h2 className="font-serif text-lg">Origem</h2><dl className="mt-3 space-y-2 text-sm">{[['Origem', session.source], ['UTM source', session.utm_source], ['UTM medium', session.utm_medium], ['Campanha', session.utm_campaign], ['Conteúdo', session.utm_content], ['Termo', session.utm_term], ['Referência', session.referrer]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-all">{value || '—'}</dd></div>)}</dl></section>
        <section className="rounded-xl border p-5"><h2 className="font-serif text-lg">Notificações</h2>{notifications.length ? notifications.map(item => <div key={item.id} className="mt-3 text-sm"><p className="font-medium">{item.kind === 'started' ? 'Novo lead' : 'Diagnóstico concluído'}</p><p>{item.status === 'sent' ? 'Aceito pelo provedor' : item.status === 'failed' ? 'Falhou; verificar configuração' : 'Na fila de envio'} · {item.attempts} tentativa(s)</p>{item.sent_at && <p className="text-xs text-muted-foreground">{dateTime(item.sent_at)}</p>}</div>) : <p className="mt-3 text-sm text-muted-foreground">Aguardando captura de contato.</p>}<p className="mt-3 text-xs text-muted-foreground">Aceitação pelo provedor não confirma chegada à caixa de entrada.</p></section>
        <section className="rounded-xl border p-5"><h2 className="font-serif text-lg">Eventos</h2><ol className="mt-3 space-y-3">{events.map(event => <li key={event.id} className="text-sm"><p>{eventLabels[event.event_type] || event.event_type}</p><time className="text-xs text-muted-foreground">{dateTime(event.created_at)}</time></li>)}</ol></section>
      </aside>
    </div>
  </>;
}

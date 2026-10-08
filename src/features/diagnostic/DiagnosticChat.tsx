import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight, CircleCheck, Clock3, LoaderCircle, LockKeyhole, MessageCircle, RotateCcw, Send, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getQuestion, getQuestions, formatAnswer, validateAnswer } from '../../../supabase/functions/_shared/diagnostic/engine';
import {
  createDiagnosticIdentity, diagnosticRequest, diagnosticTracking, DiagnosticApiError,
  forgetDiagnosticIdentity, readDiagnosticIdentity, type DiagnosticAnswer,
  type DiagnosticIdentity, type DiagnosticResponse,
} from './api';
import './diagnostic.css';

function Monogram({ small = false }: { small?: boolean }) {
  return <div className={`gt-monogram${small ? ' gt-monogram-small' : ''}`} aria-hidden="true">GT<span /></div>;
}

function Sidebar({ count, completed }: { count: number; completed: boolean }) {
  const stage = completed ? 3 : count < 4 ? 0 : count < 10 ? 1 : 2;
  return (
    <aside className="gt-sidebar">
      <Link to="/diagnostico" className="gt-brand" aria-label="Diagnóstico de Gabriel Trindade"><Monogram /><span>Gabriel Trindade<small>Growth & IA</small></span></Link>
      <div className="gt-sidebar-body">
        <h1>O próximo passo<br />começa com uma<br />boa conversa.</h1>
        <p>Antes de pensar em soluções,<br />vamos entender sua operação.</p>
        <ol className="gt-stages" aria-label="Etapas do diagnóstico">
          {['Conhecer você', 'Entender o momento', 'Encontrar as prioridades'].map((label, index) => (
            <li key={label} className={stage >= index ? 'gt-stage-current' : ''} aria-current={stage === index ? 'step' : undefined}>
              <span>{stage > index ? <Check size={15} aria-hidden="true" /> : index + 1}</span>{label}
            </li>
          ))}
        </ol>
      </div>
      <div className="gt-sidebar-footer"><ShieldCheck size={18} aria-hidden="true" /><p>Suas respostas ajudam a preparar<br />uma conversa que faça sentido.</p></div>
    </aside>
  );
}

function downloadDiagnostic(snapshot: DiagnosticResponse) {
  const rows = getQuestions(snapshot.answers).filter(q => snapshot.answers[q.id] !== undefined);
  const text = [
    'Diagnóstico de Crescimento — Gabriel Trindade', '',
    snapshot.summary?.user_message || '', '', 'Suas respostas', '',
    ...rows.flatMap(q => [q.prompt, formatAnswer(q, snapshot.answers[q.id]), '']),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'meu-diagnostico-de-crescimento.txt';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function DiagnosticChat() {
  const [identity, setIdentity] = useState<DiagnosticIdentity | null>(() => readDiagnosticIdentity());
  const [snapshot, setSnapshot] = useState<DiagnosticResponse | null>(null);
  const [loading, setLoading] = useState(() => Boolean(readDiagnosticIdentity()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState(0);
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [contactMode, setContactMode] = useState<'phone' | 'email'>('phone');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [ctaRequested, setCtaRequested] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const pendingRef = useRef(false);

  const completed = snapshot?.session.status === 'completed';
  const answers = snapshot?.answers ?? {};
  const history = useMemo(() => getQuestions(snapshot?.answers ?? {}).filter(q => snapshot?.answers[q.id] !== undefined), [snapshot]);
  const question = editingId ? getQuestions(answers).find(q => q.id === editingId) : snapshot?.next_question;
  const visibleHistory = editingId ? history.slice(0, history.findIndex(q => q.id === editingId)) : history;
  const count = history.length;

  const applySnapshot = useCallback((result: DiagnosticResponse) => {
    setSnapshot(result);
    setCtaRequested(result.cta_requested);
    setEditingId(null);
    setDraft('');
    setSelected([]);
    setError('');
    setErrorStatus(0);
  }, []);

  const displayError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Não foi possível salvar agora. Tente novamente.');
    setErrorStatus(cause instanceof DiagnosticApiError ? cause.status : 0);
  }, []);

  useEffect(() => {
    if (!identity) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    diagnosticRequest(identity, { action: 'resume' }, controller.signal)
      .then(result => { if (!controller.signal.aborted) applySnapshot(result); })
      .catch(cause => { if (!controller.signal.aborted) displayError(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [identity, applySnapshot, displayError]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Diagnóstico de Crescimento | Gabriel Trindade';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    if (!question) return;
    const value = editingId ? answers[editingId] : undefined;
    setDraft(typeof value === 'string' ? value : '');
    setSelected(Array.isArray(value) ? value : []);
    if (question.type === 'contact') setContactMode(typeof value === 'string' && value.includes('@') ? 'email' : 'phone');
    // Move keyboard focus to the next prompt without opening a mobile keyboard automatically.
    activeRef.current?.focus({ preventScroll: true });
    // answers changes only after a successful write; avoid resetting drafts on network errors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, editingId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot, editingId, busy, error]);

  async function execute(payload: Record<string, unknown>) {
    if (!identity || pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await diagnosticRequest(identity, { ...payload, version: snapshot?.session.version });
      applySnapshot(result);
    } catch (cause) { displayError(cause); }
    finally { pendingRef.current = false; setBusy(false); }
  }

  async function start() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const credentials = identity ?? createDiagnosticIdentity();
      const result = await diagnosticRequest(credentials, { action: 'start', consent: true, honeypot, tracking: diagnosticTracking() });
      // Preserve successful state while making the new identity available to subsequent writes.
      applySnapshot(result);
      setIdentity(credentials);
    } catch (cause) { displayError(cause); }
    finally { pendingRef.current = false; setBusy(false); }
  }

  async function submit(value: DiagnosticAnswer) {
    if (!question || busy) return;
    try {
      const validated = validateAnswer(question, value);
      await execute({ action: 'answer', question_id: question.id, answer: validated });
    } catch (cause) { displayError(cause); inputRef.current?.focus(); }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void submit(question?.type === 'multi' ? selected : draft); }

  function goBack() {
    if (busy || !history.length) return;
    const currentIndex = editingId ? history.findIndex(q => q.id === editingId) : history.length;
    const previous = history[currentIndex - 1];
    if (previous) { setEditingId(previous.id); setError(''); }
  }

  function beginNew() {
    forgetDiagnosticIdentity();
    setIdentity(null);
    setSnapshot(null);
    setEditingId(null);
    setError('');
    setErrorStatus(0);
    setCtaRequested(false);
  }

  const progress = completed ? 100 : Math.min(94, (count / Math.max(15, getQuestions(answers).length)) * 100);
  const canBack = Boolean(snapshot && !completed && history.length && (!editingId || history.findIndex(q => q.id === editingId) > 0));

  return (
    <main className="gt-diagnostic" data-clarity-mask="true">
      <div className="gt-shell">
        <Sidebar count={count} completed={completed} />
        <section className="gt-conversation" aria-label="Diagnóstico de Crescimento">
          <header className="gt-header">
            <Monogram small />
            <div className="gt-header-identity"><h2>Assistente de Diagnóstico</h2><p>Gabriel Trindade — Growth & IA</p></div>
            <span className="gt-header-badge"><span /> Seu momento, em foco</span>
            {snapshot && <button type="button" className="gt-save" aria-label="Salvar sessão" onClick={() => setSavedNotice(s => !s)}><LockKeyhole size={17} aria-hidden="true" /><span>Salvar sessão</span></button>}
          </header>
          {snapshot && <div className="gt-progress" role="progressbar" aria-label="Progresso do diagnóstico" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
          {savedNotice && <div className="gt-saved-notice" role="status"><CircleCheck size={18} aria-hidden="true" /><p>{busy ? 'Aguardando a confirmação da resposta atual. ' : 'Suas respostas enviadas estão salvas. '}Você pode fechar esta página e voltar neste mesmo navegador para continuar.</p><button type="button" aria-label="Fechar aviso" onClick={() => setSavedNotice(false)}><X size={17} /></button></div>}

          {loading ? <div className="gt-loading" role="status"><LoaderCircle size={26} className="gt-spin" aria-hidden="true" /><p>Retomando nossa conversa…</p></div> : !snapshot ? (
            <div className="gt-intro-scroll">
              <div className="gt-intro">
                <div className="gt-intro-meta"><Clock3 size={15} aria-hidden="true" /> Cerca de 3 minutos <span /> Gratuito</div>
                <h2>Fala <span role="img" aria-label="Olá">👋</span><br />Vamos entender<br />seu próximo passo?</h2>
                <p>Quero entender rapidamente em qual momento sua operação está.</p>
                <p>São algumas perguntas objetivas e, no final, eu consigo ter uma visão muito melhor sobre seus principais gargalos.</p>
                <div className="gt-intro-invitation"><MessageCircle size={20} aria-hidden="true" /><span>Uma conversa. Uma pergunta por vez.<br /><strong>Vamos começar?</strong></span></div>
                <div className="gt-honeypot" aria-hidden="true"><label htmlFor="gt-website">Seu site pessoal</label><input id="gt-website" name="website" autoComplete="off" tabIndex={-1} value={honeypot} onChange={e => setHoneypot(e.target.value)} /></div>
                {error && <div className="gt-error" role="alert">{error}</div>}
                {identity && error && errorStatus !== 404 ? <>
                  <button className="gt-primary-button" type="button" disabled={busy} onClick={() => void execute({ action: 'resume' })}>{busy ? <LoaderCircle size={18} className="gt-spin" /> : <RotateCcw size={18} />} Tentar retomar</button>
                  {(errorStatus === 401 || errorStatus === 403) && <button className="gt-text-button" type="button" onClick={beginNew}>Iniciar um novo diagnóstico</button>}
                </> : <button type="button" className="gt-primary-button" onClick={() => void start()} disabled={busy}>{busy ? <LoaderCircle size={18} className="gt-spin" aria-hidden="true" /> : null}Começar diagnóstico <ArrowRight size={18} aria-hidden="true" /></button>}
                <p className="gt-consent">Ao continuar, você concorda que seus dados sejam utilizados para entrar em contato sobre o diagnóstico solicitado. <Link to="/diagnostico/privacidade">Política de Privacidade</Link></p>
              </div>
              <div className="gt-intro-bottom">Aquisição, conteúdo e processos.<br /><span>O diagnóstico começa por você.</span></div>
            </div>
          ) : (
            <>
              <div className="gt-chat-scroll" ref={scrollRef}>
                <div className="gt-chat-content">
                  <div className="gt-conversation-date"><span /> Diagnóstico de Crescimento <span /></div>
                  <div className="gt-history" aria-label="Respostas salvas">
                    {visibleHistory.map(q => <div key={q.id} className="gt-exchange"><div className="gt-assistant-bubble">{q.prompt}</div><div className="gt-user-row"><div className="gt-user-bubble">{formatAnswer(q, answers[q.id])}<Check size={13} aria-label="Resposta salva" /></div></div></div>)}
                  </div>

                  {completed && snapshot.summary ? (
                    <div className="gt-result" aria-labelledby="gt-result-title">
                      <div className="gt-result-icon"><Check size={22} aria-hidden="true" /></div>
                      <p className="gt-result-label">Diagnóstico concluído</p>
                      <h2 id="gt-result-title">Agora temos<br />um ponto de partida.</h2>
                      <p className="gt-result-message">{snapshot.summary.user_message}</p>
                      <p className="gt-result-note">Vou analisar suas respostas com mais profundidade. O próximo passo é uma conversa sobre o que faz sentido para sua operação.</p>
                      {ctaRequested ? <div className="gt-cta-confirmed" role="status"><CircleCheck size={20} aria-hidden="true" /><p>Seu interesse ficou registrado.<br /><strong>Gabriel poderá falar com você pelo contato informado.</strong></p></div> : <button type="button" className="gt-primary-button" disabled={busy} onClick={() => void execute({ action: 'cta' })}>{busy ? <LoaderCircle size={18} className="gt-spin" /> : <MessageCircle size={18} />}Quero conversar com Gabriel</button>}
                      <button type="button" className="gt-text-button gt-download" onClick={() => downloadDiagnostic(snapshot)}><ArrowDownToLine size={17} aria-hidden="true" /> Baixar meu diagnóstico</button>
                      {error && <div role="alert" className="gt-error">{error}</div>}
                    </div>
                  ) : question ? (
                    <div className="gt-current" ref={activeRef} tabIndex={-1} aria-labelledby="gt-current-question">
                      {editingId && <div className="gt-edit-notice"><span>Ao alterar esta resposta, vamos refazer as próximas etapas.</span><button type="button" disabled={busy} onClick={() => { setEditingId(null); setError(''); }}>Cancelar edição</button></div>}
                      <div className="gt-current-identity"><span className="gt-mini-monogram">GT</span> Assistente de Diagnóstico</div>
                      <div className="gt-assistant-bubble gt-active-bubble" id="gt-current-question">{question.type === 'contact' && contactMode === 'email' ? 'Claro! Qual é o melhor e-mail para falar com você?' : question.prompt}</div>
                      {question.hint && question.type !== 'contact' && <p className="gt-question-hint">{question.hint}</p>}
                      {(question.type === 'single' || question.type === 'multi') && <div className={`gt-options${question.type === 'multi' ? ' gt-options-multi' : ''}`} aria-label="Opções de resposta">
                        {question.options?.map(option => <button key={option.value} type="button" className={selected.includes(option.value) ? 'gt-option gt-option-selected' : 'gt-option'} disabled={busy} aria-pressed={question.type === 'multi' ? selected.includes(option.value) : undefined} onClick={() => question.type === 'single' ? void submit(option.value) : setSelected(previous => previous.includes(option.value) ? previous.filter(v => v !== option.value) : [...previous, option.value])}><span>{option.label}</span>{question.type === 'multi' ? <span className="gt-option-checkbox">{selected.includes(option.value) && <Check size={13} aria-hidden="true" />}</span> : <ChevronRight size={16} aria-hidden="true" />}</button>)}
                      </div>}
                      {busy && <div className="gt-typing" role="status" aria-label="Salvando resposta"><span /><span /><span /><small>Salvando sua resposta…</small></div>}
                      {error && <div className="gt-error" role="alert" id="gt-answer-error">{error}{errorStatus === 409 && <button className="gt-text-button" type="button" onClick={() => void execute({ action: 'resume' })}>Retomar respostas salvas</button>}</div>}
                    </div>
                  ) : <div className="gt-ready"><CircleCheck size={26} aria-hidden="true" /><h2>Já consigo enxergar melhor o seu momento.</h2><p>Suas respostas estão salvas. Vamos reunir os principais pontos?</p><button type="button" disabled={busy} className="gt-primary-button" onClick={() => void execute({ action: 'complete' })}>{busy ? <LoaderCircle size={18} className="gt-spin" /> : null}{busy ? 'Preparando diagnóstico…' : 'Ver meu diagnóstico'}{!busy && <ArrowRight size={18} aria-hidden="true" />}</button>{error && <div className="gt-error" role="alert">{error}</div>}</div>}
                </div>
              </div>
              <footer className="gt-composer-area">
                {!completed && question && (question.type === 'text' || question.type === 'contact' || question.type === 'multi') && <form onSubmit={onSubmit} className="gt-answer-form" noValidate>
                  {question.type === 'multi' ? <button type="submit" className="gt-primary-button gt-multi-submit" disabled={busy || !selected.length}>{busy ? <LoaderCircle size={18} className="gt-spin" /> : <Check size={18} />}Confirmar {selected.length ? `(${selected.length})` : 'respostas'}</button> : <>
                    {question.type === 'contact' && <button type="button" className="gt-contact-toggle" disabled={busy} onClick={() => { setContactMode(mode => mode === 'phone' ? 'email' : 'phone'); setDraft(''); setError(''); inputRef.current?.focus(); }}>{contactMode === 'phone' ? 'Prefiro informar meu e-mail' : 'Prefiro informar meu WhatsApp'}</button>}
                    <div className="gt-text-composer">
                      <label className="sr-only" htmlFor="gt-answer">{question.type === 'contact' ? contactMode === 'email' ? 'Seu e-mail' : 'Seu WhatsApp' : question.prompt}</label>
                      {question.id === 'goal' || (question.maxLength ?? 0) > 500 ? <textarea id="gt-answer" ref={node => { inputRef.current = node; }} value={draft} onChange={e => setDraft(e.target.value)} rows={2} placeholder={question.placeholder ?? 'Escreva sua resposta…'} maxLength={question.maxLength ?? 1500} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? 'gt-answer-error' : undefined} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(draft); } }} /> : <input id="gt-answer" ref={node => { inputRef.current = node; }} value={draft} onChange={e => setDraft(e.target.value)} type={question.type === 'contact' ? contactMode === 'email' ? 'email' : 'tel' : 'text'} inputMode={question.type === 'contact' ? contactMode === 'email' ? 'email' : 'tel' : 'text'} autoComplete={question.id === 'name' ? 'given-name' : question.type === 'contact' ? contactMode === 'email' ? 'email' : 'tel' : 'off'} placeholder={question.type === 'contact' && contactMode === 'email' ? 'voce@empresa.com.br' : question.placeholder ?? 'Escreva sua resposta…'} maxLength={question.maxLength ?? 500} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? 'gt-answer-error' : undefined} />}
                      <button type="submit" className="gt-send" aria-label="Enviar resposta" disabled={busy || !draft.trim()}>{busy ? <LoaderCircle size={19} className="gt-spin" /> : <Send size={19} aria-hidden="true" />}</button>
                    </div>
                  </>}
                </form>}
                <div className="gt-composer-meta">{canBack ? <button type="button" className="gt-back" onClick={goBack} disabled={busy}><ArrowLeft size={14} aria-hidden="true" /> Voltar</button> : <span><LockKeyhole size={12} aria-hidden="true" /> Conversa privada</span>}<span aria-live="polite">{busy ? 'Salvando…' : completed ? 'Diagnóstico salvo' : `${count} ${count === 1 ? 'resposta salva' : 'respostas salvas'}`}</span><Link to="/diagnostico/privacidade">Privacidade</Link></div>
              </footer>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

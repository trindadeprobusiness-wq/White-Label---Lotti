import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from 'lucide-react';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { apiDisponivel } from '@/lib/api';
import { questions, scoreDiagnostic, visibleQuestions, type Answers } from '../../supabase/functions/_shared/commercial-diagnostic';

type Draft = { sessionId: string; answers: Answers; index: number; started: boolean };
type Contact = { name: string; phone: string; email: string; city: string; company: string; consent: boolean };
const KEY = 'lotti:commercial-diagnostic:v1';
const emptyContact: Contact = { name: '', phone: '', email: '', city: '', company: '', consent: false };
// Com a API ligada, a rota pública da API (sem sessão e sem apikey), com os mesmos corpos
// `event`/`submit` e a mesma resposta { success, result }; sem ela, a Edge Function de hoje.
const API_LOTTI = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');
const api = apiDisponivel()
  ? `${API_LOTTI}/api/diagnostico-comercial`
  : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/commercial-diagnostic`;
const headers: Record<string, string> = apiDisponivel()
  ? { 'Content-Type': 'application/json' }
  : { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };

/** Texto de erro da resposta: a Edge devolve `error`; a API devolve `message` (5xx não tem texto útil). */
function erroDaResposta(body: { error?: unknown; message?: unknown } | null, status: number): string {
  const texto = apiDisponivel() ? (status < 500 ? body?.message : undefined) : body?.error;
  return typeof texto === 'string' && texto ? texto : 'Não foi possível salvar agora.';
}

function initialDraft(): Draft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null') as Draft | null;
    if (saved && /^[0-9a-f-]{36}$/i.test(saved.sessionId) && saved.answers && typeof saved.index === 'number') return saved;
  } catch { /* Uma sessão antiga não deve interromper o formulário. */ }
  return { sessionId: crypto.randomUUID(), answers: {}, index: -1, started: false };
}

function attribution() {
  const params = new URLSearchParams(location.search);
  const result: Record<string, string> = { landing_page: location.href.slice(0, 300), referrer: document.referrer.slice(0, 300) };
  for (const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    const value = params.get(key);
    if (value) result[key] = value.slice(0, 300);
  }
  return result;
}

function emit(sessionId: string, event: string, step?: string, keepalive = false) {
  void fetch(api, { method: 'POST', headers, body: JSON.stringify({ action: 'event', session_id: sessionId, event, step }), keepalive }).catch(() => undefined);
}

const descriptions: Record<string, string> = {
  DEMANDA: 'Pelas suas respostas, conseguir uma entrada mais constante de oportunidades parece ser a prioridade.',
  ATENDIMENTO: 'Pelas suas respostas, há espaço para responder e acompanhar melhor os contatos que já chegam.',
  AUTOMAÇÃO: 'Pelas suas respostas, tarefas manuais podem estar tomando tempo da operação.',
  GESTÃO: 'Pelas suas respostas, organizar informações e rotinas em um lugar pode trazer mais clareza.',
};

export default function CommercialDiagnostic() {
  const [draft, setDraft] = useState(initialDraft);
  const [contact, setContact] = useState<Contact>(emptyContact);
  const [result, setResult] = useState<ReturnType<typeof scoreDiagnostic> | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [source] = useState(attribution);
  const visible = useMemo(() => visibleQuestions(draft.answers), [draft.answers]);
  const isContact = draft.index >= visible.length;
  const current = draft.index >= 0 && !isContact ? visible[draft.index] : null;
  const selected = current ? draft.answers[current.id] : undefined;

  useEffect(() => { sessionStorage.setItem(KEY, JSON.stringify(draft)); }, [draft]);
  useEffect(() => {
    document.title = 'Diagnóstico comercial | Lotti';
    return () => { document.title = 'Lotti'; };
  }, []);
  useEffect(() => {
    if (!draft.started || result) return;
    const onHide = () => { if (document.visibilityState === 'hidden') emit(draft.sessionId, 'diagnostic_abandoned', current?.id || (isContact ? 'contact' : undefined), true); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [draft.started, draft.sessionId, result, current?.id, isContact]);

  function start() {
    emit(draft.sessionId, 'diagnostic_started');
    setDraft(d => ({ ...d, index: 0, started: true }));
  }

  function choose(value: string) {
    if (!current) return;
    const updated: Answers = { ...draft.answers };
    if (current.type === 'multi') {
      const values = Array.isArray(selected) ? selected : [];
      if (current.id === 'gaps' && values.length >= 3 && !values.includes(value)) { setError('Escolha no máximo três pontos.'); return; }
      updated[current.id] = values.includes(value) ? values.filter(v => v !== value) : [...values, value];
    } else updated[current.id] = value;
    // Remover respostas que deixaram de fazer parte da jornada.
    for (const q of questions) if (q.when && !q.when(updated)) delete updated[q.id];
    setDraft(d => ({ ...d, answers: updated }));
    setError('');
  }

  function next() {
    if (!current) return;
    if (current.type !== 'text' && (!selected || (Array.isArray(selected) && selected.length === 0))) { setError('Escolha uma resposta para continuar.'); return; }
    if (current.type === 'text' && typeof selected === 'string' && selected.length > 80) { setError('Use até 80 caracteres.'); return; }
    emit(draft.sessionId, 'diagnostic_step_completed', current.id);
    if (current.id === 'profile') emit(draft.sessionId, 'profile_selected', 'profile');
    setDraft(d => ({ ...d, index: Math.min(d.index + 1, visibleQuestions(d.answers).length) }));
    setError('');
  }

  function back() {
    setDraft(d => ({ ...d, index: Math.max(-1, d.index - 1) }));
    setError('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (contact.name.trim().length < 2) { setError('Informe seu nome.'); return; }
    const digits = contact.phone.replace(/\D/g, '');
    if (!/^(?:55)?[1-9]\d{9,10}$/.test(digits)) { setError('Confira o WhatsApp com DDD.'); return; }
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) { setError('Confira o e-mail.'); return; }
    if (!contact.consent) { setError('Confirme o uso dos dados para receber contato.'); return; }
    setSending(true); setError('');
    try {
      const response = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ action: 'submit', session_id: draft.sessionId, answers: draft.answers, ...contact, attribution: source }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(erroDaResposta(body, response.status));
      setResult(body.result);
      sessionStorage.removeItem(KEY);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar agora.'); }
    finally { setSending(false); }
  }

  const progress = draft.index < 0 ? 0 : result ? 100 : Math.round((Math.min(draft.index, visible.length) / (visible.length + 1)) * 100);

  return <div className="min-h-dvh bg-[#f7faf8] text-[#13231b]">
    <header className="border-b border-[#d9e3dd] bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <Link to="/sobre" aria-label="Lotti"><LottiLogo className="text-[#093323]" /></Link>
        <span className="text-sm text-[#52665b]">Diagnóstico comercial</span>
      </div>
      {draft.index >= 0 && !result && <div className="h-1 bg-[#e4eee7]"><div className="h-full bg-[#245c45] transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>}
    </header>
    <main className="mx-auto flex min-h-[calc(100dvh-80px)] max-w-5xl flex-col justify-center px-5 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-[680px]">
        {draft.index === -1 && !result && <section>
          <p className="mb-5 text-sm font-medium text-[#245c45]">Um diagnóstico para a sua operação</p>
          <h1 className="max-w-xl font-[Lora,serif] text-4xl leading-tight text-[#093323] sm:text-5xl">Onde a sua operação pode ganhar tempo e vender melhor?</h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#52665b]">Responda algumas perguntas rápidas. Ao final, você recebe uma leitura inicial do seu maior desafio e a equipe Lotti entende como ajudar.</p>
          <button type="button" onClick={start} className="mt-9 inline-flex min-h-12 items-center gap-3 rounded-lg bg-[#093323] px-6 font-semibold text-white hover:bg-[#245c45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#093323]">Começar diagnóstico <ArrowRight size={18} /></button>
          <p className="mt-4 text-sm text-[#63766b]">Leva cerca de 3 minutos. Você pode voltar e ajustar respostas.</p>
        </section>}

        {current && !result && <section aria-labelledby="question-title" key={current.id}>
          <p className="mb-5 text-sm text-[#63766b]">Pergunta {draft.index + 1} de {visible.length}</p>
          <h1 id="question-title" className="font-[Lora,serif] text-3xl leading-tight text-[#093323] sm:text-4xl">{current.title}</h1>
          {current.hint && <p className="mt-3 text-[#52665b]">{current.hint}</p>}
          {current.type === 'text' ? <input autoFocus value={typeof selected === 'string' ? selected : ''} maxLength={80} onChange={e => choose(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') next(); }} className="mt-8 min-h-14 w-full rounded-lg border border-[#cad9d0] bg-white px-4 text-lg outline-none focus:border-[#245c45] focus:ring-2 focus:ring-[#245c45]/20" placeholder="Nome do CRM (opcional)" /> :
            <div className="mt-8 grid gap-3 sm:grid-cols-2" role="group" aria-label={current.title}>
              {current.options?.map(option => {
                const active = Array.isArray(selected) ? selected.includes(option) : selected === option;
                return <button key={option} type="button" aria-pressed={active} onClick={() => choose(option)} className={`flex min-h-16 items-center justify-between gap-3 rounded-xl border px-5 py-4 text-left font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#093323] ${active ? 'border-[#245c45] bg-[#e8f2eb] text-[#093323]' : 'border-[#dce6df] bg-white text-[#263b2e] hover:border-[#9dbda9]'}`}><span>{option}</span>{active && <Check size={19} className="shrink-0" />}</button>;
              })}
            </div>}
          {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
          <div className="mt-8 flex items-center justify-between gap-4">
            <button type="button" onClick={back} className="inline-flex min-h-11 items-center gap-2 px-1 text-[#52665b] hover:text-[#093323]"><ArrowLeft size={17} /> Voltar</button>
            <button type="button" onClick={next} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-[#093323] px-6 font-semibold text-white hover:bg-[#245c45]">Continuar <ArrowRight size={17} /></button>
          </div>
        </section>}

        {isContact && !result && <section>
          <p className="mb-5 text-sm text-[#63766b]">Última etapa</p>
          <h1 className="font-[Lora,serif] text-3xl text-[#093323] sm:text-4xl">Para quem enviamos esse diagnóstico?</h1>
          <p className="mt-3 text-[#52665b]">A equipe Lotti pode usar essas respostas para conversar com você sobre os próximos passos.</p>
          <form onSubmit={submit} className="mt-7 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Nome *<input autoComplete="name" value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} maxLength={120} className="mt-2 min-h-12 w-full rounded-lg border border-[#cad9d0] bg-white px-3 outline-none focus:border-[#245c45]" /></label>
            <label className="text-sm font-medium">WhatsApp com DDD *<input type="tel" inputMode="tel" autoComplete="tel" value={contact.phone} onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} maxLength={32} placeholder="(11) 99999-9999" className="mt-2 min-h-12 w-full rounded-lg border border-[#cad9d0] bg-white px-3 outline-none focus:border-[#245c45]" /></label>
            <label className="text-sm font-medium">E-mail (opcional)<input type="email" autoComplete="email" value={contact.email} onChange={e => setContact(c => ({ ...c, email: e.target.value }))} maxLength={254} className="mt-2 min-h-12 w-full rounded-lg border border-[#cad9d0] bg-white px-3 outline-none focus:border-[#245c45]" /></label>
            <label className="text-sm font-medium">Cidade (opcional)<input autoComplete="address-level2" value={contact.city} onChange={e => setContact(c => ({ ...c, city: e.target.value }))} maxLength={120} className="mt-2 min-h-12 w-full rounded-lg border border-[#cad9d0] bg-white px-3 outline-none focus:border-[#245c45]" /></label>
            {(draft.answers.profile === 'Imobiliária' || draft.answers.profile === 'Equipe de corretores') && <label className="text-sm font-medium sm:col-span-2">Nome da empresa (opcional)<input autoComplete="organization" value={contact.company} onChange={e => setContact(c => ({ ...c, company: e.target.value }))} maxLength={120} className="mt-2 min-h-12 w-full rounded-lg border border-[#cad9d0] bg-white px-3 outline-none focus:border-[#245c45]" /></label>}
            <label className="flex items-start gap-3 rounded-lg bg-[#eaf2ed] p-4 text-sm leading-relaxed text-[#344d3c] sm:col-span-2"><input type="checkbox" checked={contact.consent} onChange={e => setContact(c => ({ ...c, consent: e.target.checked }))} className="mt-1 h-4 w-4 accent-[#093323]" /><span>Autorizo a Lotti a usar minhas respostas e dados de contato para retornar sobre este diagnóstico. Veja a <Link to="/politica-de-privacidade" target="_blank" className="underline">Política de Privacidade</Link>.</span></label>
            {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
            <div className="flex items-center justify-between gap-4 sm:col-span-2">
              <button type="button" onClick={back} className="inline-flex min-h-11 items-center gap-2 text-[#52665b]"><ArrowLeft size={17} /> Voltar</button>
              <button type="submit" disabled={sending} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-[#093323] px-6 font-semibold text-white disabled:opacity-60">{sending ? 'Salvando…' : 'Ver diagnóstico'} <ArrowRight size={17} /></button>
            </div>
          </form>
        </section>}

        {result && <section>
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-[#e5f1e8] text-[#093323]"><Check size={25} /></div>
          <h1 className="font-[Lora,serif] text-3xl text-[#093323] sm:text-4xl">Entendemos o momento da sua operação.</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#344d3c]">{descriptions[result.dominant_problem]}</p>
          <p className="mt-5 max-w-xl text-[#52665b]">Esta é uma leitura inicial baseada no que você informou. {result.recommended_next_step === 'DEMONSTRACAO_LOTTI' ? 'A equipe Lotti recebeu seus dados para combinar uma demonstração.' : result.recommended_next_step === 'CONVERSAR_ESPECIALISTA' ? 'A equipe Lotti pode conversar com você para entender melhor a operação.' : 'Você pode conhecer a plataforma no seu ritmo; suas respostas ficam com a equipe Lotti.'}</p>
          <Link to={result.recommended_next_step === 'DEMONSTRACAO_LOTTI' ? '/sobre#como-funciona' : '/sobre'} onClick={() => emit(draft.sessionId, 'cta_clicked')} className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-lg bg-[#093323] px-6 font-semibold text-white hover:bg-[#245c45]">{result.recommended_next_step === 'DEMONSTRACAO_LOTTI' ? 'Ver como a Lotti funciona' : 'Conhecer a Lotti'} <ArrowRight size={17} /></Link>
        </section>}
      </div>
    </main>
    <footer className="border-t border-[#d9e3dd] px-5 py-5 text-center text-xs text-[#63766b]"><LockKeyhole size={13} className="mr-1 inline" />Suas respostas são usadas para este diagnóstico e para o contato da Lotti.</footer>
  </div>;
}

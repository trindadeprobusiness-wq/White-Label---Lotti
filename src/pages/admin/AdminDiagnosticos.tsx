import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';

type Diagnostic = {
  id: string; created_at: string; name: string; phone: string; email: string | null; city: string | null; company: string | null;
  profile_label: string; dominant_problem: string; secondary_problems: string[]; urgency_label: string;
  recommended_next_step: string; status: 'novo' | 'em_contato' | 'concluido';
  answers: Record<string, string | string[]>; attribution: Record<string, string>; scores: Record<string, number>;
};
const client = supabase as unknown as SupabaseClient;
const labels: Record<string, string> = {
  profile: 'Perfil', team: 'Corretores', sources: 'Fontes de leads', acquisition: 'Foco atual', leads: 'Leads por mês',
  properties: 'Imóveis ativos', ad_spend: 'Investimento em anúncios', response: 'Atendimento', followup: 'Acompanhamento',
  tools: 'Ferramentas', crm: 'CRM', gaps: 'Dificuldades', priority: 'Prioridade', timing: 'Prazo', decision: 'Decisão',
};

export default function AdminDiagnosticos() {
  const [items, setItems] = useState<Diagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void client.from('commercial_diagnostics').select('*').order('created_at', { ascending: false }).limit(200).then(({ data, error: failure }) => {
      if (!active) return;
      if (failure) setError('Não foi possível carregar os diagnósticos.');
      else setItems((data ?? []) as Diagnostic[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function updateStatus(id: string, status: Diagnostic['status']) {
    const { error: failure } = await client.from('commercial_diagnostics').update({ status }).eq('id', id);
    if (failure) { setError('Não foi possível atualizar o status.'); return; }
    setItems(current => current.map(item => item.id === id ? { ...item, status } : item));
  }

  return <>
    <CabecalhoAdmin titulo="Diagnósticos comerciais" descricao="Respostas recebidas pelo formulário público da Lotti." />
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-4 text-red-700">{error}</p>}
    {loading ? <p>Carregando…</p> : items.length === 0 ? <p className="rounded-lg border bg-white p-6 text-muted-foreground">Nenhum diagnóstico recebido ainda.</p> :
      <div className="space-y-3">{items.map(item => <article key={item.id} className="rounded-xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{item.name}</p>
            <p className="text-sm text-muted-foreground">{item.profile_label} · {new Date(item.created_at).toLocaleString('pt-BR')}</p>
            <p className="mt-2 text-sm"><strong>Gargalo:</strong> {item.dominant_problem}{item.secondary_problems.length ? ` · Também: ${item.secondary_problems.join(', ')}` : ''}</p>
            <p className="text-sm"><strong>Momento:</strong> {item.urgency_label} · <strong>Próximo passo:</strong> {item.recommended_next_step.replace(/_/g, ' ')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={`Status de ${item.name}`} value={item.status} onChange={e => void updateStatus(item.id, e.target.value as Diagnostic['status'])} className="h-10 rounded-md border bg-white px-2 text-sm">
              <option value="novo">Novo</option><option value="em_contato">Em contato</option><option value="concluido">Concluído</option>
            </select>
            <button type="button" onClick={() => setOpen(open === item.id ? null : item.id)} className="h-10 rounded-md border px-3 text-sm font-medium hover:bg-slate-50">{open === item.id ? 'Fechar' : 'Ver respostas'}</button>
          </div>
        </div>
        {open === item.id && <div className="mt-5 grid gap-5 border-t pt-5 text-sm md:grid-cols-2">
          <div>
            <h2 className="mb-2 font-semibold">Contato</h2>
            <p>WhatsApp: <a href={`https://wa.me/${item.phone}`} target="_blank" rel="noreferrer" className="text-primary underline">{item.phone}</a></p>
            {item.email && <p>E-mail: {item.email}</p>}{item.city && <p>Cidade: {item.city}</p>}{item.company && <p>Empresa: {item.company}</p>}
            <h2 className="mb-2 mt-5 font-semibold">Origem</h2>
            {Object.entries(item.attribution).map(([key, value]) => <p key={key} className="break-all"><strong>{key}:</strong> {value}</p>)}
          </div>
          <div>
            <h2 className="mb-2 font-semibold">Respostas</h2>
            {Object.entries(item.answers).map(([key, value]) => <p key={key} className="mb-1"><strong>{labels[key] ?? key}:</strong> {Array.isArray(value) ? value.join(', ') : value}</p>)}
            <h2 className="mb-2 mt-5 font-semibold">Scores internos</h2>
            <div className="flex flex-wrap gap-2">{Object.entries(item.scores).filter(([, value]) => typeof value === 'number').map(([key, value]) => <span key={key} className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-900">{key.replace('_score', '').replace(/_/g, ' ')}: {value}</span>)}</div>
          </div>
        </div>}
      </article>)}</div>}
  </>;
}

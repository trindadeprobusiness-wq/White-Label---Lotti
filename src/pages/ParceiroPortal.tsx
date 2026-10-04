import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Copy, LogOut, MousePointerClick, Users, Wallet, CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { moeda, dataBR } from '@/lib/formato';
import { getParceiroLinkUrl } from '@/lib/publicBaseUrl';
import { chamarRpc } from '@/lib/admin/api';

type PortalData = {
  parceiro: { id: string; nome: string; email: string; status: string; comissao: number; valor_fixo: number | null; base_calculo: string; renovacoes: string; documento: string | null; chave_pix: string | null; tipo_chave_pix: string | null };
  teto_renovacoes: number | null;
  cliques_30_dias: number;
  cliques_total: number;
  cadastros: number;
  comissoes: Record<string, number>;
  pagamentos: Array<{ id: string; valor_total: number; pago_em: string; referencia: string | null; competencia_inicio: string | null; competencia_fim: string | null }>;
  campanhas: Array<{ campanha: string; cliques: number; indicacoes: number; assinaturas: number }>;
  link_principal: string | null;
};

const money = (amount: number | undefined) => moeda(Number(amount ?? 0));

function Card({ title, value, detail, icon: Icon }: { title: string; value: string; detail?: string; icon: typeof Wallet }) {
  return <section className="min-w-0 border-t border-slate-700 py-5 sm:px-4 sm:first:pl-0">
    <div className="flex items-center gap-2 text-sm text-slate-300"><Icon className="h-4 w-4 text-sky-400" />{title}</div>
    <p className="mt-3 break-words text-2xl font-semibold text-white">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-400">{detail}</p>}
  </section>;
}

export default function ParceiroPortal() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [campaign, setCampaign] = useState('');
  const [documento, setDocumento] = useState('');
  const [tipoChave, setTipoChave] = useState('cpf');
  const [chave, setChave] = useState('');
  const query = useQuery({
    queryKey: ['parceiro-portal', user?.id],
    enabled: !!user,
    retry: false,
    queryFn: async () => {
      await chamarRpc<boolean>('parceiro_portal_registrar_aceite');
      const [result, teto] = await Promise.all([
        chamarRpc<PortalData>('parceiro_portal_resumo'),
        chamarRpc<number | null>('parceiro_portal_teto_renovacoes'),
      ]);
      setDocumento(result.parceiro.documento ?? '');
      setTipoChave(result.parceiro.tipo_chave_pix ?? 'cpf');
      setChave(result.parceiro.chave_pix ?? '');
      return { ...result, teto_renovacoes: teto };
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      await chamarRpc<boolean>('parceiro_portal_salvar_repasse', {
        p_documento: documento, p_tipo_chave: tipoChave, p_chave: chave,
      });
    },
    onSuccess: async () => { toast.success('Dados de repasse atualizados.'); await queryClient.invalidateQueries({ queryKey: ['parceiro-portal', user?.id] }); },
    onError: () => toast.error('Confira o documento e a chave PIX do mesmo titular.'),
  });

  const data = query.data;
  if (query.isLoading) return <div className="grid min-h-screen place-items-center bg-[#06152b] text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (query.error || !data) return <main className="grid min-h-screen place-items-center bg-[#06152b] px-5 text-white"><section className="max-w-md text-center">
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-400">Lotti Parceiros</p><h1 className="mt-4 text-2xl font-semibold">Acesso ao portal</h1>
    <p className="mt-3 text-sm leading-6 text-slate-300">Entre com o mesmo e-mail que recebeu o convite. Se o acesso acabou de ser enviado, abra o link do e-mail para definir sua senha.</p>
    {query.error && <p className="mt-4 text-sm text-rose-300">{query.error.message.includes('parceiro') ? 'Este e-mail ainda não está vinculado a um parceiro ativo.' : 'Não foi possível carregar seu painel.'}</p>}
    <Button className="mt-6" asChild><Link to="/auth">Ir para entrar</Link></Button>
  </section></main>;

  const status = data.parceiro.status;
  const earned = ['pendente', 'em_validacao', 'aprovada', 'em_repasse', 'paga'].reduce((sum, key) => sum + Number(data.comissoes[key] ?? 0), 0);
  const paid = Number(data.comissoes.paga ?? 0);
  const base = data.parceiro.base_calculo === 'primeiro_pagamento' ? 'somente a primeira assinatura' : data.parceiro.base_calculo === 'receita_liquida' ? 'sobre a receita líquida' : 'sobre cada assinatura';
  const commissionsTerms = data.parceiro.base_calculo === 'valor_fixo'
    ? `${money(data.parceiro.valor_fixo ?? 0)} por indicado`
    : `${Number(data.parceiro.comissao).toLocaleString('pt-BR')}% ${base}`;

  return <main className="min-h-screen bg-[#06152b] text-slate-100">
    <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700 pb-5">
        <div><p className="text-sm font-semibold text-white">Lotti Parceiros</p><p className="mt-1 text-xs text-slate-400">{data.parceiro.nome} · {commissionsTerms}</p></div>
        <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white" onClick={async () => { await signOut(); navigate('/auth'); }}><LogOut className="mr-2 h-4 w-4" />Sair</Button>
      </header>
      {status !== 'ativo' && <div className="mt-5 border border-amber-600/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Sua parceria está {status}. Os dados históricos permanecem disponíveis.</div>}

      <Tabs defaultValue="painel" className="mt-6">
        <TabsList className="h-auto w-full justify-start gap-5 overflow-x-auto rounded-none border-b border-slate-700 bg-transparent p-0">
          <TabsTrigger value="painel" className="rounded-none border-b-2 border-transparent px-1 py-3 data-[state=active]:border-sky-400 data-[state=active]:bg-transparent data-[state=active]:text-white">Painel</TabsTrigger>
          <TabsTrigger value="comissoes" className="rounded-none border-b-2 border-transparent px-1 py-3 data-[state=active]:border-sky-400 data-[state=active]:bg-transparent data-[state=active]:text-white">Comissões</TabsTrigger>
          <TabsTrigger value="repasses" className="rounded-none border-b-2 border-transparent px-1 py-3 data-[state=active]:border-sky-400 data-[state=active]:bg-transparent data-[state=active]:text-white">Repasses</TabsTrigger>
          <TabsTrigger value="dados" className="rounded-none border-b-2 border-transparent px-1 py-3 data-[state=active]:border-sky-400 data-[state=active]:bg-transparent data-[state=active]:text-white">Dados de repasse</TabsTrigger>
        </TabsList>
        <TabsContent value="painel" className="space-y-6 pt-5">
          <section className="border-y border-slate-700 py-1 sm:grid sm:grid-cols-4 sm:gap-5">
            <Card title="Cliques (30 dias)" value={String(data.cliques_30_dias)} detail={`${data.cliques_total} no total`} icon={MousePointerClick} />
            <Card title="Cadastros" value={String(data.cadastros)} detail="Indicações convertidas" icon={Users} />
            <Card title="Comissões" value={money(earned)} detail={`${money(paid)} já recebidos`} icon={Wallet} />
            <Card title="Assinaturas" value={String(data.campanhas.reduce((n, row) => n + row.assinaturas, 0))} detail="Geradas pelas suas indicações" icon={CreditCard} />
          </section>
          <section className="border-y border-slate-700 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">Seu link de parceiro</p><p className="mt-1 break-all font-mono text-xs text-sky-300">{data.link_principal ? getParceiroLinkUrl(data.link_principal) : 'Link ainda não configurado'}</p><p className="mt-1 text-xs text-slate-400">Compartilhe para receber indicações.</p></div><Button variant="outline" size="sm" disabled={!data.link_principal} onClick={async () => { try { if (!data.link_principal) return; await navigator.clipboard.writeText(getParceiroLinkUrl(data.link_principal)); toast.success('Link copiado.'); } catch { toast.error('Não foi possível copiar.'); } }}><Copy className="mr-2 h-4 w-4" />Copiar link</Button></div>
          </section>
          <section className="border-b border-slate-700 pb-5"><h2 className="mb-3 text-sm font-medium">Desempenho por campanha</h2>
            {data.campanhas.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="text-xs text-slate-400"><tr><th className="py-2 font-medium">Campanha</th><th className="py-2 text-right font-medium">Cliques</th><th className="py-2 text-right font-medium">Indicações</th><th className="py-2 text-right font-medium">Assinaturas</th></tr></thead><tbody>{data.campanhas.map((row) => <tr key={row.campanha} className="border-t border-slate-800"><td className="py-3">{row.campanha}</td><td className="py-3 text-right tabular-nums">{row.cliques}</td><td className="py-3 text-right tabular-nums">{row.indicacoes}</td><td className="py-3 text-right tabular-nums">{row.assinaturas}</td></tr>)}</tbody></table></div> : <p className="py-4 text-sm text-slate-400">Os resultados aparecerão quando seu link começar a receber visitas.</p>}
          </section>
          <p className="text-xs text-slate-400">Termos atuais: comissão de {commissionsTerms}. Renovações: {data.parceiro.renovacoes === 'primeiro_pagamento' ? 'somente o primeiro pagamento de cada indicado' : data.teto_renovacoes == null ? 'recorrentes, sem limite' : `até ${data.teto_renovacoes} renovações por indicado`}.</p>
        </TabsContent>
        <TabsContent value="comissoes" className="pt-5"><h2 className="text-lg font-semibold">Resumo das comissões</h2><div className="mt-5 grid gap-x-6 sm:grid-cols-3">{[['Aguardando validação', 'pendente'], ['Em validação', 'em_validacao'], ['Aprovadas', 'aprovada'], ['Em repasse', 'em_repasse'], ['Recebidas', 'paga'], ['Canceladas', 'cancelada']].map(([label, key]) => <div key={key} className="flex justify-between border-b border-slate-800 py-3 text-sm"><span className="text-slate-300">{label}</span><span className="font-medium tabular-nums">{money(data.comissoes[key])}</span></div>)}</div><p className="mt-4 text-xs text-slate-400">As comissões são liberadas depois da confirmação do pagamento e do prazo de validação.</p></TabsContent>
        <TabsContent value="repasses" className="pt-5"><h2 className="text-lg font-semibold">Histórico de repasses</h2>{data.pagamentos.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="text-xs text-slate-400"><tr><th className="py-2">Data</th><th className="py-2">Referência</th><th className="py-2 text-right">Valor</th></tr></thead><tbody>{data.pagamentos.map((item) => <tr key={item.id} className="border-t border-slate-800"><td className="py-3">{dataBR(item.pago_em)}</td><td className="py-3">{item.referencia ?? 'Repasse de comissão'}</td><td className="py-3 text-right font-medium">{money(item.valor_total)}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm text-slate-400">Nenhum repasse foi registrado ainda.</p>}</TabsContent>
        <TabsContent value="dados" className="pt-5"><section className="max-w-2xl border-y border-slate-700 py-5"><h2 className="text-lg font-semibold">Dados de repasse</h2><p className="mt-1 text-sm text-slate-400">A chave PIX e o documento precisam pertencer à mesma pessoa ou empresa.</p><form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <div className="space-y-2"><Label htmlFor="beneficiary-document" className="text-slate-200">CPF ou CNPJ do titular</Label><Input id="beneficiary-document" inputMode="numeric" autoComplete="off" value={documento} onChange={(e) => setDocumento(e.target.value)} className="border-slate-600 bg-[#081a33] text-white" placeholder="Somente números" /></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="pix-kind" className="text-slate-200">Tipo de chave PIX</Label><select id="pix-kind" value={tipoChave} onChange={(e) => setTipoChave(e.target.value)} className="h-10 w-full rounded-md border border-slate-600 bg-[#081a33] px-3 text-sm text-white"><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="telefone">Telefone</option><option value="aleatoria">Aleatória</option></select></div><div className="space-y-2"><Label htmlFor="pix-key" className="text-slate-200">Chave PIX</Label><Input id="pix-key" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)} className="border-slate-600 bg-[#081a33] text-white" /></div></div>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar dados de repasse'}<ArrowUpRight className="ml-2 h-4 w-4" /></Button>
        </form></section></TabsContent>
      </Tabs>
    </div>
  </main>;
}

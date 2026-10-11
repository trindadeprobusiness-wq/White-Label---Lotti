import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { centralComercial as supabase } from '@/lib/api/centralComercial';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ArrowUpRight, BarChart3, Building2, CalendarClock, Check, Clock3, Download, FileUp, Loader2, Phone, Plus, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';

type Lead = {
  id: string; nome_empresa: string; segmento: string | null; cidade: string | null; bairro: string | null;
  telefone: string | null; telefone_normalizado: string | null; site: string | null; verificacao_site: string;
  rede_social: string | null; nota_avaliacoes: number | null; quantidade_avaliacoes: number | null;
  link_origem: string | null; score: number; justificativa_score: string | null; observacoes: string | null;
  responsavel: string | null; status_contato: string; proxima_acao: string | null; proxima_acao_em: string | null; fila_pausada_ate: string | null;
  created_at: string;
};
type Interaction = { id: string; lead_id: string; tipo: string; resultado: string | null; observacoes: string | null; ocorreu_em: string; proxima_acao: string | null; proxima_acao_em: string | null };
type Script = {id:string;nome:string;versao:string;texto:string;ativo:boolean};
type LeadDraft = Pick<Lead, 'nome_empresa' | 'segmento' | 'cidade' | 'bairro' | 'telefone' | 'site' | 'verificacao_site' | 'rede_social' | 'link_origem' | 'observacoes' | 'responsavel' | 'score' | 'justificativa_score'>;
const vazio: LeadDraft = { nome_empresa: '', segmento: '', cidade: '', bairro: '', telefone: '', site: '', verificacao_site: 'nao_informado', rede_social: '', link_origem: '', observacoes: '', responsavel: '', score: 0, justificativa_score: '' };
const etapas = [
  ['novo','Novo'],['qualificado','Qualificado'],['ligacao_pendente','Ligação pendente'],['contato_realizado','Contato realizado'],['retorno_agendado','Retorno agendado'],['demonstracao_autorizada','Demonstração autorizada'],['demonstracao_enviada','Demonstração enviada'],['proposta_enviada','Proposta enviada'],['fechado_ganho','Fechado — ganho'],['fechado_perdido','Fechado — perdido'],['nao_contatar','Não contatar'],
];
const resultados = [
  ['nao_atendeu','Não atendeu'],['numero_invalido','Número inválido'],['nao_responsavel','Atendeu, não era responsável'],['sem_interesse','Sem interesse'],['retorno_solicitado','Responsável pediu retorno'],['interessado','Interessado'],['autorizou_whatsapp','Autorizou envio pelo WhatsApp'],['demonstracao_enviada','Demonstração enviada'],['proposta_enviada','Proposta enviada'],['venda_fechada','Venda fechada'],['nao_contatar','Não contatar'],
];
const rotuloEtapa = (s: string) => etapas.find(([k]) => k === s)?.[1] ?? s;
const fmtData = (v?: string | null) => v ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
const normPhone = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const clean = (v: unknown) => String(v ?? '').trim();
const rowVal = (row: Record<string, unknown>, keys: string[]) => {
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const entries = Object.entries(row); const found = entries.find(([k]) => keys.includes(norm(k)));
  return found ? clean(found[1]) : '';
};

export default function CentralComercial() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [interacoes, setInteracoes] = useState<Interaction[]>([]);
  const [scripts,setScripts]=useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busca, setBusca] = useState('');
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [draft, setDraft] = useState<LeadDraft>(vazio);
  const [saving, setSaving] = useState(false);
  const [callLead, setCallLead] = useState<Lead | null>(null);
  const [resultado, setResultado] = useState('nao_atendeu');
  const [nota, setNota] = useState('');
  const [retornoEm, setRetornoEm] = useState('');
  const [retornoAcao, setRetornoAcao] = useState('Ligar novamente');
  const [roteiroId,setRoteiroId]=useState('');
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}));
  const [fileRows, setFileRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState('');
  const [columnMap, setColumnMap] = useState<Record<string,string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setLoadError('');
    const [lr, ir,sr] = await Promise.all([
      supabase.from('central_comercial_leads' as never).select('*').order('created_at', { ascending: false }) as unknown as Promise<{data: Lead[] | null; error: {message:string}|null}>,
      supabase.from('central_comercial_interacoes' as never).select('*').order('ocorreu_em', { ascending: false }) as unknown as Promise<{data: Interaction[] | null; error: {message:string}|null}>,
      supabase.from('central_comercial_roteiros' as never).select('*').eq('ativo',true).order('created_at') as unknown as Promise<{data: Script[] | null; error: {message:string}|null}>,
    ]);
    if (lr.error || ir.error || sr.error) {
      const message = lr.error?.message ?? ir.error?.message ?? sr.error?.message ?? '';
      setLoadError(/central_comercial|schema cache|does not exist|could not find/i.test(message)
        ? 'O banco deste ambiente ainda não tem a migration da Central Comercial. Aplique a migration antes de registrar dados.'
        : `Não foi possível carregar os dados: ${message}`);
    } else { setLeads(lr.data ?? []); setInteracoes(ir.data ?? []);setScripts(sr.data??[]); }
    setLoading(false);
  }, []);
  useEffect(() => { if (user) void carregar(); }, [user, carregar]);

  const filtrados = useMemo(() => leads.filter(l => [l.nome_empresa,l.segmento,l.cidade,l.telefone].some(v => (v ?? '').toLowerCase().includes(busca.toLowerCase()))), [leads,busca]);
  const hoje = useMemo(() => {
    const now = new Date(); const ini = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(); const fim = ini + 86400000;
    return leads.filter(l => l.status_contato !== 'nao_contatar' && !['fechado_ganho','fechado_perdido'].includes(l.status_contato) && (!l.fila_pausada_ate || new Date(l.fila_pausada_ate).getTime() <= now.getTime()) && (l.proxima_acao_em ? new Date(l.proxima_acao_em).getTime() < fim : ['novo','qualificado','ligacao_pendente'].includes(l.status_contato)))
      .sort((a,b) => Number(Boolean(b.proxima_acao_em && new Date(b.proxima_acao_em).getTime() < ini))-Number(Boolean(a.proxima_acao_em && new Date(a.proxima_acao_em).getTime() < ini)) || b.score-a.score || a.created_at.localeCompare(b.created_at)).slice(0,30);
  }, [leads]);
  const metrics = useMemo(() => {
    const start = new Date(); start.setHours(0,0,0,0);
    const todayCalls = interacoes.filter(i => i.tipo === 'ligacao' && new Date(i.ocorreu_em).getTime() >= start.getTime());
    const week = Date.now() - 7*86400000;
    const weekCalls = interacoes.filter(i => i.tipo === 'ligacao' && new Date(i.ocorreu_em).getTime() >= week).length;
    const weekSales = leads.filter(l => l.status_contato === 'fechado_ganho' && new Date(l.created_at).getTime() >= week).length;
    return { total:leads.length, qualified:leads.filter(l=>['qualificado','ligacao_pendente','contato_realizado','retorno_agendado','demonstracao_autorizada','demonstracao_enviada','proposta_enviada','fechado_ganho'].includes(l.status_contato)).length, calls:todayCalls.length, answered:todayCalls.filter(i=>!['nao_atendeu','numero_invalido'].includes(i.resultado??'')).length, sales:leads.filter(l=>l.status_contato==='fechado_ganho').length, weekCalls, weekSales };
  }, [leads,interacoes]);

  const abrirLead = (lead?: Lead) => { setEditing(lead ?? null); setDraft(lead ? {nome_empresa:lead.nome_empresa,segmento:lead.segmento??'',cidade:lead.cidade??'',bairro:lead.bairro??'',telefone:lead.telefone??'',site:lead.site??'',verificacao_site:lead.verificacao_site,rede_social:lead.rede_social??'',link_origem:lead.link_origem??'',observacoes:lead.observacoes??'',responsavel:lead.responsavel??'',score:lead.score,justificativa_score:lead.justificativa_score??''} : {...vazio}); setDialog(true); };
  const salvarLead = async () => {
    if (!draft.nome_empresa.trim()) { toast.error('Informe o nome da empresa.'); return; }
    setSaving(true);
    const payload = { ...draft, verificacao_site:draft.site?.trim()?'presente':draft.verificacao_site, owner_id:user?.id, telefone_normalizado:normPhone(draft.telefone), updated_at:new Date().toISOString() };
    const result = editing
      ? await supabase.from('central_comercial_leads' as never).update(payload as never).eq('id', editing.id).select().single()
      : await supabase.from('central_comercial_leads' as never).insert(payload as never).select().single();
    setSaving(false);
    if (result.error) { toast.error(`Não foi possível salvar: ${result.error.message}`); return; }
    toast.success(editing ? 'Lead atualizado.' : 'Lead cadastrado.'); setDialog(false); await carregar();
  };
  const salvarStatus = async (lead: Lead, status: string) => {
    if (lead.status_contato === 'nao_contatar' && status !== 'nao_contatar') { toast.error('Este lead está marcado como Não contatar e não pode voltar à fila.'); return; }
    if (status === lead.status_contato) return;
    const moved = await supabase.from('central_comercial_interacoes' as never).insert({owner_id:user?.id,lead_id:lead.id,tipo:'nota',observacoes:`Etapa alterada manualmente: ${rotuloEtapa(lead.status_contato)} → ${rotuloEtapa(status)}`} as never);
    if (moved.error) { toast.error('Não foi possível registrar o histórico da etapa.'); return; }
    const { error } = await supabase.from('central_comercial_leads' as never).update({status_contato:status,updated_at:new Date().toISOString()} as never).eq('id',lead.id);
    if (error) toast.error('Histórico registrado, mas não foi possível atualizar a etapa.'); else { toast.success('Etapa atualizada.'); await carregar(); }
  };
  const pausarLead = async (lead: Lead) => {
    const ate=new Date(); ate.setHours(23,59,59,999);
    const {error}=await supabase.from('central_comercial_leads' as never).update({fila_pausada_ate:ate.toISOString(),updated_at:new Date().toISOString()} as never).eq('id',lead.id);
    if(error)toast.error('Não foi possível pausar este lead.');else{toast.success('Lead pausado até o fim do dia; outro contato elegível ocupa a vaga.');await carregar();}
  };
  const aoSoltar=(event:DragEndEvent)=>{const lead=leads.find(l=>l.id===event.active.id);const stage=String(event.over?.id??'');if(lead&&etapas.some(([key])=>key===stage))void salvarStatus(lead,stage);};
  const registrarLigacao = async () => {
    if (!callLead || !user) return; setSaving(true);
    const proxima = retornoEm ? new Date(retornoEm).toISOString() : null;
    const { error } = await supabase.from('central_comercial_interacoes' as never).insert({owner_id:user.id,lead_id:callLead.id,tipo:'ligacao',resultado,observacoes:nota.trim()||null,proxima_acao:proxima?retornoAcao:null,proxima_acao_em:proxima,roteiro_id:roteiroId||null,ocorreu_em:new Date().toISOString()} as never);
    if (error) { setSaving(false); toast.error(`Falha ao registrar ligação: ${error.message}`); return; }
    const status = resultado === 'nao_contatar' ? 'nao_contatar' : resultado === 'venda_fechada' ? 'fechado_ganho' : resultado === 'proposta_enviada' ? 'proposta_enviada' : resultado === 'demonstracao_enviada' ? 'demonstracao_enviada' : resultado === 'autorizou_whatsapp' ? 'demonstracao_autorizada' : resultado === 'retorno_solicitado' || proxima ? 'retorno_agendado' : resultado === 'interessado' ? 'qualificado' : 'contato_realizado';
    await supabase.from('central_comercial_leads' as never).update({status_contato:status,proxima_acao:proxima?retornoAcao:null,proxima_acao_em:proxima,updated_at:new Date().toISOString()} as never).eq('id',callLead.id);
    setSaving(false); setCallLead(null); setNota(''); setRetornoEm(''); setResultado('nao_atendeu');setRoteiroId(''); toast.success('Ligação registrada.'); await carregar();
  };
  const lerArquivo = async (file?: File) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer(); const wb = XLSX.read(buffer,{type:'array'}); const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string,unknown>>(ws,{defval:''});
      if (!rows.length) { toast.error('O arquivo não contém linhas com dados.'); return; }
      const cols=Object.keys(rows[0]);
      const aliases:Record<string,string[]>={nome:['nomeempresa','empresa','nome','businessname','title'],telefone:['telefone','telefonedacomercial','phone','phonenumber','telefonecomercial'],segmento:['segmento','categoria','nicho','category'],cidade:['cidade','city'],bairro:['bairro','neighborhood'],site:['site','website','url','websiteurl'],social:['instagram','redesocial','social'],nota:['nota','rating','avaliacao','ratingvalue'],quantidade:['quantidadedeavaliacoes','reviews','reviewcount','avaliacoes'],origem:['origem','source','linkorigem','googlemapsurl']};
      const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const guess:Record<string,string>={};
      for(const [field,names] of Object.entries(aliases)){const found=cols.find(c=>names.includes(normalized(c)));if(found)guess[field]=found;}
      setColumnMap(guess); setFileRows(rows); setFileName(file.name); setImportOpen(true);
    } catch { toast.error('Arquivo inválido. Use CSV ou XLSX.'); }
  };
  const importar = async () => {
    if (!user) return; setImporting(true);
    const existingPhones = new Set(leads.map(l=>l.telefone_normalizado).filter(Boolean));
    const keys = new Set(leads.map(l=>`${l.nome_empresa.toLowerCase()}|${(l.cidade??'').toLowerCase()}|${(l.bairro??'').toLowerCase()}`));
    const mapped=(row:Record<string,unknown>,field:string,aliases:string[])=>columnMap[field]?clean(row[columnMap[field]]):rowVal(row,aliases);
    const prepared = fileRows.map(row => {
      const nome = mapped(row,'nome',['nomeempresa','empresa','nome','businessname','title']); const phone = mapped(row,'telefone',['telefone','telefonedacomercial','phone','phonenumber','telefonecomercial']);
      const cidade = mapped(row,'cidade',['cidade','city']); const bairro = mapped(row,'bairro',['bairro','neighborhood']);
      const website = mapped(row,'site',['site','website','url','websiteurl']);
      if (!nome) return null;
      const verific = website ? 'presente' : 'nao_informado';
      return { owner_id:user.id,nome_empresa:nome.slice(0,180),segmento:mapped(row,'segmento',['segmento','categoria','nicho','category'])||null,cidade:cidade||null,bairro:bairro||null,telefone:phone||null,telefone_normalizado:normPhone(phone)||null,site:website||null,verificacao_site:verific,rede_social:mapped(row,'social',['instagram','redesocial','social'])||null,nota_avaliacoes:Number(mapped(row,'nota',['nota','rating','avaliacao','ratingvalue']))||null,quantidade_avaliacoes:Number(mapped(row,'quantidade',['quantidadedeavaliacoes','reviews','reviewcount','avaliacoes']))||null,link_origem:mapped(row,'origem',['origem','source','linkorigem','googlemapsurl'])||null,status_contato:'novo',score:0 };
    }).filter((r):r is NonNullable<typeof r> => Boolean(r));
    const unique = prepared.filter(r => { const k=`${r.nome_empresa.toLowerCase()}|${(r.cidade??'').toLowerCase()}|${(r.bairro??'').toLowerCase()}`; if ((r.telefone_normalizado && existingPhones.has(r.telefone_normalizado)) || keys.has(k)) return false; if (r.telefone_normalizado) existingPhones.add(r.telefone_normalizado); keys.add(k); return true; });
    if (!unique.length) { setImporting(false); toast.info('Nenhuma linha nova válida; nomes/localização ou telefones já existem.'); return; }
    const {error}=await supabase.from('central_comercial_leads' as never).insert(unique as never);
    setImporting(false); if(error){toast.error(`Falha na importação: ${error.message}`);return;}
    toast.success(`${unique.length} leads importados; ${fileRows.length-unique.length} duplicados ou sem nome ignorados.`); setImportOpen(false); setFileRows([]); if(fileInput.current) fileInput.current.value=''; await carregar();
  };
  const exportar = () => {
    const rows = leads.map(l=>({'Empresa':l.nome_empresa,'Segmento':l.segmento,'Cidade':l.cidade,'Bairro':l.bairro,'Telefone':l.telefone,'Site':l.site,'Verificação do site':l.verificacao_site,'Status':rotuloEtapa(l.status_contato),'Score':l.score,'Próxima ação':l.proxima_acao,'Próxima ação em':l.proxima_acao_em,'Observações':l.observacoes}));
    const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Leads'); XLSX.writeFile(wb,'central-comercial-leads.xlsx');
  };

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Building2 className="h-4 w-4"/> Operação comercial</div><h1 className="text-3xl font-semibold tracking-tight">Central Comercial</h1><p className="mt-1 text-sm text-muted-foreground">Prospecção manual de sites para negócios locais · ticket padrão {brl(800)}</p></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/admin/central-comercial/relatorios"><BarChart3 className="mr-2 h-4 w-4"/>Relatórios e roteiros</Link></Button><Button asChild variant="outline"><Link to="/admin/central-comercial/financeiro">Vendas e caixa</Link></Button><input ref={fileInput} className="hidden" type="file" accept=".csv,.xlsx,.xls" onChange={e=>void lerArquivo(e.target.files?.[0])}/><Button variant="outline" onClick={()=>fileInput.current?.click()}><Upload className="mr-2 h-4 w-4"/>Importar</Button><Button variant="outline" onClick={exportar} disabled={!leads.length}><Download className="mr-2 h-4 w-4"/>Exportar</Button><Button onClick={()=>abrirLead()}><Plus className="mr-2 h-4 w-4"/>Novo lead</Button></div>
    </header>
    {loadError && <div role="alert" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0"/><div><p className="font-semibold">Configuração necessária</p><p className="mt-1">{loadError}</p></div></div>}
    <Tabs defaultValue="visao">
      <TabsList className="h-auto flex-wrap"><TabsTrigger value="visao">Visão geral</TabsTrigger><TabsTrigger value="leads">Leads</TabsTrigger><TabsTrigger value="funil">Funil comercial</TabsTrigger><TabsTrigger value="hoje">Ligações de hoje <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs">{hoje.length}</span></TabsTrigger></TabsList>
      <TabsContent value="visao" className="mt-5 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric title="Leads cadastrados" value={metrics.total} icon={<Building2/>}/><Metric title="Leads qualificados" value={metrics.qualified} icon={<Check/>}/><Metric title="Ligações realizadas hoje" value={metrics.calls} detail={`${metrics.answered} atendidas`} icon={<Phone/>}/><Metric title="Vendas fechadas" value={metrics.sales} detail={`${metrics.weekSales} nos últimos 7 dias`} icon={<ArrowUpRight/>}/></div>
        <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Atividade dos últimos 7 dias</CardTitle></CardHeader><CardContent className="flex gap-8"><div><p className="text-3xl font-semibold">{metrics.weekCalls}</p><p className="text-sm text-muted-foreground">ligações registradas</p></div><div><p className="text-3xl font-semibold">{metrics.weekSales}</p><p className="text-sm text-muted-foreground">vendas fechadas</p></div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Próxima ação</CardTitle></CardHeader><CardContent>{hoje.slice(0,3).map(l=><div key={l.id} className="flex items-center justify-between border-b py-2 last:border-0"><div><p className="font-medium">{l.nome_empresa}</p><p className="text-sm text-muted-foreground">{l.proxima_acao??'Primeiro contato'} · {l.proxima_acao_em?fmtData(l.proxima_acao_em):'sem horário definido'}</p></div><Button variant="ghost" size="sm" onClick={()=>setCallLead(l)}><Phone className="h-4 w-4"/></Button></div>)}{!hoje.length&&<p className="text-sm text-muted-foreground">Sem contatos na fila hoje. Cadastre leads ou agende um retorno.</p>}</CardContent></Card></div>
        <Card><CardHeader><CardTitle className="text-base">Operação, sem automação de contato</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3"><p><strong className="text-foreground">Meta inicial:</strong> 30 ligações por dia. A fila prioriza retornos vencidos e leads com maior score.</p><p><strong className="text-foreground">Demonstrações:</strong> só registre ou envie após autorização explícita do negócio.</p><p><strong className="text-foreground">Dados:</strong> métricas vêm dos registros reais deste módulo; listas vazias aparecem como zero.</p></CardContent></Card>
      </TabsContent>
      <TabsContent value="leads" className="mt-5 space-y-4"><div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input className="pl-9" placeholder="Buscar empresa, nicho, cidade ou telefone" value={busca} onChange={e=>setBusca(e.target.value)}/></div><Badge variant="outline" className="w-fit">{filtrados.length} leads</Badge></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtrados.map(l=><LeadCard key={l.id} lead={l} interactions={interacoes.filter(i=>i.lead_id===l.id)} onEdit={()=>abrirLead(l)} onCall={()=>{setCallLead(l);setRetornoEm('');setNota('');}} onStatus={s=>void salvarStatus(l,s)} onPause={()=>void pausarLead(l)}/>)}</div>{!loading&&!filtrados.length&&<Empty onAdd={()=>abrirLead()} onImport={()=>fileInput.current?.click()}/>}</TabsContent>
      <TabsContent value="funil" className="mt-5"><p className="mb-3 text-sm text-muted-foreground">Arraste os cartões para mover entre etapas. Cada movimentação fica no histórico. “Não contatar” é definitivo.</p><DndContext sensors={sensors} onDragEnd={aoSoltar}><div className="flex items-start gap-3 overflow-x-auto pb-4">{etapas.map(([stage,title])=><KanbanColumn key={stage} id={stage} title={title} count={leads.filter(l=>l.status_contato===stage).length}>{leads.filter(l=>l.status_contato===stage).map(l=><KanbanLead key={l.id} lead={l} onOpen={()=>abrirLead(l)}/>)}</KanbanColumn>)}</div></DndContext></TabsContent>
      <TabsContent value="hoje" className="mt-5 space-y-3"><div className="flex items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm"><Clock3 className="mt-0.5 h-4 w-4 shrink-0"/><p>Até 30 contatos elegíveis. Retornos vencidos vêm primeiro, depois score. Cada ligação é registrada manualmente; tentativa não significa atendimento. Pausar um lead libera espaço para o próximo da fila.</p></div>{hoje.map(l=><LeadCard key={l.id} lead={l} interactions={interacoes.filter(i=>i.lead_id===l.id)} onEdit={()=>abrirLead(l)} onCall={()=>{setCallLead(l);setRetornoEm('');setNota('');}} onStatus={s=>void salvarStatus(l,s)} onPause={()=>void pausarLead(l)} compact/>)}{!loading&&!hoje.length&&<Empty onAdd={()=>abrirLead()} onImport={()=>fileInput.current?.click()}/>}</TabsContent>
    </Tabs>
    {loading&&<div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>Carregando dados reais…</div>}

    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing?'Editar lead':'Cadastrar lead'}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2">{([['nome_empresa','Empresa'],['segmento','Segmento'],['cidade','Cidade'],['bairro','Bairro'],['telefone','Telefone comercial'],['site','Site'],['rede_social','Rede social pública'],['link_origem','Link da origem'],['responsavel','Responsável comercial']] as const).map(([k,label])=><Field key={k} label={label} value={String(draft[k]??'')} onChange={v=>setDraft(d=>({...d,[k]:v}))}/>)}<div className="space-y-2"><Label>Verificação do site</Label><Select value={draft.verificacao_site} onValueChange={v=>setDraft(d=>({...d,verificacao_site:v}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="nao_informado">Não informado</SelectItem><SelectItem value="presente">Site informado</SelectItem><SelectItem value="ausencia_confirmada">Ausência confirmada manualmente</SelectItem></SelectContent></Select></div><Field label="Score comercial (0–100)" type="number" value={String(draft.score)} onChange={v=>setDraft(d=>({...d,score:Math.min(100,Math.max(0,Number(v)||0))}))}/><div className="sm:col-span-2"><Field label="Justificativa do score" value={draft.justificativa_score??''} onChange={v=>setDraft(d=>({...d,justificativa_score:v}))}/></div><div className="sm:col-span-2 space-y-2"><Label>Observações</Label><Textarea value={draft.observacoes??''} onChange={e=>setDraft(d=>({...d,observacoes:e.target.value}))}/></div></div><DialogFooter><Button variant="outline" onClick={()=>setDialog(false)}>Cancelar</Button><Button disabled={saving} onClick={()=>void salvarLead()}>{saving&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Salvar lead</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(callLead)} onOpenChange={open=>!open&&setCallLead(null)}><DialogContent><DialogHeader><DialogTitle>Registrar ligação</DialogTitle></DialogHeader>{callLead&&<div className="space-y-4"><div className="rounded-lg bg-muted p-3"><p className="font-semibold">{callLead.nome_empresa}</p><p className="text-sm text-muted-foreground">{callLead.telefone||'Telefone não informado'}{callLead.segmento?` · ${callLead.segmento}`:''}</p></div><div className="space-y-2"><Label>Resultado da tentativa</Label><Select value={resultado} onValueChange={setResultado}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{resultados.map(([v,label])=><SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select></div>{scripts.length>0&&<div className="space-y-2"><Label>Roteiro usado (teste A/B)</Label><Select value={roteiroId||'__none'} onValueChange={v=>setRoteiroId(v==='__none'?'':v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="__none">Não atribuir roteiro</SelectItem>{scripts.map(s=><SelectItem key={s.id} value={s.id}>{s.nome} · versão {s.versao}</SelectItem>)}</SelectContent></Select></div>}<div className="space-y-2"><Label>Anotações</Label><Textarea value={nota} onChange={e=>setNota(e.target.value)} placeholder="Resumo objetivo da conversa"/></div>{!['nao_contatar','venda_fechada','numero_invalido','nao_atendeu'].includes(resultado)&&<div className="space-y-3"><Field label="Próxima ação (opcional)" value={retornoAcao} onChange={setRetornoAcao}/><div className="space-y-2"><Label>Data e hora do retorno (opcional)</Label><Input type="datetime-local" value={retornoEm} onChange={e=>setRetornoEm(e.target.value)}/></div></div>}<p className="text-xs text-muted-foreground">Registro manual. Nenhuma chamada ou mensagem será iniciada pelo sistema.</p></div>}<DialogFooter><Button variant="outline" onClick={()=>setCallLead(null)}>Cancelar</Button><Button disabled={saving} onClick={()=>void registrarLigacao()}>{saving&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Salvar registro</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle><FileUp className="mr-2 inline h-5 w-5"/>Importar leads</DialogTitle></DialogHeader><div className="space-y-3 text-sm"><p>Arquivo: <strong>{fileName}</strong> · {fileRows.length} linhas. Confira o mapeamento detectado e ajuste colunas abaixo.</p><div className="grid gap-3 sm:grid-cols-2">{([['nome','Empresa (obrigatório)'],['segmento','Segmento'],['cidade','Cidade'],['bairro','Bairro'],['telefone','Telefone'],['site','Site'],['social','Rede social'],['nota','Nota'],['quantidade','Quantidade de avaliações'],['origem','Link da origem']] as const).map(([field,label])=><div key={field} className="space-y-1"><Label className="text-xs">{label}</Label><Select value={columnMap[field]??'__ignorar'} onValueChange={v=>setColumnMap(m=>({...m,[field]:v==='__ignorar'?'':v}))}><SelectTrigger className="h-9"><SelectValue placeholder="Ignorar coluna"/></SelectTrigger><SelectContent><SelectItem value="__ignorar">Ignorar</SelectItem>{Object.keys(fileRows[0]??{}).map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>)}</div><p>Duplicatas por telefone normalizado ou empresa + cidade + bairro são ignoradas. Site ausente fica como “não informado”; nenhum dado será inferido.</p><p className="text-muted-foreground">Linhas válidas encontradas: {fileRows.filter(r=>clean(r[columnMap.nome])).length}.</p></div><DialogFooter><Button variant="outline" onClick={()=>setImportOpen(false)}>Cancelar</Button><Button disabled={importing||!columnMap.nome} onClick={()=>void importar()}>{importing?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Upload className="mr-2 h-4 w-4"/>}Importar sem duplicatas</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({title,value,detail,icon}:{title:string;value:number;detail?:string;icon:React.ReactNode}) { return <Card><CardContent className="flex items-start justify-between p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-3xl font-semibold">{value}</p>{detail&&<p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div><span className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</span></CardContent></Card>; }
function Field({label,value,onChange,type='text'}:{label:string;value:string;onChange:(v:string)=>void;type?:string}) {return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} onChange={e=>onChange(e.target.value)} /></div>}
function LeadCard({lead,interactions,onEdit,onCall,onStatus,onPause,compact=false}:{lead:Lead;interactions:Interaction[];onEdit:()=>void;onCall:()=>void;onStatus:(s:string)=>void;onPause:()=>void;compact?:boolean}) {
  const last=interactions[0]; const phone=lead.telefone?`tel:${lead.telefone.replace(/[^\d+]/g,'')}`:null;
  const script = `Olá, tudo bem? Meu nome é Oliver. Estou entrando em contato porque encontrei a ${lead.nome_empresa}${lead.segmento?`, que atua com ${lead.segmento}`:''}. Eu desenvolvo páginas profissionais que apresentam o negócio e direcionam interessados ao WhatsApp. Posso fazer duas perguntas rápidas para entender se uma demonstração faria sentido?`;
  return <Card className="overflow-hidden"><CardContent className="space-y-3 p-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><button className="truncate text-left font-semibold hover:underline" onClick={onEdit}>{lead.nome_empresa}</button><p className="truncate text-sm text-muted-foreground">{[lead.segmento,lead.bairro,lead.cidade].filter(Boolean).join(' · ')||'Segmento/localização não informados'}</p></div><Badge variant={lead.status_contato==='nao_contatar'?'destructive':'secondary'}>{rotuloEtapa(lead.status_contato)}</Badge></div><div className="flex flex-wrap gap-x-3 gap-y-1 text-sm"><span>Score <b>{lead.score}</b></span><span>{lead.verificacao_site==='ausencia_confirmada'?'Ausência de site confirmada':lead.verificacao_site==='presente'?'Site informado':'Site não informado'}</span>{lead.nota_avaliacoes!==null&&<span>★ {lead.nota_avaliacoes}{lead.quantidade_avaliacoes?` (${lead.quantidade_avaliacoes})`:''}</span>}</div>{lead.justificativa_score&&<p className="text-xs text-muted-foreground">{lead.justificativa_score}</p>}{lead.observacoes&&<p className="line-clamp-2 text-sm text-muted-foreground">{lead.observacoes}</p>}<details className="rounded bg-muted/50 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Sugestão de abertura</summary><p className="mt-2 leading-relaxed text-muted-foreground">{script}</p></details>{lead.proxima_acao_em&&<p className="flex items-center gap-1 text-xs text-primary"><CalendarClock className="h-3.5 w-3.5"/>{lead.proxima_acao??'Retorno'} · {fmtData(lead.proxima_acao_em)}</p>}{last&&<p className="text-xs text-muted-foreground">Última interação: {last.observacoes?.startsWith('Etapa alterada')?last.observacoes:resultados.find(([v])=>v===last.resultado)?.[1]??last.tipo} · {fmtData(last.ocorreu_em)}</p>}<div className="flex flex-wrap items-center gap-2 border-t pt-3">{phone?<Button size="sm" variant="outline" asChild><a href={phone}><Phone className="mr-1.5 h-3.5 w-3.5"/>{lead.telefone}</a></Button>:<span className="text-xs text-muted-foreground">Sem telefone</span>}{lead.link_origem&&<Button size="sm" variant="ghost" asChild><a href={lead.link_origem} target="_blank" rel="noreferrer">Origem <ArrowUpRight className="ml-1 h-3.5 w-3.5"/></a></Button>}{lead.site&&<Button size="sm" variant="ghost" asChild><a href={lead.site.startsWith('http')?lead.site:`https://${lead.site}`} target="_blank" rel="noreferrer">Site <ArrowUpRight className="ml-1 h-3.5 w-3.5"/></a></Button>}<Button size="sm" onClick={onCall} disabled={lead.status_contato==='nao_contatar'}>Registrar ligação</Button><Button size="sm" variant="ghost" onClick={onPause} title="Pausar este contato até o fim do dia"><Clock3 className="mr-1 h-3.5 w-3.5"/>Pausar hoje</Button><Select value={lead.status_contato} onValueChange={onStatus} disabled={lead.status_contato==='nao_contatar'}><SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue/></SelectTrigger><SelectContent>{etapas.map(([v,label])=><SelectItem key={v} value={v}>{label}</SelectItem>)}</SelectContent></Select></div></CardContent></Card>;
}
function Empty({onAdd,onImport}:{onAdd:()=>void;onImport:()=>void}) {return <Card className="col-span-full border-dashed"><CardContent className="flex flex-col items-center py-12 text-center"><Building2 className="mb-3 h-8 w-8 text-muted-foreground"/><h3 className="font-semibold">Nenhum lead cadastrado</h3><p className="mt-1 max-w-md text-sm text-muted-foreground">Comece cadastrando uma empresa ou importando um arquivo obtido de fonte autorizada.</p><div className="mt-4 flex gap-2"><Button onClick={onAdd}><Plus className="mr-2 h-4 w-4"/>Cadastrar empresa</Button><Button variant="outline" onClick={onImport}><Upload className="mr-2 h-4 w-4"/>Importar CSV/XLSX</Button></div></CardContent></Card>;}
function KanbanColumn({id,title,count,children}:{id:string;title:string;count:number;children:React.ReactNode}){const {setNodeRef,isOver}=useDroppable({id});return <section ref={setNodeRef} className={`min-h-44 w-64 shrink-0 rounded-xl border p-2 ${isOver?'border-primary bg-primary/5':'bg-muted/40'}`}><header className="mb-2 flex items-center justify-between gap-2 px-1"><h3 className="text-sm font-semibold">{title}</h3><Badge variant="outline">{count}</Badge></header><div className="space-y-2">{children}</div></section>}
function KanbanLead({lead,onOpen}:{lead:Lead;onOpen:()=>void}){const {attributes,listeners,setNodeRef,transform,isDragging}=useDraggable({id:lead.id,disabled:lead.status_contato==='nao_contatar'});const style=transform?{transform:`translate3d(${transform.x}px, ${transform.y}px, 0)`}:undefined;return <button ref={setNodeRef} style={style} {...listeners} {...attributes} onDoubleClick={onOpen} className={`w-full rounded-lg border bg-card p-3 text-left shadow-sm ${isDragging?'opacity-40':''}`} title="Arraste para mover; clique duas vezes para abrir"><span className="block truncate text-sm font-medium">{lead.nome_empresa}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{[lead.segmento,lead.cidade].filter(Boolean).join(' · ')||'Sem nicho/localização'}</span><span className="mt-2 text-xs">Score {lead.score}</span></button>}

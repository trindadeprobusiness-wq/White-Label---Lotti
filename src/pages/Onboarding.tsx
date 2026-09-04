import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BadgeCheck, BriefcaseBusiness, Building2, Check,
  CheckCircle2, Clock3, FileSpreadsheet, Home, Loader2, MapPin, ShieldCheck,
  Sparkles, UserRound, Users, WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LottiLogo } from '@/components/brand/LottiLogo';
import { OnboardingAssistant } from '@/components/onboarding/OnboardingAssistant';
import { AsaasConnectionPanel } from '@/components/configuracoes/AsaasConnectionPanel';
import { useOnboarding, type EventoOnboarding } from '@/hooks/useOnboarding';
import { useCRMStore } from '@/stores/crmStore';
import {
  calcularProgresso,
  etapasDaPersona,
  type ObjetivoOnboarding,
  type PersonaOnboarding,
} from '@/lib/onboarding/regras';
import { cn } from '@/lib/utils';

interface DraftOnboarding {
  persona: PersonaOnboarding | null;
  objetivo: ObjetivoOnboarding | null;
  entradaDados: 'manual' | 'importacao' | 'demonstracao' | 'depois' | null;
  perfil: {
    nome: string; telefone: string; cidade: string; estado: string; tipoAtuacao: string;
    creci: string; regioes: string; especialidade: string; fuso: string;
  };
  empresa: {
    nome: string; nomeComercial: string; cnpj: string; telefone: string; email: string;
    cidade: string; estado: string; tamanho: string; tipo: string; operacoes: string[];
  };
  imovel: {
    tipo: string; finalidade: string; titulo: string; cidade: string; bairro: string;
    estado: string; valor: string; endereco: string;
  };
  cliente: {
    nome: string; telefone: string; email: string; interesse: string; faixaPreco: string;
    regiao: string; origem: string;
  };
  oportunidade: { titulo: string; valor: string; clienteId: string; imovelId: string };
  tarefa: {
    titulo: string; descricao: string; tipo: string; data: string; clienteId: string;
    frequencia: string; lembreteMinutos: string; responsavelId: string;
  };
  convite: { token: string; email: string; papel: string };
}

const NOVO_DRAFT: DraftOnboarding = {
  persona: null,
  objetivo: null,
  entradaDados: null,
  perfil: { nome: '', telefone: '', cidade: '', estado: 'SP', tipoAtuacao: '', creci: '', regioes: '', especialidade: '', fuso: 'America/Sao_Paulo' },
  empresa: { nome: '', nomeComercial: '', cnpj: '', telefone: '', email: '', cidade: '', estado: 'SP', tamanho: '', tipo: 'imobiliaria', operacoes: [] },
  imovel: { tipo: 'CASA', finalidade: 'VENDA', titulo: '', cidade: '', bairro: '', estado: 'SP', valor: '', endereco: '' },
  cliente: { nome: '', telefone: '', email: '', interesse: 'COMPRA', faixaPreco: '', regiao: '', origem: 'Indicacao' },
  oportunidade: { titulo: 'Primeira oportunidade', valor: '', clienteId: '', imovelId: '' },
  tarefa: {
    titulo: 'Fazer follow-up', descricao: '', tipo: 'WHATSAPP', data: amanhaLocal(), clienteId: '',
    frequencia: 'unica', lembreteMinutos: '15', responsavelId: '',
  },
  convite: { token: '', email: '', papel: 'corretor' },
};

const ROTULOS_ETAPAS: Record<string, string> = {
  boas_vindas: 'Boas-vindas', persona: 'Seu perfil', aceitar_convite: 'Convite', perfil: 'Perfil profissional',
  empresa: 'Empresa', objetivo: 'Objetivo', entrada_dados: 'Primeiros dados', primeiro_imovel: 'Primeiro imóvel',
  asaas: 'Conta Asaas',
  primeiro_cliente: 'Primeiro cliente', primeira_oportunidade: 'Oportunidade', primeira_rotina: 'Próxima ação',
  equipe: 'Equipe', conclusao: 'Conclusão',
};

function amanhaLocal(): string {
  const data = new Date(Date.now() + 24 * 60 * 60 * 1000);
  data.setHours(10, 0, 0, 0);
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

function mergeDraft(metadata: Record<string, unknown>): DraftOnboarding {
  const salvo = objeto(metadata.draft);
  return {
    ...NOVO_DRAFT,
    ...salvo,
    perfil: { ...NOVO_DRAFT.perfil, ...objeto(salvo.perfil) },
    empresa: { ...NOVO_DRAFT.empresa, ...objeto(salvo.empresa) },
    imovel: { ...NOVO_DRAFT.imovel, ...objeto(salvo.imovel) },
    cliente: { ...NOVO_DRAFT.cliente, ...objeto(salvo.cliente) },
    oportunidade: { ...NOVO_DRAFT.oportunidade, ...objeto(salvo.oportunidade) },
    tarefa: { ...NOVO_DRAFT.tarefa, ...objeto(salvo.tarefa) },
    convite: { ...NOVO_DRAFT.convite, ...objeto(salvo.convite) },
  } as DraftOnboarding;
}

function primeiroNome(nome: string | undefined): string {
  return nome?.trim().split(/\s+/)[0] || 'você';
}

function numeroMonetario(valor: string): number {
  const limpo = valor.replace(/[^\d,.]/g, '');
  if (!limpo) return 0;
  if (limpo.includes(',')) return Number(limpo.replace(/\./g, '').replace(',', '.')) || 0;
  if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) return Number(limpo.replace(/\./g, '')) || 0;
  return Number(limpo) || 0;
}

const EVENTO_POR_ETAPA: Partial<Record<string, EventoOnboarding>> = {
  boas_vindas: 'onboarding_started', persona: 'persona_selected', perfil: 'profile_completed', primeiro_imovel: 'first_property_created',
  primeiro_cliente: 'first_client_created', primeira_oportunidade: 'first_deal_created',
  primeira_rotina: 'first_task_created', equipe: 'team_member_invited', conclusao: 'onboarding_completed',
};

export default function Onboarding() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    contexto, carregando, disponivel, salvar, executarAcao, atualizarPerfilProfissional,
    atualizarOrganizacao, registrarEvento, criarConvite, aceitarConvite, recarregar,
  } = useOnboarding();
  const { corretor, clientes, imoveis, fetchCorretor, fetchClientes, fetchImoveis } = useCRMStore();
  const [draft, setDraft] = useState<DraftOnboarding>(NOVO_DRAFT);
  const [inicializado, setInicializado] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [conviteGerado, setConviteGerado] = useState('');
  const assinaturaDraft = useRef('');

  useEffect(() => {
    void Promise.all([fetchCorretor(), fetchClientes(), fetchImoveis()]);
  }, [fetchClientes, fetchCorretor, fetchImoveis]);

  useEffect(() => {
    if (!contexto || inicializado) return;
    const recuperado = mergeDraft(contexto.metadata);
    if (!recuperado.persona && contexto.persona) recuperado.persona = contexto.persona;
    if (!recuperado.objetivo && contexto.objetivo) recuperado.objetivo = contexto.objetivo;
    if (!recuperado.perfil.nome && corretor?.nome) recuperado.perfil.nome = corretor.nome;
    if (!recuperado.perfil.telefone && corretor?.telefone) recuperado.perfil.telefone = corretor.telefone;
    setDraft(recuperado);
    assinaturaDraft.current = JSON.stringify(recuperado);
    setInicializado(true);
  }, [contexto, corretor, inicializado]);

  // Autosave do rascunho: nenhum campo digitado depende do botão Avançar.
  useEffect(() => {
    if (!inicializado || !disponivel) return;
    const assinatura = JSON.stringify(draft);
    if (assinatura === assinaturaDraft.current) return;
    const timer = window.setTimeout(() => {
      salvar.mutate({ profile: { metadata: { draft } } });
      assinaturaDraft.current = assinatura;
    }, 700);
    return () => window.clearTimeout(timer);
  }, [disponivel, draft, inicializado, salvar]);

  const persona = draft.persona ?? contexto?.persona ?? null;
  const etapas = useMemo(
    () => persona ? etapasDaPersona(persona) : ['boas_vindas', 'persona'],
    [persona],
  );
  const solicitada = searchParams.get('etapa');
  const etapa = solicitada && etapas.includes(solicitada)
    ? solicitada
    : (contexto?.etapaAtual && etapas.includes(contexto.etapaAtual) ? contexto.etapaAtual : etapas[0]);
  const indice = Math.max(0, etapas.indexOf(etapa));
  const progresso = calcularProgresso(etapas.length, contexto?.etapasConcluidas ?? [], contexto?.etapasPuladas ?? []);
  const etapaNumero = Math.min(indice + 1, etapas.length);
  const progressoVisual = persona
    ? Math.max(progresso, Math.round(((indice + 1) / etapas.length) * 100))
    : (etapa === 'boas_vindas' ? 8 : 15);
  const podePular = ['empresa', 'asaas', 'entrada_dados', 'primeiro_imovel', 'primeiro_cliente', 'primeira_oportunidade', 'primeira_rotina', 'equipe'].includes(etapa);

  useEffect(() => {
    const token = searchParams.get('invite');
    if (token && !draft.convite.token) {
      setDraft((atual) => ({ ...atual, persona: 'usuario_convidado', convite: { ...atual.convite, token } }));
      setSearchParams({ etapa: 'aceitar_convite', invite: token }, { replace: true });
    }
  }, [draft.convite.token, searchParams, setSearchParams]);

  const irPara = (proxima: string) => {
    setSearchParams({ etapa: proxima }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const concluirEtapa = async (overrideProxima?: string) => {
    const concluidas = Array.from(new Set([...(contexto?.etapasConcluidas ?? []), etapa]));
    const proxima = overrideProxima ?? etapas[Math.min(indice + 1, etapas.length - 1)];
    await salvar.mutateAsync({
      profile: { persona: draft.persona, primary_goal: draft.objetivo, data_entry_strategy: draft.entradaDados, metadata: { draft } },
      progress: { current_step: proxima, completed_steps: concluidas },
      stepKey: etapa,
      stepStatus: 'concluido',
    });
    const evento = EVENTO_POR_ETAPA[etapa];
    if (evento && !['primeiro_imovel', 'primeiro_cliente', 'primeira_oportunidade', 'primeira_rotina', 'equipe', 'conclusao'].includes(etapa)) {
      await registrarEvento(evento, etapa, draft.persona ? { persona: draft.persona } : undefined);
    }
    irPara(proxima);
  };

  const pularEtapa = async () => {
    const puladas = Array.from(new Set([...(contexto?.etapasPuladas ?? []), etapa]));
    const proxima = etapas[Math.min(indice + 1, etapas.length - 1)];
    await salvar.mutateAsync({
      progress: { current_step: proxima, skipped_steps: puladas },
      stepKey: etapa,
      stepStatus: 'pulado',
    });
    await registrarEvento('onboarding_step_skipped', etapa, { step: etapa });
    irPara(proxima);
  };

  const voltar = () => {
    if (indice === 0) return;
    irPara(etapas[indice - 1]);
  };

  const explorar = async () => {
    await salvar.mutateAsync({ progress: { dismiss: true, current_step: etapa } });
    await registrarEvento('onboarding_abandoned', etapa, { step: etapa });
    navigate((location.state as { returnTo?: string } | null)?.returnTo || '/', { replace: true });
  };

  const executar = async (acao: () => Promise<void>) => {
    if (processando) return;
    setProcessando(true);
    try { await acao(); } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar. Verifique os dados e tente novamente.');
    } finally { setProcessando(false); }
  };

  const salvarPerfil = () => executar(async () => {
    if (!draft.perfil.nome.trim() || !draft.perfil.telefone.trim() || !draft.perfil.cidade.trim()) {
      toast.error('Informe nome, telefone e cidade para continuar.'); return;
    }
    const creciStatus = draft.perfil.creci.trim() ? 'aguardando_validacao' : 'nao_informado';
    await atualizarPerfilProfissional.mutateAsync({
      nome: draft.perfil.nome.trim(), telefone: draft.perfil.telefone.trim(), cidade: draft.perfil.cidade.trim(),
      estado: draft.perfil.estado, tipo_atuacao: draft.perfil.tipoAtuacao || null,
      creci: draft.perfil.creci.trim() || 'PENDENTE', regioes_atendidas: draft.perfil.regioes.split(',').map((item) => item.trim()).filter(Boolean),
      especialidade: draft.perfil.especialidade || null, fuso_horario: draft.perfil.fuso, creci_status: creciStatus,
    });
    await salvar.mutateAsync({ profile: { creci_status: creciStatus } });
    await concluirEtapa();
  });

  const salvarEmpresa = () => executar(async () => {
    if (!contexto?.organizacao?.id || !draft.empresa.nome.trim()) { toast.error('Informe o nome da empresa.'); return; }
    await atualizarOrganizacao.mutateAsync({
      id: contexto.organizacao.id, nome: draft.empresa.nome.trim(), nome_comercial: draft.empresa.nomeComercial.trim() || null,
      cnpj: draft.empresa.cnpj.trim() || null, telefone: draft.empresa.telefone.trim() || null,
      email: draft.empresa.email.trim() || null, cidade: draft.empresa.cidade.trim() || null, estado: draft.empresa.estado,
      tamanho_equipe: draft.empresa.tamanho || null, tipo_organizacao: draft.empresa.tipo, tipo_operacao: draft.empresa.operacoes,
    });
    await registrarEvento('organization_created', etapa, { organization_type: draft.empresa.tipo });
    await concluirEtapa();
  });

  const prepararEntrada = () => executar(async () => {
    if (!draft.entradaDados) { toast.error('Escolha como deseja começar.'); return; }
    if (draft.entradaDados === 'demonstracao') {
      const demo = { is_sample_data: true };
      await executarAcao.mutateAsync({ action: 'sample_property', payload: { ...demo, titulo: 'Casa Jardim — demonstração', tipo: 'CASA', finalidade: 'VENDA', valor: 680000, cidade: 'São Paulo', bairro: 'Jardim Europa', estado: 'SP' } });
      await executarAcao.mutateAsync({ action: 'sample_client', payload: { ...demo, nome: 'Cliente demonstração', telefone: '(11) 90000-0000', tipo_interesse: 'COMPRA', regiao: 'Zona Oeste', faixa_preco: 'R$ 600 mil a R$ 750 mil', origem: 'demonstracao' } });
      await executarAcao.mutateAsync({ action: 'sample_deal', payload: { ...demo, titulo: 'Visita à Casa Jardim', valor_estimado: 680000 } });
      await executarAcao.mutateAsync({ action: 'sample_task', payload: { ...demo, titulo: 'Confirmar visita de demonstração', tipo: 'WHATSAPP', data_prevista: new Date(Date.now() + 86_400_000).toISOString() } });
      toast.success('Demonstração criada e isolada dos seus indicadores reais.');
    }
    await concluirEtapa();
  });

  const removerDemonstracao = () => executar(async () => {
    await executarAcao.mutateAsync({ action: 'remove_samples' });
    await Promise.all([recarregar(), fetchClientes(), fetchImoveis()]);
    toast.success('Dados de demonstração removidos. Seus registros reais foram preservados.');
  });

  const criarImovel = () => executar(async () => {
    await executarAcao.mutateAsync({ action: 'first_property', payload: {
      tipo: draft.imovel.tipo, finalidade: draft.imovel.finalidade, titulo: draft.imovel.titulo,
      cidade: draft.imovel.cidade, bairro: draft.imovel.bairro, estado: draft.imovel.estado,
      valor: numeroMonetario(draft.imovel.valor),
      endereco: draft.imovel.endereco,
    } });
    await registrarEvento('first_property_created', etapa);
    await recarregar();
    await fetchImoveis();
    toast.success('Seu primeiro imóvel está pronto.');
    await concluirEtapa();
  });

  const criarCliente = () => executar(async () => {
    await executarAcao.mutateAsync({ action: 'first_client', payload: {
      nome: draft.cliente.nome, telefone: draft.cliente.telefone, email: draft.cliente.email,
      tipo_interesse: draft.cliente.interesse, faixa_preco: draft.cliente.faixaPreco,
      regiao: draft.cliente.regiao, origem: draft.cliente.origem,
    } });
    await registrarEvento('first_client_created', etapa, { source: draft.cliente.origem || 'onboarding' });
    await recarregar();
    await fetchClientes();
    toast.success('Primeiro cliente cadastrado.');
    await concluirEtapa();
  });

  const criarOportunidade = () => executar(async () => {
    await executarAcao.mutateAsync({ action: 'first_deal', payload: {
      titulo: draft.oportunidade.titulo, valor_estimado: numeroMonetario(draft.oportunidade.valor),
      cliente_id: draft.oportunidade.clienteId || undefined, imovel_id: draft.oportunidade.imovelId || undefined,
    } });
    await registrarEvento('first_deal_created', etapa);
    await recarregar();
    toast.success('Oportunidade criada no funil real.');
    await concluirEtapa();
  });

  const criarTarefa = () => executar(async () => {
    await executarAcao.mutateAsync({ action: 'first_task', payload: {
      titulo: draft.tarefa.titulo, descricao: draft.tarefa.descricao, tipo: draft.tarefa.tipo,
      data_prevista: new Date(draft.tarefa.data).toISOString(), cliente_id: draft.tarefa.clienteId || undefined,
      frequencia: draft.tarefa.frequencia,
      lembrete_minutos: Number(draft.tarefa.lembreteMinutos || 0),
      responsavel_id: draft.tarefa.responsavelId || contexto?.userId || undefined,
      timezone: draft.perfil.fuso,
    } });
    await registrarEvento('first_task_created', etapa);
    await recarregar();
    toast.success('Próxima ação adicionada à rotina.');
    await concluirEtapa();
  });

  const convidar = () => executar(async () => {
    if (!draft.convite.email.trim()) { toast.error('Informe o e-mail da pessoa convidada.'); return; }
    const resultado = await criarConvite.mutateAsync({ email: draft.convite.email, papel: draft.convite.papel });
    const link = `${window.location.origin}/onboarding?invite=${encodeURIComponent(resultado.token)}&etapa=aceitar_convite`;
    setConviteGerado(link);
    await registrarEvento('team_member_invited', etapa, { role: draft.convite.papel });
    toast.success('Convite preparado. Compartilhe o link com a pessoa.');
  });

  const aceitar = () => executar(async () => {
    if (!draft.convite.token.trim()) { toast.error('Cole o código do convite.'); return; }
    await aceitarConvite.mutateAsync(draft.convite.token.trim());
    toast.success('Convite aceito. Você entrou na organização.');
    await concluirEtapa();
  });

  const finalizar = () => executar(async () => {
    await salvar.mutateAsync({
      progress: { complete: true, current_step: 'conclusao' }, stepKey: 'conclusao', stepStatus: 'concluido',
    });
    await registrarEvento('onboarding_completed', 'conclusao', { persona: draft.persona ?? 'nao_informada' });
    navigate('/', { replace: true });
  });

  const assistenteAcao = (tipo: string, destino?: string) => {
    if (tipo === 'preencher_tarefa') {
      setDraft((atual) => ({ ...atual, tarefa: { ...atual.tarefa, titulo: 'Fazer follow-up', data: amanhaLocal() } }));
      if (etapas.includes('primeira_rotina')) irPara('primeira_rotina');
    } else if (tipo === 'abrir_importacao') {
      setDraft((atual) => ({ ...atual, entradaDados: 'importacao' }));
      if (etapas.includes('entrada_dados')) irPara('entrada_dados');
    } else if (destino) {
      const alvo = new URL(destino, window.location.origin).searchParams.get('etapa');
      if (alvo && etapas.includes(alvo)) irPara(alvo);
    }
  };

  if (carregando) return <TelaCarregando />;
  if (!disponivel || !contexto) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary p-5">
        <Card className="max-w-lg"><CardContent className="space-y-4 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-primary" />
          <h1 className="text-xl font-semibold">Onboarding aguardando ativação</h1>
          <p className="text-sm text-muted-foreground">A interface está pronta, mas a migration do onboarding ainda precisa ser aplicada no Supabase.</p>
          <Button asChild><Link to="/">Continuar para o painel</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  if (!inicializado) return <TelaCarregando />;

  return (
    <div className="min-h-screen bg-[#F4F6F2] text-foreground">
      <header className="border-b border-[#DDE4DC] bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <LottiLogo className="h-8 w-auto" />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">Rascunho salvo automaticamente</span>
            <Button variant="ghost" size="sm" disabled={processando} onClick={() => void executar(explorar)}>Continuar depois</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-6 px-4 py-5 sm:px-8 lg:grid-cols-[260px_minmax(0,1fr)_330px] lg:py-8">
        <aside className="rounded-2xl bg-[#0A3A2C] p-5 text-white shadow-sm lg:sticky lg:top-8 lg:self-start" aria-label="Progresso do onboarding">
          <div className="mb-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Sua operação</p>
            <p className="text-3xl font-semibold tracking-tight">{progressoVisual}%</p>
            <Progress value={progressoVisual} className="mt-3 h-1.5 bg-white/15 [&>div]:bg-[#D9B96E]" />
            <p className="mt-3 text-xs leading-5 text-white/65">
              {persona
                ? `Etapa ${etapaNumero} de ${etapas.length} · cerca de ${Math.max(2, etapas.length - etapaNumero + 1)} min restantes`
                : 'Primeiros passos · cerca de 10 min restantes'}
            </p>
          </div>
          <ol className="space-y-1">
            {etapas.map((item, itemIndice) => {
              const concluida = contexto.etapasConcluidas.includes(item);
              const ativa = item === etapa;
              return (
                <li key={item}>
                  <button type="button" onClick={() => itemIndice <= indice && irPara(item)} disabled={itemIndice > indice} className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                    ativa ? 'bg-white/12 text-white' : 'text-white/55', itemIndice <= indice && !ativa && 'hover:bg-white/5 hover:text-white/80',
                  )}>
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]', ativa ? 'border-[#D9B96E] bg-[#D9B96E] text-[#0A3A2C]' : concluida ? 'border-white/40 bg-white/15' : 'border-white/20')}>
                      {concluida ? <Check className="h-3 w-3" /> : itemIndice + 1}
                    </span>
                    <span className="truncate">{ROTULOS_ETAPAS[item] ?? item}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className="min-w-0 rounded-2xl border border-[#DDE4DC] bg-white shadow-sm">
          <div className="min-h-[590px] p-5 sm:p-8 lg:p-10">
            <EtapaConteudo
              etapa={etapa}
              draft={draft}
              setDraft={setDraft}
              contexto={contexto}
              clientes={clientes}
              imoveis={imoveis}
              conviteGerado={conviteGerado}
              processando={processando}
              onNext={() => void concluirEtapa()}
              onPerfil={salvarPerfil}
              onEmpresa={salvarEmpresa}
              onEntrada={prepararEntrada}
              onRemoverDemo={removerDemonstracao}
              onImovel={criarImovel}
              onCliente={criarCliente}
              onOportunidade={criarOportunidade}
              onTarefa={criarTarefa}
              onConvidar={convidar}
              onAceitar={aceitar}
              onFinalizar={finalizar}
              onCopiarConvite={() => conviteGerado && void navigator.clipboard.writeText(conviteGerado).then(() => toast.success('Link copiado.'))}
            />
          </div>
          {etapa !== 'boas_vindas' && etapa !== 'conclusao' && (
            <footer className="flex flex-col-reverse gap-3 border-t border-[#E8ECE6] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <Button variant="ghost" onClick={voltar}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button>
              {podePular && <Button variant="ghost" className="text-muted-foreground" onClick={() => void pularEtapa()}>Pular por agora</Button>}
            </footer>
          )}
        </section>

        <div className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <OnboardingAssistant persona={persona} etapa={etapa} onAction={assistenteAcao} />
          <ResumoPlano contexto={contexto} />
        </div>
      </main>
    </div>
  );
}

function TituloEtapa({ eyebrow, titulo, descricao }: { eyebrow: string; titulo: string; descricao: string }) {
  return <div className="mb-7"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{titulo}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{descricao}</p></div>;
}

function Campo({ id, label, children, ajuda }: { id: string; label: string; children: React.ReactNode; ajuda?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}{ajuda && <p className="text-xs leading-5 text-muted-foreground">{ajuda}</p>}</div>;
}

function EscolhaCard({ ativo, titulo, descricao, icone: Icone, onClick }: { ativo: boolean; titulo: string; descricao: string; icone: React.ElementType; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={ativo} className={cn('group relative flex min-h-32 w-full flex-col items-start rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', ativo ? 'border-primary bg-primary/[0.045] shadow-sm' : 'border-border hover:border-primary/35 hover:bg-secondary/60')}><span className={cn('mb-4 flex h-9 w-9 items-center justify-center rounded-lg', ativo ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground group-hover:text-primary')}><Icone className="h-4 w-4" /></span><span className="font-semibold">{titulo}</span><span className="mt-1 text-sm leading-5 text-muted-foreground">{descricao}</span>{ativo && <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-primary" />}</button>;
}

type EtapaProps = {
  etapa: string; draft: DraftOnboarding; setDraft: React.Dispatch<React.SetStateAction<DraftOnboarding>>;
  contexto: NonNullable<ReturnType<typeof useOnboarding>['contexto']>; clientes: ReturnType<typeof useCRMStore.getState>['clientes'];
  imoveis: ReturnType<typeof useCRMStore.getState>['imoveis']; conviteGerado: string; processando: boolean;
  onNext: () => void; onPerfil: () => void; onEmpresa: () => void; onEntrada: () => void; onImovel: () => void;
  onRemoverDemo: () => void;
  onCliente: () => void; onOportunidade: () => void; onTarefa: () => void; onConvidar: () => void; onAceitar: () => void;
  onFinalizar: () => void; onCopiarConvite: () => void;
};

function EtapaConteudo(props: EtapaProps) {
  const { etapa, draft, setDraft, contexto, clientes, imoveis, conviteGerado, processando } = props;
  const atualizar = <K extends keyof DraftOnboarding>(secao: K, campos: Partial<DraftOnboarding[K]>) => setDraft((atual) => ({ ...atual, [secao]: typeof atual[secao] === 'object' && atual[secao] !== null ? { ...atual[secao] as object, ...campos } : campos }));
  const botao = (texto: string, onClick: () => void, disabled = false) => <Button className="w-full sm:w-auto" size="lg" onClick={onClick} disabled={disabled || processando}>{processando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{texto}<ArrowRight className="ml-2 h-4 w-4" /></Button>;

  if (etapa === 'boas_vindas') return <div className="flex min-h-[520px] flex-col justify-center"><div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><Sparkles className="h-6 w-6" /></div><p className="mb-2 text-sm font-medium text-primary">Olá, {primeiroNome(draft.perfil.nome)}</p><h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Vamos preparar a Lotti para a sua rotina imobiliária.</h1><p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">Em poucos minutos, você terá sua operação organizada e pronta para receber clientes, imóveis e negociações.</p><div className="my-8 flex flex-wrap gap-5 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" />5 a 10 minutos</span><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Salvamento automático</span><span className="flex items-center gap-2"><WandSparkles className="h-4 w-4 text-primary" />Ajuda contextual</span></div><div>{botao('Configurar minha operação', props.onNext)}</div></div>;

  if (etapa === 'persona') return <><TituloEtapa eyebrow="Seu caminho" titulo="Como você pretende usar a Lotti?" descricao="A resposta adapta os próximos passos. Você não verá configurações que não fazem parte da sua rotina." /><div className="grid gap-3 sm:grid-cols-2"><EscolhaCard ativo={draft.persona === 'corretor_autonomo'} titulo="Corretor autônomo" descricao="Clientes, imóveis, negociações e rotina individual." icone={UserRound} onClick={() => setDraft((a) => ({ ...a, persona: 'corretor_autonomo' }))} /><EscolhaCard ativo={draft.persona === 'gestor_imobiliaria'} titulo="Dono ou gestor" descricao="Empresa, equipe, operação comercial e responsabilidades." icone={Building2} onClick={() => setDraft((a) => ({ ...a, persona: 'gestor_imobiliaria' }))} /><EscolhaCard ativo={draft.persona === 'usuario_convidado'} titulo="Usuário convidado" descricao="Entre em uma organização existente sem criar outra empresa." icone={Users} onClick={() => setDraft((a) => ({ ...a, persona: 'usuario_convidado' }))} /><EscolhaCard ativo={draft.persona === 'profissional_administrativo'} titulo="Profissional administrativo" descricao="Financeiro, jurídico, locações, marketing ou suporte." icone={BriefcaseBusiness} onClick={() => setDraft((a) => ({ ...a, persona: 'profissional_administrativo' }))} /></div><div className="mt-7 flex justify-end">{botao('Continuar', props.onNext, !draft.persona)}</div></>;

  if (etapa === 'aceitar_convite') return <><TituloEtapa eyebrow="Organização existente" titulo="Entre com o convite recebido" descricao="O convite mostra a empresa e a sua função depois da validação. Ele só é aceito quando você confirma." /><Campo id="invite-token" label="Código do convite"><Textarea id="invite-token" value={draft.convite.token} onChange={(e) => atualizar('convite', { token: e.target.value })} placeholder="Cole aqui o código ou abra o link recebido" rows={4} /></Campo><div className="mt-7">{botao('Validar e aceitar convite', props.onAceitar, !draft.convite.token.trim())}</div></>;

  if (etapa === 'perfil') return <><TituloEtapa eyebrow="Identidade profissional" titulo="Complete o essencial do seu perfil" descricao="Esses dados ajudam a personalizar sua operação. O CRECI informado fica aguardando validação até existir uma conferência real." /><div className="grid gap-5 sm:grid-cols-2"><Campo id="perfil-nome" label="Nome"><Input id="perfil-nome" autoComplete="name" value={draft.perfil.nome} onChange={(e) => atualizar('perfil', { nome: e.target.value })} /></Campo><Campo id="perfil-telefone" label="Telefone"><Input id="perfil-telefone" inputMode="tel" autoComplete="tel" value={draft.perfil.telefone} onChange={(e) => atualizar('perfil', { telefone: e.target.value })} /></Campo><Campo id="perfil-cidade" label="Cidade"><Input id="perfil-cidade" autoComplete="address-level2" value={draft.perfil.cidade} onChange={(e) => atualizar('perfil', { cidade: e.target.value })} /></Campo><Campo id="perfil-estado" label="Estado"><Input id="perfil-estado" maxLength={2} autoComplete="address-level1" value={draft.perfil.estado} onChange={(e) => atualizar('perfil', { estado: e.target.value.toUpperCase() })} /></Campo><Campo id="perfil-atuacao" label="Tipo de atuação"><Input id="perfil-atuacao" value={draft.perfil.tipoAtuacao} onChange={(e) => atualizar('perfil', { tipoAtuacao: e.target.value })} placeholder="Vendas residenciais, locações..." /></Campo><Campo id="perfil-creci" label="CRECI (opcional)" ajuda="Informar não significa validação automática."><Input id="perfil-creci" value={draft.perfil.creci} onChange={(e) => atualizar('perfil', { creci: e.target.value })} placeholder="12345-F" /></Campo><Campo id="perfil-regioes" label="Regiões atendidas"><Input id="perfil-regioes" value={draft.perfil.regioes} onChange={(e) => atualizar('perfil', { regioes: e.target.value })} placeholder="Moema, Vila Mariana, ABC" /></Campo><Campo id="perfil-especialidade" label="Especialidade"><Input id="perfil-especialidade" value={draft.perfil.especialidade} onChange={(e) => atualizar('perfil', { especialidade: e.target.value })} placeholder="Médio e alto padrão" /></Campo><Campo id="perfil-fuso" label="Fuso horário"><Select value={draft.perfil.fuso} onValueChange={(valor) => atualizar('perfil', { fuso: valor })}><SelectTrigger id="perfil-fuso"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="America/Sao_Paulo">Brasília</SelectItem><SelectItem value="America/Manaus">Manaus</SelectItem><SelectItem value="America/Cuiaba">Cuiabá</SelectItem><SelectItem value="America/Rio_Branco">Rio Branco</SelectItem></SelectContent></Select></Campo></div><div className="mt-7 flex justify-end">{botao('Salvar perfil', props.onPerfil)}</div></>;

  if (etapa === 'empresa') {
    const operacoes = ['Venda', 'Locação', 'Lançamentos', 'Lotes', 'Imóveis rurais', 'Comercial'];
    return <><TituloEtapa eyebrow="Operação compartilhada" titulo="Configure sua imobiliária" descricao="A organização reúne equipe, dados e assinatura. Não criaremos uma segunda operação se ela já existir." /><div className="grid gap-5 sm:grid-cols-2"><Campo id="emp-nome" label="Razão social ou nome da empresa"><Input id="emp-nome" value={draft.empresa.nome} onChange={(e) => atualizar('empresa', { nome: e.target.value })} /></Campo><Campo id="emp-comercial" label="Nome comercial"><Input id="emp-comercial" value={draft.empresa.nomeComercial} onChange={(e) => atualizar('empresa', { nomeComercial: e.target.value })} /></Campo><Campo id="emp-cnpj" label="CNPJ (opcional nesta etapa)"><Input id="emp-cnpj" inputMode="numeric" value={draft.empresa.cnpj} onChange={(e) => atualizar('empresa', { cnpj: e.target.value })} /></Campo><Campo id="emp-tamanho" label="Tamanho da equipe"><Select value={draft.empresa.tamanho} onValueChange={(valor) => atualizar('empresa', { tamanho: valor })}><SelectTrigger id="emp-tamanho"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="1-5">1 a 5 pessoas</SelectItem><SelectItem value="6-15">6 a 15 pessoas</SelectItem><SelectItem value="16-50">16 a 50 pessoas</SelectItem><SelectItem value="51+">Mais de 50</SelectItem></SelectContent></Select></Campo><Campo id="emp-email" label="E-mail"><Input id="emp-email" type="email" value={draft.empresa.email} onChange={(e) => atualizar('empresa', { email: e.target.value })} /></Campo><Campo id="emp-tel" label="Telefone"><Input id="emp-tel" inputMode="tel" value={draft.empresa.telefone} onChange={(e) => atualizar('empresa', { telefone: e.target.value })} /></Campo><Campo id="emp-cidade" label="Cidade"><Input id="emp-cidade" value={draft.empresa.cidade} onChange={(e) => atualizar('empresa', { cidade: e.target.value })} /></Campo><Campo id="emp-estado" label="Estado"><Input id="emp-estado" maxLength={2} value={draft.empresa.estado} onChange={(e) => atualizar('empresa', { estado: e.target.value.toUpperCase() })} /></Campo></div><fieldset className="mt-6"><legend className="mb-3 text-sm font-medium">Tipos de operação</legend><div className="grid gap-2 sm:grid-cols-2">{operacoes.map((op) => <label key={op} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm"><Checkbox checked={draft.empresa.operacoes.includes(op)} onCheckedChange={(checked) => atualizar('empresa', { operacoes: checked ? [...draft.empresa.operacoes, op] : draft.empresa.operacoes.filter((item) => item !== op) })} />{op}</label>)}</div></fieldset><div className="mt-7 flex justify-end">{botao('Salvar empresa', props.onEmpresa)}</div></>;
  }

  if (etapa === 'objetivo') {
    const objetivos: Array<[ObjetivoOnboarding, string]> = [['meus_leads','Meus leads'],['meus_imoveis','Meus imóveis'],['meu_funil','Meu funil de vendas'],['minha_rotina','Minha rotina'],['minhas_locacoes','Minhas locações'],['meus_contratos','Meus contratos'],['minha_equipe','Minha equipe'],['todo_negocio','Todo o negócio']];
    return <><TituloEtapa eyebrow="Prioridade" titulo="O que você mais quer organizar agora?" descricao="Isso define atalhos, dicas e a próxima ação recomendada no painel." /><div className="grid gap-3 sm:grid-cols-2">{objetivos.map(([valor,label]) => <button key={valor} type="button" aria-pressed={draft.objetivo === valor} onClick={() => setDraft((a) => ({ ...a, objetivo: valor }))} className={cn('flex min-h-14 items-center justify-between rounded-xl border px-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', draft.objetivo === valor ? 'border-primary bg-primary/[0.045] text-primary' : 'hover:border-primary/30')}><span>{label}</span>{draft.objetivo === valor && <CheckCircle2 className="h-5 w-5" />}</button>)}</div><div className="mt-7 flex justify-end">{botao('Personalizar minha Lotti', props.onNext, !draft.objetivo)}</div></>;
  }

  if (etapa === 'asaas') return <EtapaAsaas onNext={props.onNext} processando={processando} />;

  if (etapa === 'entrada_dados') {
    const entradas = [{v:'manual',t:'Cadastrar manualmente',d:'Crie os primeiros registros agora.',i:Home},{v:'importacao',t:'Importar planilha',d:'Mapeie e revise antes de gravar.',i:FileSpreadsheet},{v:'demonstracao',t:'Usar demonstração',d:'Dados isolados, removíveis e sem disparos.',i:WandSparkles},{v:'depois',t:'Fazer isso depois',d:'Explore a plataforma sem bloqueio.',i:Clock3}] as const;
    return <><TituloEtapa eyebrow="Começar com dados" titulo="Escolha o caminho mais rápido para você" descricao="Dados reais e demonstração ficam claramente separados. Nenhuma mensagem ou cobrança parte da demonstração." /><div className="grid gap-3 sm:grid-cols-2">{entradas.map((item) => <EscolhaCard key={item.v} ativo={draft.entradaDados === item.v} titulo={item.t} descricao={item.d} icone={item.i} onClick={() => setDraft((a) => ({ ...a, entradaDados: item.v }))} />)}</div>{draft.entradaDados === 'importacao' && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-medium">Importação assistida preparada por etapas</p><p className="mt-1 leading-6">CSV e XLSX passam por mapeamento, prévia, validação, duplicidades e relatório de erros antes da confirmação. Nesta versão, continue com cadastro manual enquanto o importador operacional é habilitado.</p></div>}{(contexto.evidencias.totalRegistrosDemo ?? 0) > 0 && <div className="mt-4 flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Demonstração ativa</p><p className="mt-1">{contexto.evidencias.totalRegistrosDemo} registros marcados como Demo e fora dos indicadores reais.</p></div><Button variant="outline" onClick={props.onRemoverDemo}>Remover demonstração</Button></div>}<div className="mt-7 flex justify-end">{botao(draft.entradaDados === 'demonstracao' ? 'Criar demonstração segura' : 'Continuar', props.onEntrada, !draft.entradaDados)}</div></>;
  }

  if (etapa === 'primeiro_imovel') return <><TituloEtapa eyebrow="Primeiro resultado" titulo="Cadastre seu primeiro imóvel" descricao="Só o necessário para ele aparecer na operação. Fotos e detalhes avançados ficam para depois." /><div className="grid gap-5 sm:grid-cols-2"><Campo id="im-tipo" label="Tipo"><Select value={draft.imovel.tipo} onValueChange={(v) => atualizar('imovel',{tipo:v})}><SelectTrigger id="im-tipo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASA">Casa</SelectItem><SelectItem value="APARTAMENTO">Apartamento</SelectItem><SelectItem value="COMERCIAL">Comercial</SelectItem><SelectItem value="TERRENO">Terreno</SelectItem></SelectContent></Select></Campo><Campo id="im-finalidade" label="Finalidade"><Select value={draft.imovel.finalidade} onValueChange={(v) => atualizar('imovel',{finalidade:v})}><SelectTrigger id="im-finalidade"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="VENDA">Venda</SelectItem><SelectItem value="ALUGUEL">Locação</SelectItem></SelectContent></Select></Campo><div className="sm:col-span-2"><Campo id="im-titulo" label="Título"><Input id="im-titulo" value={draft.imovel.titulo} onChange={(e) => atualizar('imovel',{titulo:e.target.value})} placeholder="Apartamento com varanda em Moema" /></Campo></div><Campo id="im-cidade" label="Cidade"><Input id="im-cidade" value={draft.imovel.cidade} onChange={(e) => atualizar('imovel',{cidade:e.target.value})} /></Campo><Campo id="im-bairro" label="Bairro"><Input id="im-bairro" value={draft.imovel.bairro} onChange={(e) => atualizar('imovel',{bairro:e.target.value})} /></Campo><Campo id="im-valor" label="Valor"><Input id="im-valor" inputMode="decimal" value={draft.imovel.valor} onChange={(e) => atualizar('imovel',{valor:e.target.value})} placeholder="650000" /></Campo><Campo id="im-estado" label="Estado"><Input id="im-estado" maxLength={2} value={draft.imovel.estado} onChange={(e) => atualizar('imovel',{estado:e.target.value.toUpperCase()})} /></Campo><div className="sm:col-span-2"><Campo id="im-endereco" label="Endereço (opcional agora)"><Input id="im-endereco" value={draft.imovel.endereco} onChange={(e) => atualizar('imovel',{endereco:e.target.value})} /></Campo></div></div><div className="mt-7 flex justify-end">{botao('Criar primeiro imóvel', props.onImovel, !draft.imovel.titulo.trim() || !draft.imovel.cidade.trim() || !draft.imovel.valor)}</div></>;

  if (etapa === 'primeiro_cliente') return <><TituloEtapa eyebrow="Contato com contexto" titulo="Cadastre seu primeiro cliente" descricao="Um telefone ou e-mail basta para começar. Interesse e origem ajudam a priorizar o atendimento." /><div className="grid gap-5 sm:grid-cols-2"><Campo id="cl-nome" label="Nome"><Input id="cl-nome" value={draft.cliente.nome} onChange={(e) => atualizar('cliente',{nome:e.target.value})} /></Campo><Campo id="cl-tel" label="Telefone"><Input id="cl-tel" inputMode="tel" value={draft.cliente.telefone} onChange={(e) => atualizar('cliente',{telefone:e.target.value})} /></Campo><Campo id="cl-email" label="E-mail"><Input id="cl-email" type="email" value={draft.cliente.email} onChange={(e) => atualizar('cliente',{email:e.target.value})} /></Campo><Campo id="cl-interesse" label="Interesse"><Select value={draft.cliente.interesse} onValueChange={(v) => atualizar('cliente',{interesse:v})}><SelectTrigger id="cl-interesse"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="COMPRA">Compra</SelectItem><SelectItem value="LOCACAO">Locação</SelectItem><SelectItem value="AMBOS">Compra e locação</SelectItem></SelectContent></Select></Campo><Campo id="cl-faixa" label="Faixa de preço"><Input id="cl-faixa" value={draft.cliente.faixaPreco} onChange={(e) => atualizar('cliente',{faixaPreco:e.target.value})} placeholder="R$ 500 mil a R$ 700 mil" /></Campo><Campo id="cl-regiao" label="Cidade ou região"><Input id="cl-regiao" value={draft.cliente.regiao} onChange={(e) => atualizar('cliente',{regiao:e.target.value})} /></Campo><Campo id="cl-origem" label="Origem do lead"><Select value={draft.cliente.origem} onValueChange={(v) => atualizar('cliente',{origem:v})}><SelectTrigger id="cl-origem"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Indicacao">Indicação</SelectItem><SelectItem value="Instagram">Instagram</SelectItem><SelectItem value="WhatsApp">WhatsApp</SelectItem><SelectItem value="Portal">Portal imobiliário</SelectItem><SelectItem value="Site">Site</SelectItem><SelectItem value="Outro">Outro</SelectItem></SelectContent></Select></Campo></div><div className="mt-7 flex justify-end">{botao('Cadastrar cliente', props.onCliente, !draft.cliente.nome.trim() || (!draft.cliente.telefone.trim() && !draft.cliente.email.trim()))}</div></>;

  if (etapa === 'primeira_oportunidade') return <><TituloEtapa eyebrow="Negócio no funil" titulo="Crie a primeira oportunidade" descricao="A oportunidade relaciona cliente, imóvel, etapa e valor. Ela aparece no Kanban real após a confirmação." />{clientes.length === 0 && contexto.evidencias.totalClientesReais === 0 ? <Aviso titulo="Você ainda precisa de um cliente" texto="Volte à etapa anterior ou pule por agora. A Lotti não cria uma oportunidade sem contato real." /> : <div className="grid gap-5 sm:grid-cols-2"><Campo id="op-cliente" label="Cliente"><Select value={draft.oportunidade.clienteId || undefined} onValueChange={(v) => atualizar('oportunidade',{clienteId:v})}><SelectTrigger id="op-cliente"><SelectValue placeholder="Cliente criado no onboarding" /></SelectTrigger><SelectContent>{clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select></Campo><Campo id="op-imovel" label="Imóvel"><Select value={draft.oportunidade.imovelId || undefined} onValueChange={(v) => atualizar('oportunidade',{imovelId:v})}><SelectTrigger id="op-imovel"><SelectValue placeholder="Imóvel criado no onboarding" /></SelectTrigger><SelectContent>{imoveis.map((i) => <SelectItem key={i.id} value={i.id}>{i.titulo}</SelectItem>)}</SelectContent></Select></Campo><div className="sm:col-span-2"><Campo id="op-titulo" label="Título da oportunidade"><Input id="op-titulo" value={draft.oportunidade.titulo} onChange={(e) => atualizar('oportunidade',{titulo:e.target.value})} /></Campo></div><Campo id="op-valor" label="Valor estimado"><Input id="op-valor" inputMode="decimal" value={draft.oportunidade.valor} onChange={(e) => atualizar('oportunidade',{valor:e.target.value})} placeholder="650000" /></Campo><Campo id="op-etapa" label="Etapa inicial"><Input id="op-etapa" value="Novo lead" disabled /></Campo></div>}<div className="mt-7 flex justify-end">{botao('Criar no funil', props.onOportunidade, clientes.length === 0 && contexto.evidencias.totalClientesReais === 0)}</div></>;

  if (etapa === 'primeira_rotina') return <>
    <TituloEtapa eyebrow="Próxima ação" titulo="Agende seu primeiro follow-up" descricao="Uma negociação com data, responsável e lembrete deixa de depender da memória. A atividade entra na Central de Rotina real." />
    <div className="grid gap-5 sm:grid-cols-2">
      <Campo id="ta-titulo" label="Atividade"><Input id="ta-titulo" value={draft.tarefa.titulo} onChange={(e) => atualizar('tarefa',{titulo:e.target.value})} /></Campo>
      <Campo id="ta-tipo" label="Tipo"><Select value={draft.tarefa.tipo} onValueChange={(v) => atualizar('tarefa',{tipo:v})}><SelectTrigger id="ta-tipo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="LIGACAO">Ligação</SelectItem><SelectItem value="WHATSAPP">WhatsApp</SelectItem><SelectItem value="EMAIL">E-mail</SelectItem><SelectItem value="REUNIAO">Reunião</SelectItem><SelectItem value="VISITA">Visita</SelectItem><SelectItem value="OUTRO">Outro</SelectItem></SelectContent></Select></Campo>
      <Campo id="ta-data" label="Data e horário"><Input id="ta-data" type="datetime-local" value={draft.tarefa.data} onChange={(e) => atualizar('tarefa',{data:e.target.value})} /></Campo>
      <Campo id="ta-frequencia" label="Frequência"><Select value={draft.tarefa.frequencia} onValueChange={(v) => atualizar('tarefa',{frequencia:v})}><SelectTrigger id="ta-frequencia"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unica">Uma vez</SelectItem><SelectItem value="diaria">Diariamente</SelectItem><SelectItem value="semanal">Semanalmente</SelectItem><SelectItem value="mensal">Mensalmente</SelectItem></SelectContent></Select></Campo>
      <Campo id="ta-lembrete" label="Lembrete"><Select value={draft.tarefa.lembreteMinutos} onValueChange={(v) => atualizar('tarefa',{lembreteMinutos:v})}><SelectTrigger id="ta-lembrete"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Sem lembrete</SelectItem><SelectItem value="15">15 minutos antes</SelectItem><SelectItem value="60">1 hora antes</SelectItem><SelectItem value="1440">1 dia antes</SelectItem></SelectContent></Select></Campo>
      <Campo id="ta-responsavel" label="Responsável"><Select value={draft.tarefa.responsavelId || contexto.userId || undefined} onValueChange={(v) => atualizar('tarefa',{responsavelId:v})}><SelectTrigger id="ta-responsavel"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{contexto.membros.map((membro) => <SelectItem key={membro.userId} value={membro.userId}>{membro.userId === contexto.userId ? `${membro.nome} (você)` : membro.nome}</SelectItem>)}</SelectContent></Select></Campo>
      <Campo id="ta-cliente" label="Cliente (opcional)"><Select value={draft.tarefa.clienteId || undefined} onValueChange={(v) => atualizar('tarefa',{clienteId:v})}><SelectTrigger id="ta-cliente"><SelectValue placeholder="Cliente do onboarding" /></SelectTrigger><SelectContent>{clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select></Campo>
      <div className="sm:col-span-2"><Campo id="ta-desc" label="Observação"><Textarea id="ta-desc" value={draft.tarefa.descricao} onChange={(e) => atualizar('tarefa',{descricao:e.target.value})} placeholder="Enviar opções e confirmar disponibilidade para visita" /></Campo></div>
    </div>
    <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-secondary/60 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-medium">Google Agenda é opcional</p><p className="mt-1 text-muted-foreground">Salve primeiro na Lotti e conecte quando quiser sincronizar calendários.</p></div>
      <Button variant="outline" asChild><Link to="/rotina#google-agenda">Conectar Google Agenda</Link></Button>
    </div>
    <div className="mt-7 flex justify-end">{botao('Agendar próxima ação', props.onTarefa, !draft.tarefa.titulo.trim() || !draft.tarefa.data)}</div>
  </>;

  if (etapa === 'equipe') return <><TituloEtapa eyebrow="Equipe" titulo="Convide alguém para sua operação" descricao="A pessoa recebe uma função e só entra depois de aceitar. A Lotti não envia convites externos silenciosamente." /><div className="grid gap-5 sm:grid-cols-[1fr_220px]"><Campo id="eq-email" label="E-mail"><Input id="eq-email" type="email" value={draft.convite.email} onChange={(e) => atualizar('convite',{email:e.target.value})} placeholder="pessoa@empresa.com.br" /></Campo><Campo id="eq-papel" label="Função"><Select value={draft.convite.papel} onValueChange={(v) => atualizar('convite',{papel:v})}><SelectTrigger id="eq-papel"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gestor">Gestor</SelectItem><SelectItem value="corretor">Corretor</SelectItem><SelectItem value="financeiro">Financeiro</SelectItem><SelectItem value="juridico">Jurídico</SelectItem><SelectItem value="locacoes">Locações</SelectItem><SelectItem value="marketing">Marketing</SelectItem><SelectItem value="suporte">Suporte</SelectItem></SelectContent></Select></Campo></div><div className="mt-6 flex flex-wrap gap-3">{botao('Preparar convite', props.onConvidar, !draft.convite.email.trim())}{conviteGerado && <Button variant="outline" size="lg" onClick={props.onCopiarConvite}>Copiar link do convite</Button>}</div>{conviteGerado && <div className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.04] p-4"><p className="text-sm font-medium">Convite pronto para compartilhar</p><p className="mt-1 break-all text-xs leading-5 text-muted-foreground">{conviteGerado}</p><Button className="mt-3" variant="ghost" size="sm" onClick={props.onNext}>Continuar onboarding<ArrowRight className="ml-2 h-4 w-4" /></Button></div>}</>;

  const conquistas = [{label:'Perfil profissional',feito:contexto.evidencias.perfilCompleto},{label:'Primeiro imóvel',feito:contexto.evidencias.totalImoveisReais>0},{label:'Primeiro cliente',feito:contexto.evidencias.totalClientesReais>0},{label:'Oportunidade no funil',feito:contexto.evidencias.totalOportunidadesReais>0},{label:'Próxima atividade',feito:contexto.evidencias.totalTarefasReais>0},{label:'Equipe convidada',feito:contexto.evidencias.totalConvites>0}];
  return <div className="flex min-h-[520px] flex-col justify-center"><div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><BadgeCheck className="h-7 w-7" /></div><TituloEtapa eyebrow="Sua operação começou" titulo="A Lotti já está pronta para trabalhar com você." descricao="Clientes, imóveis, negociações e tarefas agora podem ser acompanhados em um só lugar. Continue configurando no seu ritmo." /><div className="grid gap-2 sm:grid-cols-2">{conquistas.map((item) => <div key={item.label} className={cn('flex items-center gap-3 rounded-lg border px-3 py-3 text-sm', item.feito ? 'border-primary/20 bg-primary/[0.035]' : 'text-muted-foreground')}><span className={cn('flex h-5 w-5 items-center justify-center rounded-full',item.feito?'bg-primary text-primary-foreground':'border')} >{item.feito&&<Check className="h-3 w-3" />}</span>{item.label}</div>)}</div><div className="mt-8 flex flex-col gap-3 sm:flex-row">{botao('Ir para meu painel', props.onFinalizar)}<Button variant="outline" size="lg" asChild><Link to="/onboarding?etapa=perfil">Continuar configurando</Link></Button></div></div>;
}

function EtapaAsaas({ onNext, processando }: { onNext: () => void; processando: boolean }) {
  const [conectada, setConectada] = useState(false);
  return <>
    <TituloEtapa
      eyebrow="Recebimentos isolados"
      titulo="Conecte a conta Asaas da sua operação"
      descricao="Cobranças, saldo e webhooks ficam presos à conta que você validar aqui. Se preferir configurar depois, pule esta etapa — a Lotti nunca usará a conta de outro usuário como fallback."
    />
    <AsaasConnectionPanel compacto onStatusChange={setConectada} />
    <div className="mt-7 flex justify-end">
      <Button className="w-full sm:w-auto" size="lg" onClick={onNext} disabled={!conectada || processando}>
        Continuar com esta conta<ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  </>;
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) { return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><p className="font-semibold">{titulo}</p><p className="mt-2 text-sm leading-6">{texto}</p></div>; }

function ResumoPlano({ contexto }: { contexto: NonNullable<ReturnType<typeof useOnboarding>['contexto']> }) {
  const dias = contexto.assinatura?.trialTerminaEm ? Math.max(0, Math.ceil((new Date(contexto.assinatura.trialTerminaEm).getTime() - Date.now()) / 86_400_000)) : null;
  return <aside className="rounded-xl border bg-card p-4"><p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Conta e plano</p><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{contexto.assinatura?.plano ?? 'Plano não definido'}</p><p className="mt-0.5 text-xs text-muted-foreground">{contexto.organizacao?.nome ?? 'Minha operação'}</p></div>{contexto.assinatura?.status === 'trialing' && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">Teste</span>}</div>{dias !== null && <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs">{dias} {dias === 1 ? 'dia restante' : 'dias restantes'} no período de teste</p>}<Button variant="link" size="sm" className="mt-2 h-auto p-0 text-xs" asChild><Link to="/plano">Gerenciar assinatura</Link></Button></aside>;
}

function TelaCarregando() { return <div className="flex min-h-screen items-center justify-center bg-[#F4F6F2]"><div className="flex items-center gap-3 text-sm text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin text-primary" />Preparando sua experiência...</div></div>; }

import { useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  UploadCloud, FileText, Sparkles, Loader2, CalendarClock, ShieldAlert, X, User, Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { analisarContratoCentral } from '@/services/contractExtractionService';
import type { ExtractedCentralContract, ParteContrato } from '@/services/contractExtractionService';
import { useFileDrop } from '@/hooks/useFileDrop';
import { looseMatch } from '@/lib/matching';
import { mensagemDeErro } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { TIPO_CONTRATO_LABELS } from '@/types/crm';
import type { TipoContrato, TipoImovel, TipoInteresse } from '@/types/crm';

interface ImovelOpt { id: string; titulo: string; endereco?: string | null }
interface ClienteOpt { id: string; nome: string }

interface AnalisarContratoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imoveis: ImovelOpt[];
  clientes: ClienteOpt[];
  onSaved: () => void;
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_BYTES = 15 * 1024 * 1024; // 15MB (limite do Gemini inline)

// Tipos priorizados no topo (foco: venda + exclusividade); o resto segue depois.
const TIPO_ORDER: TipoContrato[] = [
  'COMPRA_VENDA', 'EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO',
  'LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL', 'DISTRATO', 'PROCURACAO', 'OUTRO',
];

const TIPO_IMOVEL_OPCOES: { valor: TipoImovel; rotulo: string }[] = [
  { valor: 'APARTAMENTO', rotulo: 'Apartamento' },
  { valor: 'CASA', rotulo: 'Casa' },
  { valor: 'COMERCIAL', rotulo: 'Comercial' },
  { valor: 'TERRENO', rotulo: 'Terreno' },
];

// Nestes contratos quem assina com a imobiliária é o dono do imóvel — ele é o cliente.
// Nos demais (compra e venda, locação) o cliente é a outra ponta.
const CLIENTE_EH_VENDEDOR: TipoContrato[] = [
  'EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO', 'PROCURACAO',
];

const escolherCliente = (
  tipo: TipoContrato,
  partes: ExtractedCentralContract['partes'],
): ParteContrato => {
  const [primeira, segunda] = CLIENTE_EH_VENDEDOR.includes(tipo)
    ? [partes.vendedor_proprietario, partes.comprador_cliente]
    : [partes.comprador_cliente, partes.vendedor_proprietario];
  return primeira?.nome ? primeira : (segunda ?? primeira);
};

const interesseDoTipo = (tipo: TipoContrato): TipoInteresse =>
  tipo === 'LOCACAO_RESIDENCIAL' || tipo === 'LOCACAO_COMERCIAL' || tipo === 'EXCLUSIVIDADE_LOCACAO'
    ? 'LOCACAO'
    : 'COMPRA';

type Step = 'upload' | 'analisando' | 'revisao' | 'salvando';

export function AnalisarContratoDialog({
  open, onOpenChange, imoveis, clientes, onSaved,
}: AnalisarContratoDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);

  // Campos revisáveis (pré-preenchidos pela IA, editáveis pelo corretor)
  const [tipo, setTipo] = useState<TipoContrato>('EXCLUSIVIDADE_VENDA');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [valor, setValor] = useState('');
  const [imovelId, setImovelId] = useState<string>('NENHUM');
  const [clienteId, setClienteId] = useState<string>('NENHUM');
  const [observacoes, setObservacoes] = useState('');
  const [iaNaoAchou, setIaNaoAchou] = useState<string[]>([]);

  // Dados das partes/imóvel lidos do contrato — viram cadastro novo quando não houver vínculo.
  const [clienteNome, setClienteNome] = useState('');
  const [clienteTelefone, setClienteTelefone] = useState('');
  const [clienteDoc, setClienteDoc] = useState('');
  const [clienteEmail, setClienteEmail] = useState('');
  const [imovelEndereco, setImovelEndereco] = useState('');
  const [imovelBairro, setImovelBairro] = useState('');
  const [imovelCidade, setImovelCidade] = useState('');
  const [imovelTipo, setImovelTipo] = useState<TipoImovel>('CASA');
  const [proprietarioNome, setProprietarioNome] = useState('');

  const reset = () => {
    setStep('upload'); setFile(null);
    setTipo('EXCLUSIVIDADE_VENDA'); setDataInicio(''); setDataFim(''); setValor('');
    setImovelId('NENHUM'); setClienteId('NENHUM'); setObservacoes(''); setIaNaoAchou([]);
    setClienteNome(''); setClienteTelefone(''); setClienteDoc(''); setClienteEmail('');
    setImovelEndereco(''); setImovelBairro(''); setImovelCidade('');
    setImovelTipo('CASA'); setProprietarioNome('');
  };

  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { toast.error('Arquivo muito grande (máx. 15MB).'); return; }
    if (!ACCEPT.split(',').includes(f.type)) { toast.error('Envie PDF ou imagem (JPG, PNG, WEBP).'); return; }
    setFile(f);
  };

  const { dragActive, dropProps } = useFileDrop((arquivos) => pickFile(arquivos[0]), {
    accept: ACCEPT,
    disabled: step === 'analisando',
    onReject: () => toast.error('Envie PDF ou imagem (JPG, PNG, WEBP).'),
  });

  // Só criamos registro novo quando o corretor não vinculou um existente no select.
  const criarCliente = clienteId === 'NENHUM' && !!clienteNome.trim();
  const criarImovel = imovelId === 'NENHUM' && !!imovelEndereco.trim();

  const nomeImovelVinculado = useMemo(
    () => imoveis.find((i) => i.id === imovelId)?.titulo,
    [imoveis, imovelId],
  );
  const nomeClienteVinculado = useMemo(
    () => clientes.find((c) => c.id === clienteId)?.nome,
    [clientes, clienteId],
  );

  const analisar = async () => {
    if (!file) return;
    setStep('analisando');
    try {
      const dados = await analisarContratoCentral(file);
      const faltando: string[] = [];

      const tipoLido = (dados.tipo as TipoContrato | null) ?? null;
      if (tipoLido) setTipo(tipoLido); else faltando.push('tipo');
      if (dados.data_inicio) setDataInicio(dados.data_inicio); else faltando.push('data de início');
      if (dados.data_fim) setDataFim(dados.data_fim); else faltando.push('vencimento');
      if (dados.valor != null) setValor(String(dados.valor)); else faltando.push('valor');
      setObservacoes(dados.observacoes ?? '');

      // ── Imóvel: vincula o cadastrado se casar; senão prepara o cadastro novo.
      const endereco = dados.imovel.endereco ?? '';
      setImovelEndereco(endereco);
      setImovelBairro(dados.imovel.bairro ?? '');
      setImovelCidade(dados.imovel.cidade ?? '');
      if (dados.imovel.tipo) setImovelTipo(dados.imovel.tipo as TipoImovel);
      setProprietarioNome(dados.partes.vendedor_proprietario?.nome ?? '');

      const achouImovel = endereco
        ? imoveis.find((i) => looseMatch(i.endereco ?? '', endereco) || looseMatch(i.titulo, endereco))
        : undefined;
      setImovelId(achouImovel?.id ?? 'NENHUM');
      if (!achouImovel && !endereco) faltando.push('imóvel');

      // ── Cliente: a parte principal depende do tipo de contrato.
      const parte = escolherCliente(tipoLido ?? tipo, dados.partes);
      const nome = parte?.nome ?? '';
      setClienteNome(nome);
      setClienteTelefone(parte?.telefone ?? '');
      setClienteDoc(parte?.cpf_cnpj ?? '');
      setClienteEmail(parte?.email ?? '');

      const achouCliente = nome ? clientes.find((c) => looseMatch(c.nome, nome)) : undefined;
      setClienteId(achouCliente?.id ?? 'NENHUM');
      if (!achouCliente && !nome) faltando.push('cliente');

      setIaNaoAchou(faltando);
      setStep('revisao');
    } catch (err) {
      toast.error(mensagemDeErro(err, 'Não foi possível analisar o contrato.'));
      setStep('upload');
    }
  };

  const salvar = async () => {
    if (!file) return;
    if (!dataFim) { toast.error('Informe o vencimento (data_fim) — é o que gera os alertas.'); return; }
    setStep('salvando');
    const toastId = toast.loading('Salvando contrato...');

    let arquivoPath: string | null = null;
    // Só o que esta tentativa criou — o que já existia e foi apenas vinculado nunca é tocado.
    const novos: { cliente?: string; imovel?: string } = {};

    try {
      const { data: corretorId, error: corrErr } = await supabase.rpc('get_corretor_id');
      if (corrErr || !corretorId) throw new Error('Não foi possível identificar o corretor.');

      // 1. Cliente: usa o vinculado ou cadastra a parte lida no contrato.
      let clienteFinal = clienteId !== 'NENHUM' ? clienteId : null;
      if (criarCliente) {
        const { data: novo, error } = await supabase
          .from('clientes')
          .insert({
            nome: clienteNome.trim(),
            telefone: clienteTelefone.trim(),
            email: clienteEmail.trim() || null,
            cpf: clienteDoc.trim() || null,
            tipo_interesse: interesseDoTipo(tipo),
            observacoes: 'Cadastrado automaticamente pela análise de contrato (IA).',
            corretor_id: corretorId,
          })
          .select('id')
          .single();
        if (error) throw new Error('Erro ao cadastrar o cliente: ' + mensagemDeErro(error));
        clienteFinal = novo.id;
        novos.cliente = novo.id;
      }

      // 2. Imóvel: idem. Sem endereço não criamos nada — evita imóvel fantasma na lista.
      let imovelFinal = imovelId !== 'NENHUM' ? imovelId : null;
      if (criarImovel) {
        const { data: novo, error } = await supabase
          .from('imoveis')
          .insert({
            titulo: imovelEndereco.trim(),
            tipo: imovelTipo,
            valor: Number(valor) || 0,
            area_m2: 0,
            dormitorios: 0,
            garagem: 0,
            endereco: imovelEndereco.trim(),
            bairro: imovelBairro.trim(),
            cidade: imovelCidade.trim(),
            proprietario_nome: proprietarioNome.trim(),
            corretor_id: corretorId,
          })
          .select('id')
          .single();
        if (error) throw new Error('Erro ao cadastrar o imóvel: ' + mensagemDeErro(error));
        imovelFinal = novo.id;
        novos.imovel = novo.id;
      }

      // 3. Arquivo (bucket documentos exige corretor_id como 1ª pasta)
      const safeName = file.name.replace(/[^\w.-]+/g, '_');
      const path = `${corretorId}/contratos/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from('documentos').upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      arquivoPath = path;

      // 4. Contrato
      const { error: insErr } = await supabase.from('contratos').insert({
        corretor_id: corretorId,
        tipo,
        cliente_id: clienteFinal,
        imovel_id: imovelFinal,
        valor: Number(valor) || 0,
        data_inicio: dataInicio || new Date().toISOString().slice(0, 10),
        data_fim: dataFim,
        observacoes: observacoes.trim() || null,
        arquivo_url: path,
        conteudo: '', // contrato enviado (não gerado): sem texto estruturado
        status: 'VIGENTE',
      });
      if (insErr) throw insErr;

      const criados = [novos.cliente && 'cliente', novos.imovel && 'imóvel'].filter(Boolean);
      const extras = criados.length ? ` ${criados.join(' e ')} cadastrado(s) junto.` : '';
      toast.success(
        `Contrato salvo! Os alertas de vencimento serão disparados automaticamente.${extras}`,
        { id: toastId },
      );
      onSaved();
      close(false);
    } catch (err) {
      // Não há transação entre storage e banco: se o contrato não entrou, desfazemos
      // o que esta tentativa criou. Deixar cliente/imóvel para trás só gera registro
      // fantasma que o corretor não encontra — e o retry partiria sujo.
      if (arquivoPath) {
        await supabase.storage.from('documentos').remove([arquivoPath]).catch(() => undefined);
      }
      // O rollback não pode derrubar o tratamento do erro original: sem rede o
      // .delete() rejeita, e o dialog ficaria preso em "Salvando..." para sempre.
      const sobraram: string[] = [];
      const apagar = async (tabela: 'imoveis' | 'clientes', id: string, rotulo: string) => {
        try {
          const { error } = await supabase.from(tabela).delete().eq('id', id);
          if (error) sobraram.push(rotulo);
        } catch {
          sobraram.push(rotulo);
        }
      };
      if (novos.imovel) await apagar('imoveis', novos.imovel, 'imóvel');
      if (novos.cliente) await apagar('clientes', novos.cliente, 'cliente');

      const aviso = sobraram.length
        ? ` Atenção: não consegui remover o ${sobraram.join(' e o ')} que tinha acabado de cadastrar — apague pela tela correspondente antes de tentar de novo.`
        : '';
      toast.error(mensagemDeErro(err, 'Erro ao salvar o contrato.') + aviso, { id: toastId });
      setStep('revisao');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Analisar Contrato com IA
          </DialogTitle>
          <DialogDescription>
            Envie um contrato (gerado ou assinado em PDF/imagem). A IA identifica o tipo e o vencimento;
            o sistema dispara os alertas conforme a data se aproxima.
          </DialogDescription>
        </DialogHeader>

        {/* ── Upload / Analisando ── */}
        {(step === 'upload' || step === 'analisando') && (
          <div className="space-y-4">
            <input
              ref={inputRef} type="file" accept={ACCEPT} className="hidden"
              onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            {!file ? (
              <button
                type="button"
                {...dropProps}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 text-center transition',
                  dragActive
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/50 hover:bg-primary/[0.02]',
                )}
              >
                <div className="p-3 rounded-full bg-primary/10"><UploadCloud className="h-6 w-6 text-primary" /></div>
                <p className="font-medium">
                  {dragActive ? 'Solte o contrato aqui' : 'Arraste ou clique para enviar o contrato'}
                </p>
                <p className="text-xs text-muted-foreground">PDF, JPG, PNG ou WEBP (máx. 15MB)</p>
              </button>
            ) : (
              <div className="flex items-center gap-3 border rounded-lg p-3">
                <div className="p-2 rounded-md bg-primary/10 shrink-0"><FileText className="h-5 w-5 text-primary" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                </div>
                {step !== 'analisando' && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setFile(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)} disabled={step === 'analisando'}>Cancelar</Button>
              <Button onClick={analisar} disabled={!file || step === 'analisando'}>
                {step === 'analisando' ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analisando com IA...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Analisar com IA</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Revisão / Salvando ── */}
        {(step === 'revisao' || step === 'salvando') && (
          <div className="space-y-4">
            {iaNaoAchou.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                A IA não identificou com segurança: <strong>{iaNaoAchou.join(', ')}</strong>. Preencha manualmente.
              </p>
            )}

            <div>
              <Label>Tipo de contrato</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoContrato)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPO_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_CONTRATO_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Início</Label>
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div>
                <Label className="flex items-center gap-1 text-primary">
                  <CalendarClock className="h-3.5 w-3.5" /> Vencimento *
                </Label>
                <Input
                  type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
                  className={!dataFim ? 'border-amber-500/60' : ''}
                />
              </div>
            </div>

            <div>
              <Label>Valor (R$)</Label>
              <Input type="number" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" />
            </div>

            {/* ── Cliente ── */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <User className="h-4 w-4 text-muted-foreground" /> Cliente
                </span>
                {clienteId !== 'NENHUM' ? (
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    Já cadastrado
                  </Badge>
                ) : criarCliente ? (
                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                    Será criado
                  </Badge>
                ) : null}
              </div>

              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger><SelectValue placeholder="Vincular cliente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NENHUM">
                    {clienteNome.trim() ? `Cadastrar "${clienteNome.trim()}"` : 'Nenhum'}
                  </SelectItem>
                  {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>

              {clienteId !== 'NENHUM' ? (
                <p className="text-xs text-muted-foreground">Vinculado a {nomeClienteVinculado}.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} placeholder="Nome da parte" />
                  <Input value={clienteTelefone} onChange={(e) => setClienteTelefone(e.target.value)} placeholder="Telefone" />
                  <Input value={clienteDoc} onChange={(e) => setClienteDoc(e.target.value)} placeholder="CPF / CNPJ" />
                  <Input value={clienteEmail} onChange={(e) => setClienteEmail(e.target.value)} placeholder="E-mail" />
                </div>
              )}
            </div>

            {/* ── Imóvel ── */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Building2 className="h-4 w-4 text-muted-foreground" /> Imóvel
                </span>
                {imovelId !== 'NENHUM' ? (
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                    Já cadastrado
                  </Badge>
                ) : criarImovel ? (
                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                    Será criado
                  </Badge>
                ) : null}
              </div>

              <Select value={imovelId} onValueChange={setImovelId}>
                <SelectTrigger><SelectValue placeholder="Vincular imóvel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NENHUM">
                    {imovelEndereco.trim() ? 'Cadastrar o imóvel do contrato' : 'Nenhum'}
                  </SelectItem>
                  {imoveis.map((i) => <SelectItem key={i.id} value={i.id}>{i.titulo}</SelectItem>)}
                </SelectContent>
              </Select>

              {imovelId !== 'NENHUM' ? (
                <p className="text-xs text-muted-foreground">Vinculado a {nomeImovelVinculado}.</p>
              ) : (
                <div className="space-y-2">
                  <Input value={imovelEndereco} onChange={(e) => setImovelEndereco(e.target.value)} placeholder="Endereço do imóvel" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input value={imovelBairro} onChange={(e) => setImovelBairro(e.target.value)} placeholder="Bairro" />
                    <Input value={imovelCidade} onChange={(e) => setImovelCidade(e.target.value)} placeholder="Cidade" />
                    <Select value={imovelTipo} onValueChange={(v) => setImovelTipo(v as TipoImovel)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIPO_IMOVEL_OPCOES.map((o) => (
                          <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input value={proprietarioNome} onChange={(e) => setProprietarioNome(e.target.value)} placeholder="Proprietário" />
                  </div>
                  {!imovelEndereco.trim() && (
                    <p className="text-xs text-muted-foreground">
                      Sem endereço o imóvel não é criado — o contrato salva mesmo assim.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2}
                placeholder="Resumo do que a IA leu (objeto, prazo, renovação, multa)..." maxLength={600} />
            </div>

            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              A análise da IA é apoio operacional para organização e prazos — não substitui a avaliação de um advogado.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('upload')} disabled={step === 'salvando'}>Voltar</Button>
              <Button onClick={salvar} disabled={step === 'salvando'}>
                {step === 'salvando' ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
                ) : 'Salvar Contrato'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

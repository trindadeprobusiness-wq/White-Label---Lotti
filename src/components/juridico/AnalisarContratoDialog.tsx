import { useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { UploadCloud, FileText, Sparkles, Loader2, CalendarClock, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { analisarContratoCentral } from '@/services/contractExtractionService';
import { TIPO_CONTRATO_LABELS } from '@/types/crm';
import type { TipoContrato } from '@/types/crm';

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

  const reset = () => {
    setStep('upload'); setFile(null);
    setTipo('EXCLUSIVIDADE_VENDA'); setDataInicio(''); setDataFim(''); setValor('');
    setImovelId('NENHUM'); setClienteId('NENHUM'); setObservacoes(''); setIaNaoAchou([]);
  };

  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) { toast.error('Arquivo muito grande (máx. 15MB).'); return; }
    if (!ACCEPT.split(',').includes(f.type)) { toast.error('Envie PDF ou imagem (JPG, PNG, WEBP).'); return; }
    setFile(f);
  };

  const analisar = async () => {
    if (!file) return;
    setStep('analisando');
    try {
      const dados = await analisarContratoCentral(file);
      const faltando: string[] = [];
      if (dados.tipo) setTipo(dados.tipo as TipoContrato); else faltando.push('tipo');
      if (dados.data_inicio) setDataInicio(dados.data_inicio); else faltando.push('data de início');
      if (dados.data_fim) setDataFim(dados.data_fim); else faltando.push('vencimento');
      if (dados.valor != null) setValor(String(dados.valor)); else faltando.push('valor');
      setObservacoes(dados.observacoes ?? '');
      // Auto-vínculo do imóvel por endereço, quando possível
      const end = dados.imovel.endereco?.toLowerCase();
      if (end) {
        const match = imoveis.find((i) => i.endereco && end.includes(i.endereco.toLowerCase().slice(0, 15)));
        if (match) setImovelId(match.id);
      }
      setIaNaoAchou(faltando);
      setStep('revisao');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível analisar o contrato.');
      setStep('upload');
    }
  };

  const salvar = async () => {
    if (!file) return;
    if (!dataFim) { toast.error('Informe o vencimento (data_fim) — é o que gera os alertas.'); return; }
    setStep('salvando');
    const toastId = toast.loading('Salvando contrato...');
    try {
      const { data: corretorId, error: corrErr } = await supabase.rpc('get_corretor_id');
      if (corrErr || !corretorId) throw new Error('Não foi possível identificar o corretor.');

      // Upload do arquivo (bucket documentos exige corretor_id como 1ª pasta)
      const safeName = file.name.replace(/[^\w.-]+/g, '_');
      const path = `${corretorId}/contratos/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from('documentos').upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('contratos').insert({
        corretor_id: corretorId,
        tipo,
        cliente_id: clienteId !== 'NENHUM' ? clienteId : null,
        imovel_id: imovelId !== 'NENHUM' ? imovelId : null,
        valor: Number(valor) || 0,
        data_inicio: dataInicio || new Date().toISOString().slice(0, 10),
        data_fim: dataFim,
        observacoes: observacoes.trim() || null,
        arquivo_url: path,
        conteudo: '', // contrato enviado (não gerado): sem texto estruturado
        status: 'VIGENTE',
      });
      if (insErr) throw insErr;

      toast.success('Contrato salvo! Os alertas de vencimento serão disparados automaticamente.', { id: toastId });
      onSaved();
      close(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar o contrato.', { id: toastId });
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
                onClick={() => inputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-8 text-center hover:border-primary/50 hover:bg-primary/[0.02] transition"
              >
                <div className="p-3 rounded-full bg-primary/10"><UploadCloud className="h-6 w-6 text-primary" /></div>
                <p className="font-medium">Clique para enviar o contrato</p>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Imóvel</Label>
                <Select value={imovelId} onValueChange={setImovelId}>
                  <SelectTrigger><SelectValue placeholder="Vincular imóvel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NENHUM">Nenhum</SelectItem>
                    {imoveis.map((i) => <SelectItem key={i.id} value={i.id}>{i.titulo}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cliente</Label>
                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger><SelectValue placeholder="Vincular cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NENHUM">Nenhum</SelectItem>
                    {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
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

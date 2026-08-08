import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { useCRMStore } from '@/stores/crmStore';
import { TipoContrato, TIPO_CONTRATO_LABELS } from '@/types/crm';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Sparkles, Download, FileText, Loader2, X, Edit3, Check, Upload, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatContractForPreview } from '@/utils/contractPreview';
import { generateLocalContract } from '@/utils/contractTemplate';
import { useFileDrop } from '@/hooks/useFileDrop';
import { cn } from '@/lib/utils';
// Geradores de .docx/.pdf (libs docx e pdf-lib, ~800 kB) são importados
// dinamicamente dentro de baixarDocx/baixarPdf para não inflar este chunk.

interface GerarContratoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId?: string;
}

interface FormState {
  tipo: TipoContrato;
  tipoPersonalizado: string;
  marcaDaguaFile: File | null;
  marcaDaguaPreview: string | null;
  cliente_id: string;
  imovel_id: string;
  valor: number;
  data_inicio: string;
  prazo_meses: number;
  dia_vencimento: number;
  indice_reajuste: string;
  permite_animais: boolean;
  permite_reformas: boolean;
  mobiliado: boolean;
  clausulas_adicionais: string;
}

export function GerarContratoDialog({ open, onOpenChange, clienteId }: GerarContratoDialogProps) {
  const { clientes, imoveis, corretor, addContrato } = useCRMStore();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [contratoGerado, setContratoGerado] = useState('');
  const [modeloIA, setModeloIA] = useState('');
  const [tempoGeracao, setTempoGeracao] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContrato, setEditedContrato] = useState('');
  const [downloading, setDownloading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [form, setForm] = useState<FormState>({
    tipo: 'LOCACAO_RESIDENCIAL',
    tipoPersonalizado: '',
    marcaDaguaFile: null,
    marcaDaguaPreview: null,
    cliente_id: clienteId || '',
    imovel_id: '',
    valor: 0,
    data_inicio: '',
    prazo_meses: 30,
    dia_vencimento: 10,
    indice_reajuste: 'IGPM',
    permite_animais: false,
    permite_reformas: false,
    mobiliado: false,
    clausulas_adicionais: '',
  });
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle watermark image upload
  const handleWatermarkUpload = (file: File | undefined) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Arquivo inválido',
        description: 'Por favor, selecione uma imagem (PNG, JPG ou WEBP)',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'Arquivo muito grande',
        description: 'A imagem deve ter no máximo 2MB',
        variant: 'destructive',
      });
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (event) => {
      setForm({
        ...form,
        marcaDaguaFile: file,
        marcaDaguaPreview: event.target?.result as string,
      });
    };
    reader.readAsDataURL(file);
  };

  const removeWatermark = () => {
    setForm({
      ...form,
      marcaDaguaFile: null,
      marcaDaguaPreview: null,
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const { dragActive: marcaDragActive, dropProps: marcaDropProps } = useFileDrop(
    (arquivos) => handleWatermarkUpload(arquivos[0]),
    { accept: 'image/*' },
  );

  const selectedCliente = clientes.find(c => c.id === form.cliente_id);
  const selectedImovel = imoveis.find(i => i.id === form.imovel_id);

  const resetDialog = () => {
    setStep(1);
    setContratoGerado('');
    setEditedContrato('');
    setIsEditing(false);
    setProgress(0);
    setModeloIA('');
    setTempoGeracao(0);
  };

  const gerarContrato = async () => {
    if (!selectedCliente || !selectedImovel) {
      toast({ title: 'Erro', description: 'Selecione cliente e imóvel', variant: 'destructive' });
      return;
    }

    setGenerating(true);
    setProgress(10);
    abortControllerRef.current = new AbortController();

    // Simulate progress while waiting for API
    const progressInterval = setInterval(() => {
      setProgress(p => Math.min(p + 5, 85));
    }, 500);

    try {
      const tipoContratoFinal = form.tipo === 'OUTRO'
        ? form.tipoPersonalizado
        : TIPO_CONTRATO_LABELS[form.tipo];

      const requestBody = {
        tipo: tipoContratoFinal,
        tipoPersonalizado: form.tipo === 'OUTRO' ? form.tipoPersonalizado : undefined,
        cliente: {
          nome: selectedCliente.nome,
          telefone: selectedCliente.telefone,
          email: selectedCliente.email,
        },
        imovel: {
          endereco: selectedImovel.endereco,
          bairro: selectedImovel.bairro,
          cidade: selectedImovel.cidade,
          tipo: selectedImovel.tipo,
          area_m2: selectedImovel.area_m2,
          dormitorios: selectedImovel.dormitorios,
          garagem: selectedImovel.garagem,
          descricao: selectedImovel.descricao,
        },
        proprietario: {
          nome: selectedImovel.proprietario_nome,
          cpf: selectedImovel.proprietario_cpf,
          telefone: selectedImovel.proprietario_telefone,
        },
        corretor: {
          nome: corretor.nome,
          creci: corretor.creci,
          creci_estado: corretor.creci_estado,
          telefone: corretor.telefone,
          email: corretor.email,
        },
        detalhes: {
          valor: form.valor,
          data_inicio: form.data_inicio,
          prazo_meses: form.prazo_meses,
          dia_vencimento: form.dia_vencimento,
          indice_reajuste: form.indice_reajuste,
          permite_animais: form.permite_animais,
          permite_reformas: form.permite_reformas,
          mobiliado: form.mobiliado,
          clausulas_adicionais: form.clausulas_adicionais,
        },
      };

      const { data, error } = await supabase.functions.invoke('gerar-contrato', {
        body: requestBody,
      });

      clearInterval(progressInterval);

      if (error) {
        console.error('Error generating contract:', error);
        throw new Error(error.message || 'Erro ao gerar contrato');
      }

      if (data.error) {
        throw new Error(data.error);
      }

      setProgress(100);
      const formattedContrato = formatContractForPreview(data.contrato);
      setContratoGerado(formattedContrato);
      setEditedContrato(formattedContrato);
      setModeloIA(data.modelo_ia || 'google/gemini-2.5-flash');
      setTempoGeracao(data.tempo_geracao_ms || 0);
      setStep(4);

      toast({
        title: 'Contrato gerado!',
        description: `Gerado em ${((data.tempo_geracao_ms || 0) / 1000).toFixed(1)}s`,
      });
    } catch (error) {
      clearInterval(progressInterval);
      console.error('Contract generation error:', error);

      // Fallback: Generate local contract
      toast({
        title: '⚠️ Modo Offline / Fallback',
        description: 'Não foi possível conectar à IA. Gerando contrato base localmente.',
        // variant: 'default', // Using default to not look like a critical error
      });

      const localContract = generateLocalContract({
        tipo: form.tipo,
        cliente: {
          nome: selectedCliente.nome,
          telefone: selectedCliente.telefone,
          email: selectedCliente.email,
        },
        proprietario: {
          nome: selectedImovel.proprietario_nome,
          cpf: selectedImovel.proprietario_cpf,
        },
        imovel: {
          endereco: selectedImovel.endereco,
          bairro: selectedImovel.bairro,
          cidade: selectedImovel.cidade,
          tipo: selectedImovel.tipo,
          area_m2: selectedImovel.area_m2,
          dormitorios: selectedImovel.dormitorios,
          garagem: selectedImovel.garagem,
        },
        detalhes: {
          valor: form.valor,
          data_inicio: form.data_inicio,
          prazo_meses: form.prazo_meses,
          dia_vencimento: form.dia_vencimento,
          indice_reajuste: form.indice_reajuste,
          permite_animais: form.permite_animais,
          permite_reformas: form.permite_reformas,
          mobiliado: form.mobiliado,
          clausulas_adicionais: form.clausulas_adicionais,
        }
      });

      setContratoGerado(localContract);
      setEditedContrato(localContract);
      setModeloIA('Modelo Local (Offline)');
      setStep(4);
      setProgress(100);
    } finally {
      setGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const cancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setGenerating(false);
    setProgress(0);
  };

  const baixarDocx = async () => {
    if (!selectedCliente) return;

    setDownloading(true);
    try {
      const conteudoFinal = isEditing ? editedContrato : contratoGerado;
      const tipoContratoFinal = form.tipo === 'OUTRO'
        ? form.tipoPersonalizado
        : TIPO_CONTRATO_LABELS[form.tipo];

      const { generateContractDocx } = await import('@/services/contractDocxService');
      await generateContractDocx(conteudoFinal, {
        clienteNome: selectedCliente.nome,
        tipoContrato: tipoContratoFinal,
        marcaDaguaBase64: form.marcaDaguaPreview || undefined,
      });

      toast({
        title: 'Download iniciado!',
        description: 'O arquivo .docx está sendo baixado.',
      });
    } catch (error) {
      console.error('Error generating DOCX:', error);
      toast({
        title: 'Erro ao gerar documento',
        description: 'Não foi possível gerar o arquivo Word.',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  const baixarPdf = async () => {
    if (!selectedCliente) return;

    setDownloadingPdf(true);
    try {
      const conteudoFinal = isEditing ? editedContrato : contratoGerado;
      const tipoContratoFinal = form.tipo === 'OUTRO'
        ? form.tipoPersonalizado
        : TIPO_CONTRATO_LABELS[form.tipo];

      const { generateContractPdf } = await import('@/services/contractPdfService');
      await generateContractPdf(conteudoFinal, {
        clienteNome: selectedCliente.nome,
        tipoContrato: tipoContratoFinal,
        marcaDaguaBase64: form.marcaDaguaPreview || undefined,
      });

      toast({
        title: 'Download iniciado!',
        description: 'O arquivo .pdf está sendo baixado.',
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: 'Erro ao gerar PDF',
        description: 'Não foi possível gerar o arquivo PDF.',
        variant: 'destructive',
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const salvarContrato = async () => {
    const conteudoFinal = isEditing ? editedContrato : contratoGerado;

    const result = await addContrato({
      tipo: form.tipo,
      cliente_id: form.cliente_id,
      imovel_id: form.imovel_id,
      valor: form.valor,
      data_inicio: form.data_inicio,
      prazo_meses: form.prazo_meses,
      dia_vencimento: form.dia_vencimento,
      indice_reajuste: form.indice_reajuste,
      conteudo: conteudoFinal,
      status: 'RASCUNHO',
      versao: 1,
      modelo_ia: modeloIA,
      tempo_geracao_ms: tempoGeracao,
    });

    if (result) {
      toast({ title: 'Contrato salvo com sucesso!' });
      onOpenChange(false);
      resetDialog();
    } else {
      toast({ title: 'Erro ao salvar contrato', variant: 'destructive' });
    }
  };

  const handleClose = (isOpen: boolean) => {
    if (!generating) {
      onOpenChange(isOpen);
      if (!isOpen) resetDialog();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Gerar Contrato com IA
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Contract Type */}
        {step === 1 && !generating && (
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                Selecione o tipo de contrato que deseja gerar. A IA irá criar um documento
                profissional seguindo as normas do direito imobiliário brasileiro.
              </p>
            </div>

            <div>
              <Label>Tipo de Contrato</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoContrato, tipoPersonalizado: '' })}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPO_CONTRATO_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Campo personalizado quando "Outro" é selecionado */}
            {form.tipo === 'OUTRO' && (
              <div>
                <Label>Descreva o Tipo de Contrato</Label>
                <Textarea
                  value={form.tipoPersonalizado}
                  onChange={(e) => setForm({ ...form, tipoPersonalizado: e.target.value })}
                  placeholder="Ex: Contrato de Comodato, Contrato de Permuta, Termo de Cessão de Direitos..."
                  className="mt-2 min-h-[80px]"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Descreva detalhadamente o tipo de contrato que você precisa. A IA irá gerar com base nesta descrição.
                </p>
              </div>
            )}

            {/* Campo de Marca d'Água com Upload de Imagem */}
            <div>
              <Label>Marca d'Água - Imagem (opcional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={(e) => handleWatermarkUpload(e.target.files?.[0])}
                className="hidden"
              />

              {!form.marcaDaguaPreview ? (
                <div
                  {...marcaDropProps}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'mt-2 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                    marcaDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30',
                  )}
                >
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {marcaDragActive ? 'Solte a imagem aqui' : 'Arraste ou clique para selecionar uma imagem'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG, JPG, WEBP - Máximo 2MB
                  </p>
                </div>
              ) : (
                <div className="mt-2 border rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded border bg-muted/50 flex items-center justify-center overflow-hidden">
                      <img
                        src={form.marcaDaguaPreview}
                        alt="Preview da marca d'água"
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium truncate">
                        {form.marcaDaguaFile?.name || 'Imagem selecionada'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {form.marcaDaguaFile ? `${(form.marcaDaguaFile.size / 1024).toFixed(1)} KB` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeWatermark}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" />
                    A imagem aparecerá centralizada e semi-transparente no documento
                  </p>
                </div>
              )}
            </div>

            <Button
              className="w-full"
              onClick={() => setStep(2)}
              disabled={form.tipo === 'OUTRO' && !form.tipoPersonalizado.trim()}
            >
              Próximo
            </Button>
          </div>
        )}

        {/* Step 2: Client and Property */}
        {step === 2 && !generating && (
          <div className="space-y-4">
            <div>
              <Label>Cliente</Label>
              <Select value={form.cliente_id} onValueChange={(v) => setForm({ ...form, cliente_id: v })}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Selecione o cliente..." />
                </SelectTrigger>
                <SelectContent>
                  {clientes.filter(c => c.id).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Imóvel</Label>
              <Select
                value={form.imovel_id}
                onValueChange={(v) => {
                  const imovel = imoveis.find(i => i.id === v);
                  setForm({
                    ...form,
                    imovel_id: v,
                    valor: imovel?.valor || 0,
                  });
                }}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Selecione o imóvel..." />
                </SelectTrigger>
                <SelectContent>
                  {imoveis.filter(i => i.id).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.titulo} - {i.endereco}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedImovel && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <p className="font-medium mb-1">Dados do Imóvel:</p>
                <p>Proprietário: {selectedImovel.proprietario_nome}</p>
                <p>Endereço: {selectedImovel.endereco}, {selectedImovel.bairro}</p>
                <p>Valor: R$ {selectedImovel.valor.toLocaleString('pt-BR')}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
              <Button
                className="flex-1"
                onClick={() => setStep(3)}
                disabled={!form.cliente_id || !form.imovel_id}
              >
                Próximo
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Contract Details */}
        {step === 3 && !generating && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data Início</Label>
                <Input
                  type="date"
                  value={form.data_inicio}
                  onChange={(e) => setForm({ ...form, data_inicio: e.target.value })}
                  className="mt-2"
                />
              </div>
              <div>
                <Label>Prazo (meses)</Label>
                <Input
                  type="number"
                  value={form.prazo_meses}
                  onChange={(e) => setForm({ ...form, prazo_meses: Number(e.target.value) })}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Valor (R$)</Label>
                <Input
                  type="number"
                  value={form.valor}
                  onChange={(e) => setForm({ ...form, valor: Number(e.target.value) })}
                  className="mt-2"
                />
              </div>
              <div>
                <Label>Dia Vencimento</Label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={form.dia_vencimento}
                  onChange={(e) => setForm({ ...form, dia_vencimento: Number(e.target.value) })}
                  className="mt-2"
                />
              </div>
            </div>

            <div>
              <Label>Índice de Reajuste</Label>
              <Select value={form.indice_reajuste} onValueChange={(v) => setForm({ ...form, indice_reajuste: v })}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IGPM">IGP-M</SelectItem>
                  <SelectItem value="IPCA">IPCA</SelectItem>
                  <SelectItem value="INPC">INPC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label>Cláusulas Adicionais</Label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="animais"
                    checked={form.permite_animais}
                    onCheckedChange={(c) => setForm({ ...form, permite_animais: !!c })}
                  />
                  <label htmlFor="animais" className="text-sm cursor-pointer">
                    Permite animais de estimação
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="reformas"
                    checked={form.permite_reformas}
                    onCheckedChange={(c) => setForm({ ...form, permite_reformas: !!c })}
                  />
                  <label htmlFor="reformas" className="text-sm cursor-pointer">
                    Permite reformas (com autorização)
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="mobiliado"
                    checked={form.mobiliado}
                    onCheckedChange={(c) => setForm({ ...form, mobiliado: !!c })}
                  />
                  <label htmlFor="mobiliado" className="text-sm cursor-pointer">
                    Imóvel mobiliado
                  </label>
                </div>
              </div>
            </div>

            <div>
              <Label>Observações Adicionais (opcional)</Label>
              <Textarea
                value={form.clausulas_adicionais}
                onChange={(e) => setForm({ ...form, clausulas_adicionais: e.target.value })}
                placeholder="Digite cláusulas ou observações específicas..."
                className="mt-2 min-h-[80px]"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
              <Button className="flex-1" onClick={gerarContrato}>
                <Sparkles className="w-4 h-4 mr-2" />
                Gerar Contrato com IA
              </Button>
            </div>
          </div>
        )}

        {/* Generating State */}
        {generating && (
          <div className="py-12 text-center space-y-6">
            <div className="relative mx-auto w-20 h-20">
              <Sparkles className="w-20 h-20 text-primary animate-pulse" />
              <Loader2 className="absolute inset-0 w-20 h-20 text-primary/30 animate-spin" />
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-lg">Gerando contrato com IA...</p>
              <p className="text-sm text-muted-foreground">
                {progress < 30 && 'Preparando dados...'}
                {progress >= 30 && progress < 60 && 'Analisando cláusulas jurídicas...'}
                {progress >= 60 && progress < 85 && 'Montando documento...'}
                {progress >= 85 && 'Finalizando...'}
              </p>
            </div>
            <Progress value={progress} className="w-full max-w-xs mx-auto" />
            <Button variant="ghost" size="sm" onClick={cancelGeneration}>
              <X className="w-4 h-4 mr-2" />
              Cancelar
            </Button>
          </div>
        )}

        {/* Step 4: Preview and Actions */}
        {step === 4 && contratoGerado && !generating && (
          <div className="space-y-4">
            {/* Warning Banner */}
            <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <span>Este contrato foi gerado por IA e deve ser revisado por um advogado antes de ser utilizado.</span>
            </div>

            {/* Info Bar */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Modelo: {modeloIA}</span>
              <span>Gerado em {(tempoGeracao / 1000).toFixed(1)}s</span>
            </div>

            {/* Contract Preview/Edit */}
            <div className="bg-muted rounded-lg p-4 max-h-[400px] overflow-y-auto">
              {isEditing ? (
                <Textarea
                  value={editedContrato}
                  onChange={(e) => setEditedContrato(e.target.value)}
                  className="min-h-[350px] font-mono text-sm bg-background"
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed">
                  {contratoGerado}
                </pre>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isEditing) {
                    setIsEditing(false);
                  } else {
                    setEditedContrato(contratoGerado);
                    setIsEditing(true);
                  }
                }}
              >
                {isEditing ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Concluir Edição
                  </>
                ) : (
                  <>
                    <Edit3 className="w-4 h-4 mr-2" />
                    Editar
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={baixarDocx}
                disabled={downloading || downloadingPdf}
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Baixar Word
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={baixarPdf}
                disabled={downloading || downloadingPdf}
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 mr-2" />
                )}
                Baixar PDF
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetDialog();
                }}
              >
                <FileText className="w-4 h-4 mr-2" />
                Nova Geração
              </Button>
            </div>

            {/* Save Button */}
            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => handleClose(false)}>
                Fechar
              </Button>
              <Button className="flex-1" onClick={salvarContrato}>
                <Check className="w-4 h-4 mr-2" />
                Salvar Contrato
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

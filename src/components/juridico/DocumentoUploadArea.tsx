import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, FileText, Loader2, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { opcoesImoveisApi } from '@/lib/api/contratos';

interface Cliente {
  id: string;
  nome: string;
}

interface Imovel {
  id: string;
  titulo: string;
  endereco: string;
}

interface DocumentoUploadAreaProps {
  clientes: Cliente[];
  uploading: boolean;
  onUpload: (
    file: File,
    nome: string,
    tipo: string,
    clienteId?: string,
    imovelId?: string,
    dataValidade?: string,
    observacoes?: string
  ) => Promise<void>;
}

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];
const MAX_SIZE_MB = 10;

// Tipos expandidos para corretores imobiliários
const TIPOS_DOCUMENTO = [
  // Documentos Pessoais
  { value: 'RG', label: 'RG', categoria: 'pessoal' },
  { value: 'CPF', label: 'CPF', categoria: 'pessoal' },
  { value: 'CNH', label: 'CNH', categoria: 'pessoal' },
  { value: 'CERTIDAO_NASCIMENTO', label: 'Certidão de Nascimento', categoria: 'pessoal' },
  { value: 'CERTIDAO_CASAMENTO', label: 'Certidão de Casamento', categoria: 'pessoal' },
  
  // Comprovantes
  { value: 'COMPROVANTE_RESIDENCIA', label: 'Comprovante de Residência', categoria: 'comprovante' },
  { value: 'COMPROVANTE_RENDA', label: 'Comprovante de Renda', categoria: 'comprovante' },
  { value: 'EXTRATO_BANCARIO', label: 'Extrato Bancário', categoria: 'comprovante' },
  { value: 'IRPF', label: 'Declaração de IR', categoria: 'comprovante' },
  
  // Documentos do Imóvel
  { value: 'ESCRITURA', label: 'Escritura', categoria: 'imovel' },
  { value: 'MATRICULA', label: 'Matrícula do Imóvel', categoria: 'imovel' },
  { value: 'IPTU', label: 'IPTU', categoria: 'imovel' },
  { value: 'LAUDO_VISTORIA', label: 'Laudo de Vistoria', categoria: 'imovel' },
  { value: 'PLANTA', label: 'Planta do Imóvel', categoria: 'imovel' },
  { value: 'HABITE_SE', label: 'Habite-se', categoria: 'imovel' },
  
  // Certidões
  { value: 'CND_FEDERAL', label: 'CND Federal', categoria: 'certidao' },
  { value: 'CND_ESTADUAL', label: 'CND Estadual', categoria: 'certidao' },
  { value: 'CND_MUNICIPAL', label: 'CND Municipal', categoria: 'certidao' },
  { value: 'CND_TRABALHISTA', label: 'CND Trabalhista', categoria: 'certidao' },
  { value: 'CERTIDAO_DISTRIBUIDOR', label: 'Certidão de Distribuidor', categoria: 'certidao' },
  
  // Jurídicos
  { value: 'PROCURACAO', label: 'Procuração', categoria: 'juridico' },
  { value: 'CONTRATO', label: 'Contrato', categoria: 'juridico' },
  
  // Profissionais
  { value: 'CRECI', label: 'Documento CRECI', categoria: 'profissional' },
  { value: 'FICHA_CADASTRO', label: 'Ficha de Cadastro', categoria: 'profissional' },
  
  // Outros
  { value: 'OUTRO', label: 'Outro', categoria: 'outro' },
];

export function DocumentoUploadArea({
  clientes,
  uploading,
  onUpload,
}: DocumentoUploadAreaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('');
  const [clienteId, setClienteId] = useState<string>('');
  const [imovelId, setImovelId] = useState<string>('');
  const [dataValidade, setDataValidade] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [imoveis, setImoveis] = useState<Imovel[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch imóveis
  useEffect(() => {
    const fetchImoveis = async () => {
      if (apiDisponivel()) {
        const imoveisApi = await opcoesImoveisApi<Imovel>(['id', 'titulo', 'endereco']).catch(() => null);
        if (imoveisApi) setImoveis(imoveisApi);
        return;
      }
      const { data } = await supabase
        .from('imoveis')
        .select('id, titulo, endereco')
        .order('titulo');
      if (data) {
        setImoveis(data);
      }
    };
    fetchImoveis();
  }, []);

  const validateFile = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      toast.error(`Formato não permitido. Use: ${ALLOWED_EXTENSIONS.join(', ')}`);
      return false;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_SIZE_MB}MB`);
      return false;
    }

    return true;
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        if (!nome) {
          setNome(file.name.replace(/\.[^/.]+$/, ''));
        }
      }
    }
  }, [nome]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        if (!nome) {
          setNome(file.name.replace(/\.[^/.]+$/, ''));
        }
      }
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      toast.error('Selecione um arquivo');
      return;
    }

    if (!nome.trim()) {
      toast.error('Digite um nome para o documento');
      return;
    }

    if (!tipo) {
      toast.error('Selecione o tipo do documento');
      return;
    }

    try {
      await onUpload(
        selectedFile,
        nome.trim(),
        tipo,
        clienteId && clienteId !== 'NENHUM' ? clienteId : undefined,
        imovelId && imovelId !== 'NENHUM' ? imovelId : undefined,
        dataValidade || undefined,
        observacoes.trim() || undefined
      );

      // Reset form
      setSelectedFile(null);
      setNome('');
      setTipo('');
      setClienteId('');
      setImovelId('');
      setDataValidade('');
      setObservacoes('');
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    } catch (error) {
      // Error already handled in hook
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    setNome('');
    setTipo('');
    setClienteId('');
    setImovelId('');
    setDataValidade('');
    setObservacoes('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  // Agrupar tipos por categoria
  const tiposPorCategoria = {
    pessoal: TIPOS_DOCUMENTO.filter(t => t.categoria === 'pessoal'),
    comprovante: TIPOS_DOCUMENTO.filter(t => t.categoria === 'comprovante'),
    imovel: TIPOS_DOCUMENTO.filter(t => t.categoria === 'imovel'),
    certidao: TIPOS_DOCUMENTO.filter(t => t.categoria === 'certidao'),
    juridico: TIPOS_DOCUMENTO.filter(t => t.categoria === 'juridico'),
    profissional: TIPOS_DOCUMENTO.filter(t => t.categoria === 'profissional'),
    outro: TIPOS_DOCUMENTO.filter(t => t.categoria === 'outro'),
  };

  return (
    <Card className="border-dashed">
      <CardContent className="py-6">
        {/* Drop Zone */}
        <div
          className={cn(
            'flex flex-col items-center justify-center text-center p-8 rounded-lg border-2 border-dashed transition-colors cursor-pointer',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50',
            selectedFile && 'border-success bg-success/5'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => !selectedFile && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={handleFileSelect}
          />

          {selectedFile ? (
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-success" />
              <div className="text-left">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-full bg-primary/10 mb-4">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <h3 className="font-medium mb-1">
                {isDragging ? 'Solte o arquivo aqui' : 'Arraste documentos aqui'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Formatos aceitos: PDF, JPG, PNG, DOC, DOCX (máx. {MAX_SIZE_MB}MB)
              </p>
              <Button variant="outline" type="button">
                Selecionar Arquivo
              </Button>
            </>
          )}
        </div>

        {/* Form Fields */}
        {selectedFile && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nome">Nome do Documento *</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: RG João Silva"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo">Tipo de Documento *</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__header_pessoal" disabled className="font-semibold text-primary">
                      — Documentos Pessoais —
                    </SelectItem>
                    {tiposPorCategoria.pessoal.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                    
                    <SelectItem value="__header_comprovante" disabled className="font-semibold text-primary">
                      — Comprovantes —
                    </SelectItem>
                    {tiposPorCategoria.comprovante.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                    
                    <SelectItem value="__header_imovel" disabled className="font-semibold text-primary">
                      — Documentos do Imóvel —
                    </SelectItem>
                    {tiposPorCategoria.imovel.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                    
                    <SelectItem value="__header_certidao" disabled className="font-semibold text-primary">
                      — Certidões —
                    </SelectItem>
                    {tiposPorCategoria.certidao.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                    
                    <SelectItem value="__header_juridico" disabled className="font-semibold text-primary">
                      — Jurídicos —
                    </SelectItem>
                    {tiposPorCategoria.juridico.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                    
                    <SelectItem value="__header_profissional" disabled className="font-semibold text-primary">
                      — Profissionais —
                    </SelectItem>
                    {tiposPorCategoria.profissional.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                    
                    <SelectItem value="__header_outro" disabled className="font-semibold text-primary">
                      — Outros —
                    </SelectItem>
                    {tiposPorCategoria.outro.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cliente">Cliente (opcional)</Label>
                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Associar a cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NENHUM">Nenhum</SelectItem>
                    {clientes.filter(c => c.id).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="imovel">Imóvel (opcional)</Label>
                <Select value={imovelId} onValueChange={setImovelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Associar a imóvel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NENHUM">Nenhum</SelectItem>
                    {imoveis.filter(i => i.id).map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        <div className="flex items-center gap-2">
                          <Building className="w-3 h-3" />
                          <span>{i.titulo}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="validade">Data de Validade (opcional)</Label>
                <Input
                  id="validade"
                  type="date"
                  value={dataValidade}
                  onChange={(e) => setDataValidade(e.target.value)}
                />
              </div>
            </div>

            {/* Campo de Observações */}
            <div className="space-y-2">
              <Label htmlFor="observacoes">Observações (opcional)</Label>
              <Textarea
                id="observacoes"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value.slice(0, 500))}
                placeholder="Anotações sobre o documento..."
                className="resize-none"
                rows={3}
              />
              <p className="text-xs text-muted-foreground text-right">
                {observacoes.length}/500 caracteres
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={clearFile} disabled={uploading}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={uploading}>
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Enviar Documento'
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

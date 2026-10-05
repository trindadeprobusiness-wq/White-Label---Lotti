import { useState, useEffect } from 'react';
import { Loader2, Building } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { apiDisponivel } from '@/lib/api';
import { alterarDocumentoApi, opcoesImoveisApi } from '@/lib/api/contratos';
import { DocumentoRow } from '@/hooks/useDocumentos';

interface Cliente {
  id: string;
  nome: string;
}

interface Imovel {
  id: string;
  titulo: string;
  endereco: string;
}

interface EditarDocumentoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documento: DocumentoRow | null;
  clientes: Cliente[];
  onUpdate: () => void;
}

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

export function EditarDocumentoDialog({
  open,
  onOpenChange,
  documento,
  clientes,
  onUpdate,
}: EditarDocumentoDialogProps) {
  const [saving, setSaving] = useState(false);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('');
  const [clienteId, setClienteId] = useState<string>('');
  const [imovelId, setImovelId] = useState<string>('');
  const [dataValidade, setDataValidade] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [imoveis, setImoveis] = useState<Imovel[]>([]);

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

  // Preencher formulário quando documento mudar
  useEffect(() => {
    if (documento) {
      setNome(documento.nome);
      setTipo(documento.tipo);
      setClienteId(documento.cliente_id || 'NENHUM');
      setImovelId(documento.imovel_id || 'NENHUM');
      setDataValidade(documento.data_validade || '');
      setObservacoes(documento.observacoes || '');
    }
  }, [documento]);

  const handleSubmit = async () => {
    if (!documento) return;

    if (!nome.trim()) {
      toast.error('Digite um nome para o documento');
      return;
    }

    if (!tipo) {
      toast.error('Selecione o tipo do documento');
      return;
    }

    try {
      setSaving(true);

      if (apiDisponivel()) {
        // documentos não tem updated_at: a API não o envia (corrige D2).
        await alterarDocumentoApi(documento.id, {
          nome: nome.trim(),
          tipo,
          cliente_id: clienteId && clienteId !== 'NENHUM' ? clienteId : null,
          imovel_id: imovelId && imovelId !== 'NENHUM' ? imovelId : null,
          data_validade: dataValidade || null,
          observacoes: observacoes.trim() || null,
        });
        toast.success('Documento atualizado com sucesso!');
        onUpdate();
        onOpenChange(false);
        return;
      }

      const { error } = await supabase
        .from('documentos')
        .update({
          nome: nome.trim(),
          tipo,
          cliente_id: clienteId && clienteId !== 'NENHUM' ? clienteId : null,
          imovel_id: imovelId && imovelId !== 'NENHUM' ? imovelId : null,
          data_validade: dataValidade || null,
          observacoes: observacoes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', documento.id);

      if (error) throw error;

      toast.success('Documento atualizado com sucesso!');
      onUpdate();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Erro ao atualizar documento:', error);
      toast.error('Erro ao atualizar documento');
    } finally {
      setSaving(false);
    }
  };

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Documento</DialogTitle>
          <DialogDescription>
            Altere as informações do documento
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-nome">Nome do Documento *</Label>
            <Input
              id="edit-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: RG João Silva"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-tipo">Tipo de Documento *</Label>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-cliente">Cliente</Label>
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
              <Label htmlFor="edit-imovel">Imóvel</Label>
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-validade">Data de Validade</Label>
            <Input
              id="edit-validade"
              type="date"
              value={dataValidade}
              onChange={(e) => setDataValidade(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-observacoes">Observações</Label>
            <Textarea
              id="edit-observacoes"
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar Alterações'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

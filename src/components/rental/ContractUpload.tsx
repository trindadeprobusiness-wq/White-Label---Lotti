import { useState, useRef } from "react";
import { Upload, FileText, X, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { apiDisponivel } from "@/lib/api";
import { abrirPrivadoApi } from "@/lib/api/arquivos";
import { toast } from "sonner";

interface ContractUploadProps {
    onFileSelect: (file: File | null) => void;
    /** Path do arquivo já salvo no Storage (bucket 'documentos'). */
    existingFileUrl?: string;
}

/** Extrai um nome amigável a partir do path no storage. */
function extractFileName(path: string): string {
    const parts = path.split("/");
    const raw = parts[parts.length - 1] || "contrato";
    // Remove timestamp prefix (ex: "1719000000000_contrato.pdf" → "contrato.pdf")
    return raw.replace(/^\d+_/, "");
}

export function ContractUpload({ onFileSelect, existingFileUrl }: ContractUploadProps) {
    const [dragActive, setDragActive] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    /** Quando true, o usuário optou por substituir o arquivo existente. */
    const [replacing, setReplacing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = (file: File) => {
        // Validate type (PDF or Images)
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            alert("Apenas PDF ou Imagens (JPG, PNG) são permitidos.");
            return;
        }

        // Validate size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            alert("O arquivo não pode exceder 10MB.");
            return;
        }

        setSelectedFile(file);
        setReplacing(false);
        onFileSelect(file);
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    };

    const removeFile = () => {
        setSelectedFile(null);
        onFileSelect(null);
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    };

    const handleViewExisting = async () => {
        if (!existingFileUrl) return;
        try {
            if (apiDisponivel()) {
                // Bucket privado pela API (token no cabeçalho), aberto numa aba nova.
                await abrirPrivadoApi('documento', existingFileUrl);
                return;
            }
            const { data, error } = await supabase.storage
                .from('documentos')
                .createSignedUrl(existingFileUrl, 60 * 60);
            if (error) throw error;
            if (data?.signedUrl) {
                window.open(data.signedUrl, '_blank');
            }
        } catch (err: any) {
            console.error('Erro ao abrir contrato:', err);
            toast.error('Erro ao abrir contrato: ' + err.message);
        }
    };

    const handleReplace = () => {
        setReplacing(true);
        setSelectedFile(null);
        onFileSelect(null);
        // Abre o seletor de arquivo imediatamente
        setTimeout(() => inputRef.current?.click(), 100);
    };

    // ── Arquivo existente (modo edição, sem novo upload) ──
    const showExisting = existingFileUrl && !selectedFile && !replacing;

    // ── Novo arquivo selecionado ──
    const showSelected = !!selectedFile;

    // ── Zona de upload (nenhum arquivo) ──
    const showUploadZone = !showExisting && !showSelected;

    return (
        <div className="space-y-2">
            {showExisting && (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-background border-green-500/30">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-2 bg-green-500/10 rounded-lg">
                            <FileText className="w-5 h-5 text-green-600" />
                        </div>
                        <div className="truncate">
                            <p className="text-sm font-medium truncate max-w-[200px]">
                                {extractFileName(existingFileUrl)}
                            </p>
                            <p className="text-xs text-green-600">
                                Contrato anexado ✓
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-blue-600"
                            onClick={handleViewExisting}
                            title="Visualizar contrato"
                        >
                            <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-orange-600"
                            onClick={handleReplace}
                            title="Substituir contrato"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            )}

            {showSelected && (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-2 bg-primary/10 rounded-lg">
                            <FileText className="w-5 h-5 text-primary" />
                        </div>
                        <div className="truncate">
                            <p className="text-sm font-medium truncate max-w-[200px]">{selectedFile.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={removeFile}
                    >
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {showUploadZone && (
                <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={cn(
                        'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors bg-muted/20 hover:bg-muted/50',
                        dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
                    )}
                >
                    <div className="flex flex-col items-center gap-2">
                        <div className="p-3 rounded-full bg-primary/10">
                            <Upload className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <p className="font-medium text-sm">Upload do Contrato Assinado</p>
                            <p className="text-xs text-muted-foreground">
                                Arraste ou clique para selecionar (PDF ou Imagem)
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Input oculto — sempre presente para o seletor de arquivo */}
            <input
                ref={inputRef}
                type="file"
                accept=".pdf, .jpg, .jpeg, .png, .webp"
                onChange={handleChange}
                className="hidden"
            />
        </div>
    );
}

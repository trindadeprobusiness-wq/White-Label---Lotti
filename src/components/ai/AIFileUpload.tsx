import { forwardRef, useImperativeHandle, useState, useRef } from 'react';
import { Paperclip, X, FileText, Image, Video, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AI_ACCEPTED_TYPES } from '@/types/ai';

interface AIFileUploadProps {
  onFileProcessed: (result: { extracted_text: string; file_name: string }) => void;
  uploadFile: (file: File) => Promise<{ extracted_text: string; file_name: string } | null>;
  disabled?: boolean;
}

/** Deixa o container do chat (que é quem tem área para soltar) entregar o arquivo aqui. */
export interface AIFileUploadHandle {
  selecionarArquivo: (file: File) => void;
}

export const AIFileUpload = forwardRef<AIFileUploadHandle, AIFileUploadProps>(
  function AIFileUpload({ onFileProcessed, uploadFile, disabled }, ref) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selecionarArquivo = (file: File) => {
    setSelectedFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  };

  useImperativeHandle(ref, () => ({ selecionarArquivo }), []);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) selecionarArquivo(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    const result = await uploadFile(selectedFile);
    setUploading(false);
    if (result) {
      onFileProcessed(result);
      clear();
    }
  };

  const clear = () => {
    setSelectedFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const FileIcon = selectedFile?.type.startsWith('image/')
    ? Image
    : selectedFile?.type.startsWith('video/')
      ? Video
      : FileText;

  return (
    <>
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        onChange={handleSelect}
        accept={AI_ACCEPTED_TYPES.join(',')}
      />

      {selectedFile && (
        <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg border text-xs w-full">
          {preview ? (
            <img src={preview} alt="Prévia do arquivo" className="h-10 w-10 object-cover rounded" />
          ) : (
            <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <span className="truncate flex-1">{selectedFile.name}</span>
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : (
            <>
              <Button type="button" size="sm" variant="default" className="h-6 text-xs px-2" onClick={handleUpload}>
                Enviar
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={clear} aria-label="Remover arquivo">
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        title="Anexar arquivo"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  );
});

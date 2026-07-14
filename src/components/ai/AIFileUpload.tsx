import { useState, useRef } from 'react';
import { Paperclip, X, FileText, Image, Video, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AI_ACCEPTED_TYPES } from '@/types/ai';

interface AIFileUploadProps {
  onFileProcessed: (result: { extracted_text: string; file_name: string }) => void;
  uploadFile: (file: File) => Promise<{ extracted_text: string; file_name: string } | null>;
  disabled?: boolean;
}

export function AIFileUpload({ onFileProcessed, uploadFile, disabled }: AIFileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);



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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSet(file);
    }
  };

  const handleFileSet = (file: File) => {
    setSelectedFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSet(file);
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
        <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg border text-xs w-full shadow-sm mb-2 absolute bottom-full left-0 mb-4 z-10 w-64 max-w-full">
          {preview ? (
            <img src={preview} alt="Preview" className="h-10 w-10 object-cover rounded" />
          ) : (
            <FileIcon className="h-8 w-8 text-muted-foreground shrink-0 p-1 bg-background rounded" />
          )}
          <span className="truncate flex-1 font-medium">{selectedFile.name}</span>
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
          ) : (
            <>
              <Button size="sm" variant="default" className="h-6 text-xs px-2" onClick={handleUpload}>
                Enviar
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={clear}>
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}

      <div 
        className="relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Button
          type="button"
          variant={isDragging ? 'default' : 'outline'}
          size="icon"
          className="shrink-0 transition-colors"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          title="Anexar arquivo"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        {isDragging && (
          <div className="absolute inset-0 bg-primary/20 animate-pulse rounded-md pointer-events-none" />
        )}
      </div>
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseFileDropOptions {
  /** Tipos aceitos no formato do atributo accept: "application/pdf,image/*,.webp". Vazio = aceita tudo. */
  accept?: string;
  /** Entrega todos os arquivos soltos. Padrão: só o primeiro. */
  multiple?: boolean;
  /** Desliga o drop (ex.: enquanto a IA analisa). */
  disabled?: boolean;
  /** Chamado com os arquivos barrados pelo accept — use para o toast de erro. */
  onReject?: (files: File[]) => void;
}

interface UseFileDropReturn {
  /** true enquanto um arquivo está sendo arrastado por cima da área. */
  dragActive: boolean;
  /** Espalhe no container da área de upload: <div {...dropProps}>. */
  dropProps: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

/** O arraste só interessa quando traz arquivo (ignora texto/link arrastado da própria página). */
const carregaArquivos = (e: React.DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Drag & drop de arquivos para qualquer área de upload.
 *
 * Usa contador de profundidade em vez de reagir direto ao dragleave: sem isso o
 * realce pisca toda vez que o cursor passa por cima dos filhos (ícone, textos).
 */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  options: UseFileDropOptions = {},
): UseFileDropReturn {
  const { accept, multiple = false, disabled = false, onReject } = options;
  const [dragActive, setDragActive] = useState(false);
  const profundidade = useRef(0);

  const aceita = useCallback(
    (file: File) => {
      if (!accept) return true;
      return accept
        .split(',')
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean)
        .some((regra) => {
          if (regra.startsWith('.')) return file.name.toLowerCase().endsWith(regra);
          if (regra.endsWith('/*')) return file.type.toLowerCase().startsWith(regra.slice(0, -1));
          return file.type.toLowerCase() === regra;
        });
    },
    [accept],
  );

  const encerrar = useCallback(() => {
    profundidade.current = 0;
    setDragActive(false);
  }, []);

  // Se a área for desligada no meio do arraste (ex.: a análise começou), o
  // dragleave para de chegar e o realce ficaria aceso para sempre.
  useEffect(() => {
    if (disabled) encerrar();
  }, [disabled, encerrar]);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !carregaArquivos(e)) return;
      e.preventDefault();
      e.stopPropagation();
      profundidade.current += 1;
      setDragActive(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !carregaArquivos(e)) return;
      // preventDefault é obrigatório aqui: sem ele o onDrop nunca dispara.
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    },
    [disabled],
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    profundidade.current = Math.max(0, profundidade.current - 1);
    if (profundidade.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      encerrar();

      const soltos = Array.from(e.dataTransfer?.files ?? []);
      if (!soltos.length) return;

      const validos = soltos.filter(aceita);
      const barrados = soltos.filter((f) => !aceita(f));
      if (barrados.length) onReject?.(barrados);
      if (!validos.length) return;

      onFiles(multiple ? validos : validos.slice(0, 1));
    },
    [disabled, encerrar, aceita, onReject, onFiles, multiple],
  );

  return { dragActive, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

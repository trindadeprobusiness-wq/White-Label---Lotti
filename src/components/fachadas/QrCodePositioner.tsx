import { useRef, useState, useCallback, useEffect } from 'react';
import { QrCode, Minus, Plus, Move } from 'lucide-react';

interface QrCodePositionerProps {
  /** URL da imagem de preview (blob ou http) */
  imageSrc: string;
  /** Posição do QR em % (0-100). Default: centro */
  position: { x: number; y: number };
  /** Callback quando a posição muda */
  onPositionChange: (pos: { x: number; y: number }) => void;
  /** Tamanho do QR em % da largura do container (5-50). Default: 20 */
  qrSizePercent: number;
  /** Callback quando o tamanho muda */
  onSizeChange: (size: number) => void;
  /** Botão de remoção extra (slot) */
  removeButton?: React.ReactNode;
}

export function QrCodePositioner({
  imageSrc,
  position,
  onPositionChange,
  qrSizePercent,
  onSizeChange,
  removeButton,
}: QrCodePositionerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, size: 0, containerWidth: 0 });

  // ─── Convert mouse/touch coords to % position ───
  const getPercentPosition = useCallback(
    (clientX: number, clientY: number, offsetX: number, offsetY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;

      const rawX = clientX - rect.left - offsetX;
      const rawY = clientY - rect.top - offsetY;

      const x = Math.max(0, Math.min(100, (rawX / rect.width) * 100));
      const y = Math.max(0, Math.min(100, (rawY / rect.height) * 100));

      return { x, y };
    },
    [],
  );

  // ─── Mouse handlers ───
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);

      // Calculate offset from center of the overlay to where user clicked
      const overlayEl = e.currentTarget;
      const overlayRect = overlayEl.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - (overlayRect.left + overlayRect.width / 2),
        y: e.clientY - (overlayRect.top + overlayRect.height / 2),
      };
    },
    [],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getPercentPosition(
        e.clientX,
        e.clientY,
        dragOffset.current.x,
        dragOffset.current.y,
      );
      if (pos) onPositionChange(pos);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, getPercentPosition, onPositionChange]);

  // ─── Resize handlers ───
  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const dx = clientX - resizeStart.current.x;
      // Since it scales from center, dragging right by dx increases total width by dx * 2
      const percentChange = (dx * 2 / resizeStart.current.containerWidth) * 100;
      const newSize = Math.max(5, Math.min(80, resizeStart.current.size + percentChange));
      onSizeChange(Math.round(newSize));
    };

    const handleUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isResizing, onSizeChange]);

  // ─── Touch handlers ───
  useEffect(() => {
    if (!isDragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const pos = getPercentPosition(
        touch.clientX,
        touch.clientY,
        dragOffset.current.x,
        dragOffset.current.y,
      );
      if (pos) onPositionChange(pos);
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, getPercentPosition, onPositionChange]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.stopPropagation();
      setIsDragging(true);

      const touch = e.touches[0];
      if (!touch) return;
      const overlayEl = e.currentTarget;
      const overlayRect = overlayEl.getBoundingClientRect();
      dragOffset.current = {
        x: touch.clientX - (overlayRect.left + overlayRect.width / 2),
        y: touch.clientY - (overlayRect.top + overlayRect.height / 2),
      };
    },
    [],
  );

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setIsResizing(true);
    resizeStart.current = { x: e.clientX, size: qrSizePercent, containerWidth: rect.width };
  };

  const handleResizeTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    if (!touch) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setIsResizing(true);
    resizeStart.current = { x: touch.clientX, size: qrSizePercent, containerWidth: rect.width };
  };

  // ─── Size presets ───
  const decreaseSize = () => onSizeChange(Math.max(5, qrSizePercent - 1));
  const increaseSize = () => onSizeChange(Math.min(80, qrSizePercent + 1));

  return (
    <div className="space-y-2">
      {/* Image container */}
      <div
        ref={containerRef}
        className="relative rounded-xl overflow-hidden border-2 border-primary/30 bg-black select-none"
        style={{ touchAction: 'none' }}
      >
        <img
          src={imageSrc}
          alt="Preview"
          className="w-full max-h-80 object-contain mx-auto pointer-events-none"
          draggable={false}
        />

        {/* ─── Draggable QR Overlay ─── */}
        <div
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          className={`absolute flex flex-col items-center justify-center transition-shadow group ${
            isDragging || isResizing
              ? 'shadow-2xl shadow-primary/50 scale-105 z-50'
              : 'shadow-lg hover:shadow-xl z-40'
          }`}
          style={{
            left: `${position.x}%`,
            top: `${position.y}%`,
            transform: 'translate(-50%, -50%)',
            width: `${qrSizePercent}%`,
            aspectRatio: '1',
            cursor: isDragging ? 'grabbing' : (isResizing ? 'nwse-resize' : 'grab'),
          }}
        >
          {/* Visual overlay */}
          <div
            className={`w-full h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center backdrop-blur-sm transition-all ${
              isDragging || isResizing
                ? 'border-primary bg-primary/20'
                : 'border-white/60 bg-black/40 hover:border-primary/70 hover:bg-black/50'
            }`}
          >
            <QrCode
              className={`text-white/80 mb-0.5 ${
                qrSizePercent < 15 ? 'h-4 w-4' : 'h-8 w-8'
              }`}
            />
            {qrSizePercent >= 15 && (
              <p className="text-[9px] text-white/80 font-medium whitespace-nowrap">
                QR Code aqui
              </p>
            )}

            {/* Move icon hint */}
            <div className="absolute -top-3 -right-3 bg-primary/80 backdrop-blur-sm rounded-full p-1.5 shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
              <Move className="h-3 w-3 text-white" />
            </div>

            {/* Resize handle (bottom-right) */}
            <div 
              onMouseDown={handleResizeMouseDown}
              onTouchStart={handleResizeTouchStart}
              className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-primary border-2 border-white rounded-full shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
            />
            {/* Other handles for visual balance */}
            <div className="absolute -top-1.5 -left-1.5 w-2.5 h-2.5 bg-white/50 border border-white/80 rounded-full pointer-events-none" />
            <div className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-white/50 border border-white/80 rounded-full pointer-events-none" />
            <div className="absolute -bottom-1.5 -left-1.5 w-2.5 h-2.5 bg-white/50 border border-white/80 rounded-full pointer-events-none" />
          </div>
        </div>

        {/* Remove button (slot) */}
        {removeButton}
      </div>

      {/* ─── Size controls ─── */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Move className="h-3 w-3" />
          Arraste o QR Code para posicionar
        </p>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground mr-1">Tamanho:</span>
          <button
            type="button"
            onClick={decreaseSize}
            className="p-1 rounded-md bg-muted hover:bg-muted-foreground/20 transition"
            title="Diminuir"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="text-[10px] font-mono w-8 text-center">
            {qrSizePercent}%
          </span>
          <button
            type="button"
            onClick={increaseSize}
            className="p-1 rounded-md bg-muted hover:bg-muted-foreground/20 transition"
            title="Aumentar"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

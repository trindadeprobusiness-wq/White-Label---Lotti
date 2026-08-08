import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, ImagePlus, X, Loader2, Download, Sparkles, ChevronLeft, ChevronRight, Eye, EyeOff, RotateCw, Settings2, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useFileDrop } from '@/hooks/useFileDrop';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// ───────────────────────────────────────────────
// Constants & Types
// ───────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// A chave do Gemini e o prompt de análise agora vivem na Edge Function
// "analisar-foto" (servidor). Nada de chave de IA no bundle do navegador.

type WatermarkPosition = 'bottom-left' | 'bottom-right';

interface EnhancementParams {
    brightness: number;
    contrast: number;
    saturation: number;
    warmth: number;
    shadows: number;
    highlights: number;
    sharpness: number;
}

const DEFAULT_PARAMS: EnhancementParams = {
    brightness: 1.08,
    contrast: 1.15,
    saturation: 1.10,
    warmth: 5,
    shadows: 15,
    highlights: 10,
    sharpness: 0.4,
};

interface ProcessedImage {
    id: string;
    originalFile: File;
    originalUrl: string;
    processedUrl: string | null;
    status: 'pending' | 'processing' | 'done' | 'error';
    error?: string;
}

interface WatermarkConfig {
    logoUrl: string | null;
    logoFile: File | null;
    position: WatermarkPosition;
    opacity: number;
}

const WATERMARK_STORAGE_KEY = 'fotosIA_watermark_logo';
const WATERMARK_CONFIG_KEY = 'fotosIA_watermark_config';


// ───────────────────────────────────────────────
// Before/After Slider Component
// ───────────────────────────────────────────────
function BeforeAfterSlider({ originalUrl, processedUrl }: { originalUrl: string; processedUrl: string }) {
    const [sliderPos, setSliderPos] = useState(50);
    const [dragging, setDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragging || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        setSliderPos((x / rect.width) * 100);
    }, [dragging]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.touches[0].clientX - rect.left, rect.width));
        setSliderPos((x / rect.width) * 100);
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', () => setDragging(false));
        window.addEventListener('touchmove', handleTouchMove);
        window.addEventListener('touchend', () => setDragging(false));
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', () => setDragging(false));
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', () => setDragging(false));
        };
    }, [handleMouseMove, handleTouchMove]);

    return (
        <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-lg cursor-col-resize select-none"
            style={{ aspectRatio: '4/3' }}
            onMouseDown={() => setDragging(true)}
            onTouchStart={() => setDragging(true)}
        >
            {/* Processed (right/background) */}
            <img src={processedUrl} alt="Processada" className="absolute inset-0 w-full h-full object-cover" />

            {/* Original (left clip) */}
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
                <img src={originalUrl} alt="Original" className="absolute inset-0 w-full h-full object-cover" style={{ width: `${100 / (sliderPos / 100)}%`, maxWidth: 'none' }} />
            </div>

            {/* Divider */}
            <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
                style={{ left: `${sliderPos}%` }}
            >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
                    <ChevronLeft className="h-3 w-3 text-gray-600" />
                    <ChevronRight className="h-3 w-3 text-gray-600" />
                </div>
            </div>

            {/* Labels */}
            <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">Original</div>
            <div className="absolute top-2 right-2 bg-primary/80 text-white text-xs px-2 py-0.5 rounded">IA Melhorada</div>
        </div>
    );
}

// ───────────────────────────────────────────────
// Watermark Applier (canvas)
// ───────────────────────────────────────────────
async function applyWatermark(
    imageUrl: string,
    logoUrl: string,
    position: WatermarkPosition,
    opacity: number
): Promise<string> {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            const logo = new Image();
            logo.crossOrigin = 'anonymous';
            logo.onload = () => {
                const logoW = img.width * 0.18;
                const logoH = (logo.height / logo.width) * logoW;
                const margin = 20;
                const x = position === 'bottom-left' ? margin : img.width - logoW - margin;
                const y = img.height - logoH - margin;

                ctx.globalAlpha = opacity / 100;
                ctx.drawImage(logo, x, y, logoW, logoH);
                ctx.globalAlpha = 1;

                resolve(canvas.toDataURL('image/jpeg', 0.92));
            };
            logo.src = logoUrl;
        };
        img.src = imageUrl;
    });
}

// ───────────────────────────────────────────────
// Reduz a imagem (~maxDim px) e devolve só o base64 — usado APENAS para a
// análise pela IA. A imagem full-res original continua sendo a base do
// enhancement local. Payload menor = mais rápido, mais barato e dentro do
// limite de tamanho da Edge Function.
// ───────────────────────────────────────────────
function downscaleToBase64(file: File, maxDim = 1024): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            resolve(dataUrl.split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Erro ao carregar imagem')); };
        img.src = url;
    });
}

// ───────────────────────────────────────────────
// Step 1: Edge Function "analisar-foto" analisa a foto → devolve params JSON.
// A chave do Gemini fica no servidor. `userApiKey` é um override opcional
// (chave própria do usuário, digitada nas configurações).
// ───────────────────────────────────────────────
async function analyzePhotoViaEdge(file: File, userApiKey?: string): Promise<EnhancementParams> {
    try {
        const imageBase64 = await downscaleToBase64(file, 1024);
        const { data, error } = await supabase.functions.invoke('analisar-foto', {
            body: {
                imageBase64,
                mimeType: 'image/jpeg',
                userApiKey: userApiKey?.trim() || undefined,
            },
        });
        if (error) {
            console.warn('Análise IA falhou, usando padrões:', error.message);
            return DEFAULT_PARAMS;
        }
        return (data?.params as EnhancementParams) ?? DEFAULT_PARAMS;
    } catch (e) {
        console.warn('Erro na análise IA, usando padrões:', e);
        return DEFAULT_PARAMS;
    }
}

// ───────────────────────────────────────────────
// Step 2: Apply enhancement params via Canvas
// ───────────────────────────────────────────────
async function applyEnhancement(file: File, params: EnhancementParams): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imageData.data;

            for (let i = 0; i < d.length; i += 4) {
                let r = d[i], g = d[i + 1], b = d[i + 2];

                // 1. Shadow lifting (lighten dark areas)
                const luminance = (r + g + b) / 3;
                const shadowFactor = Math.max(0, 1 - luminance / 128);
                const shadowLift = params.shadows * shadowFactor;
                r += shadowLift; g += shadowLift; b += shadowLift;

                // 2. Highlight recovery (reduce blown highlights)
                const hiLuminance = (r + g + b) / 3;
                if (hiLuminance > 200) {
                    const excess = (hiLuminance - 200) / 55;
                    const reduce = params.highlights * excess;
                    r -= reduce; g -= reduce; b -= reduce;
                }

                // 3. Brightness
                r *= params.brightness; g *= params.brightness; b *= params.brightness;

                // 4. Contrast
                const c = params.contrast;
                r = c * (r - 128) + 128;
                g = c * (g - 128) + 128;
                b = c * (b - 128) + 128;

                // 5. Warmth (shift colour temperature)
                r += params.warmth;
                b -= params.warmth * 0.6;

                // 6. Saturation via luminosity
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                r = lum + params.saturation * (r - lum);
                g = lum + params.saturation * (g - lum);
                b = lum + params.saturation * (b - lum);

                // 7. Clamp
                d[i] = Math.min(255, Math.max(0, r));
                d[i + 1] = Math.min(255, Math.max(0, g));
                d[i + 2] = Math.min(255, Math.max(0, b));
            }

            ctx.putImageData(imageData, 0, 0);

            // 8. Sharpness via unsharp mask (draw blurred copy and blend)
            if (params.sharpness > 0) {
                const sharpCanvas = document.createElement('canvas');
                sharpCanvas.width = canvas.width;
                sharpCanvas.height = canvas.height;
                const sharpCtx = sharpCanvas.getContext('2d')!;
                sharpCtx.filter = 'blur(1px)';
                sharpCtx.drawImage(canvas, 0, 0);

                // Mix: sharp = original + amount*(original - blurred)
                const orig = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const blur = sharpCtx.getImageData(0, 0, canvas.width, canvas.height);
                const od = orig.data, bd = blur.data;
                for (let i = 0; i < od.length; i += 4) {
                    od[i] = Math.min(255, Math.max(0, od[i] + params.sharpness * (od[i] - bd[i])));
                    od[i + 1] = Math.min(255, Math.max(0, od[i + 1] + params.sharpness * (od[i + 1] - bd[i + 1])));
                    od[i + 2] = Math.min(255, Math.max(0, od[i + 2] + params.sharpness * (od[i + 2] - bd[i + 2])));
                }
                ctx.putImageData(orig, 0, 0);
            }

            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.93));
        };

        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Erro ao carregar imagem')); };
        img.src = url;
    });
}

// ───────────────────────────────────────────────
// Main processor: Gemini → Canvas
// ───────────────────────────────────────────────
async function processImage(file: File, userApiKey?: string): Promise<string> {
    const params = await analyzePhotoViaEdge(file, userApiKey);
    return applyEnhancement(file, params);
}

// ───────────────────────────────────────────────
// Download helpers
// ───────────────────────────────────────────────

function downloadDataUrl(dataUrl: string, filename: string) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
}

async function downloadAllAsZip(images: ProcessedImage[]) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const folder = zip.folder('fotos-ia');
    for (const img of images) {
        if (!img.processedUrl) continue;
        const base64 = img.processedUrl.split(',')[1];
        folder!.file(`${img.originalFile.name.replace(/\.[^.]+$/, '')}_ia.jpg`, base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, 'fotos-ia.zip');
    URL.revokeObjectURL(url);
}

// ───────────────────────────────────────────────
// Main Component
// ───────────────────────────────────────────────
export function FotosIA() {
    const [dragActive, setDragActive] = useState(false);
    const [images, setImages] = useState<ProcessedImage[]>([]);
    const [processing, setProcessing] = useState(false);
    const [watermark, setWatermark] = useState<WatermarkConfig>(() => {
        try {
            const saved = localStorage.getItem(WATERMARK_CONFIG_KEY);
            const logo = localStorage.getItem(WATERMARK_STORAGE_KEY);
            const config = saved ? JSON.parse(saved) : {};
            return {
                logoUrl: logo || null,
                logoFile: null,
                position: config.position || 'bottom-right',
                opacity: config.opacity ?? 80,
            };
        } catch {
            return { logoUrl: null, logoFile: null, position: 'bottom-right', opacity: 80 };
        }
    });
    const [showSettings, setShowSettings] = useState(false);
    // Override opcional: chave própria do usuário (vazio = usa a IA padrão do servidor).
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('fotosIA_apiKey') || '');

    const imageInputRef = useRef<HTMLInputElement>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);

    // Persist watermark config
    useEffect(() => {
        localStorage.setItem(WATERMARK_CONFIG_KEY, JSON.stringify({
            position: watermark.position,
            opacity: watermark.opacity,
        }));
    }, [watermark.position, watermark.opacity]);

    // Persist logo
    useEffect(() => {
        if (watermark.logoUrl && !watermark.logoUrl.startsWith('http')) {
            localStorage.setItem(WATERMARK_STORAGE_KEY, watermark.logoUrl);
        }
    }, [watermark.logoUrl]);

    // ── Drag & Drop ──
    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(e.type === 'dragenter' || e.type === 'dragover');
    };

    const validateAndAddFiles = (files: FileList | File[]) => {
        const arr = Array.from(files);
        const valid: ProcessedImage[] = [];
        for (const file of arr) {
            if (!ALLOWED_TYPES.includes(file.type)) {
                toast.error(`${file.name}: formato inválido. Use JPG, PNG ou WEBP.`);
                continue;
            }
            if (file.size > MAX_FILE_SIZE) {
                toast.error(`${file.name}: muito grande. Máximo 10MB.`);
                continue;
            }
            valid.push({
                id: `${Date.now()}-${Math.random()}`,
                originalFile: file,
                originalUrl: URL.createObjectURL(file),
                processedUrl: null,
                status: 'pending',
            });
        }
        if (valid.length) setImages(prev => [...prev, ...valid]);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files) validateAndAddFiles(e.dataTransfer.files);
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) validateAndAddFiles(e.target.files);
        e.target.value = '';
    };

    const removeImage = (id: string) => {
        setImages(prev => prev.filter(i => i.id !== id));
    };

    // ── Logo Upload ──
    const handleLogoUpload = (file: File | undefined) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        setWatermark(prev => ({ ...prev, logoUrl: url, logoFile: file }));
        // Also save to localStorage as base64
        const reader = new FileReader();
        reader.onload = () => {
            localStorage.setItem(WATERMARK_STORAGE_KEY, reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    const { dragActive: logoDragActive, dropProps: logoDropProps } = useFileDrop(
        (arquivos) => handleLogoUpload(arquivos[0]),
        { accept: 'image/*', onReject: () => toast.error('A logo precisa ser uma imagem (PNG, JPG ou WEBP).') },
    );

    // ── Process Images ──
    const handleProcess = async () => {
        const key = apiKey.trim();
        const pending = images.filter(i => i.status === 'pending');
        if (!pending.length) {
            toast.info('Nenhuma imagem pendente para processar.');
            return;
        }

        setProcessing(true);

        for (const img of pending) {
            // Mark as processing
            setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'processing' } : i));

            try {
                let processedUrl = await processImage(img.originalFile, key || undefined);

                // Apply watermark if logo is set
                if (watermark.logoUrl) {
                    processedUrl = await applyWatermark(processedUrl, watermark.logoUrl, watermark.position, watermark.opacity);
                }

                setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'done', processedUrl } : i));
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Erro desconhecido';
                setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'error', error: msg } : i));
                toast.error(`Erro em ${img.originalFile.name}: ${msg}`);
            }
        }

        setProcessing(false);
        toast.success('Processamento concluído!');
    };

    // ── Retry single ──
    const handleRetry = async (img: ProcessedImage) => {
        const key = apiKey.trim();
        setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'processing', error: undefined } : i));
        try {
            let processedUrl = await processImage(img.originalFile, key || undefined);
            if (watermark.logoUrl) {
                processedUrl = await applyWatermark(processedUrl, watermark.logoUrl, watermark.position, watermark.opacity);
            }
            setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'done', processedUrl } : i));
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Erro desconhecido';
            setImages(prev => prev.map(i => i.id === img.id ? { ...i, status: 'error', error: msg } : i));
        }
    };

    const doneImages = images.filter(i => i.status === 'done');
    const pendingImages = images.filter(i => i.status === 'pending');
    const processingImages = images.filter(i => i.status === 'processing');

    // ─────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────
    return (
        <div className="space-y-6">

            {/* ── SETTINGS PANEL ── */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Settings2 className="h-4 w-4 text-primary" />
                                Configurações
                            </CardTitle>
                            <CardDescription>Chave da API e marca d'água</CardDescription>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowSettings(s => !s)}>
                            {showSettings ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            {showSettings ? 'Ocultar' : 'Mostrar'}
                        </Button>
                    </div>
                </CardHeader>

                {showSettings && (
                    <CardContent className="space-y-6">
                        {/* API Key */}
                        <div className="space-y-2">
                            <Label>Chave da API Gemini (opcional)</Label>
                            <div className="flex gap-2">
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                    placeholder="AIzaSy..."
                                    className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                                <Button size="sm" onClick={() => {
                                    localStorage.setItem('fotosIA_apiKey', apiKey);
                                    toast.success('Chave salva!');
                                }}>Salvar</Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Deixe em branco para usar a IA padrão do sistema. Se preencher, sua própria chave (salva localmente no navegador) será usada no lugar.</p>
                        </div>

                        {/* Watermark */}
                        <div className="space-y-4 border-t pt-4">
                            <Label className="text-sm font-semibold">Marca d'Água da Empresa</Label>

                            {/* Logo upload */}
                            <div className="flex items-center gap-4">
                                {watermark.logoUrl ? (
                                    <div className="relative">
                                        <img src={watermark.logoUrl} alt="Logo" className="h-14 w-auto max-w-[120px] object-contain border rounded p-1 bg-checkered" />
                                        <button
                                            onClick={() => { setWatermark(prev => ({ ...prev, logoUrl: null, logoFile: null })); localStorage.removeItem(WATERMARK_STORAGE_KEY); }}
                                            className="absolute -top-1 -right-1 bg-destructive text-white rounded-full w-4 h-4 flex items-center justify-center text-xs"
                                        >×</button>
                                    </div>
                                ) : (
                                    <div
                                        {...logoDropProps}
                                        onClick={() => logoInputRef.current?.click()}
                                        className={cn(
                                            'h-14 w-28 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer text-muted-foreground text-xs gap-1 transition-colors',
                                            logoDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
                                        )}
                                    >
                                        <Upload className="h-4 w-4" />
                                        {logoDragActive ? 'Solte aqui' : 'Arraste ou clique'}
                                    </div>
                                )}
                                <input
                                    ref={logoInputRef}
                                    type="file"
                                    accept="image/png,image/webp,image/jpeg"
                                    className="hidden"
                                    onChange={(e) => { handleLogoUpload(e.target.files?.[0]); e.target.value = ''; }}
                                />
                                <div className="text-xs text-muted-foreground">
                                    Prefira PNG com fundo transparente.<br />
                                    A logo é salva localmente para reutilização.
                                </div>
                            </div>

                            {watermark.logoUrl && (
                                <>
                                    {/* Position */}
                                    <div className="space-y-2">
                                        <Label className="text-xs">Posição</Label>
                                        <div className="flex gap-3">
                                            {(['bottom-left', 'bottom-right'] as WatermarkPosition[]).map(pos => (
                                                <label key={pos} className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="wm-pos"
                                                        value={pos}
                                                        checked={watermark.position === pos}
                                                        onChange={() => setWatermark(prev => ({ ...prev, position: pos }))}
                                                        className="accent-primary"
                                                    />
                                                    <span className="text-sm">{pos === 'bottom-left' ? 'Inferior esquerdo' : 'Inferior direito'}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Opacity */}
                                    <div className="space-y-2">
                                        <Label className="text-xs">Opacidade: {watermark.opacity}%</Label>
                                        <Slider
                                            min={30}
                                            max={100}
                                            step={5}
                                            value={[watermark.opacity]}
                                            onValueChange={([v]) => setWatermark(prev => ({ ...prev, opacity: v }))}
                                            className="w-48"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </CardContent>
                )}
            </Card>

            {/* ── UPLOAD AREA ── */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <ImagePlus className="h-4 w-4 text-primary" />
                        Selecionar Imagens
                    </CardTitle>
                    <CardDescription>Arraste ou selecione múltiplas imagens para processar com IA</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Drop Zone */}
                    <div
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                        className={cn(
                            'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                            dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        )}
                    >
                        <ImagePlus className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground mb-1">Arraste imagens aqui ou clique para selecionar</p>
                        <p className="text-xs text-muted-foreground mb-4">JPG, PNG, WEBP (máx. 10MB por imagem)</p>
                        <input
                            ref={imageInputRef}
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleFileInput}
                            className="hidden"
                            id="foto-upload"
                        />
                        <Button variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                            <Upload className="h-4 w-4 mr-2" />
                            Selecionar Imagens
                        </Button>
                    </div>

                    {/* Preview Grid */}
                    {images.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {images.map(img => (
                                <div key={img.id} className="relative group rounded-lg overflow-hidden border bg-muted aspect-square">
                                    <img src={img.originalUrl} alt={img.originalFile.name} className="w-full h-full object-cover" />

                                    {/* Status overlay */}
                                    {img.status === 'processing' && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <Loader2 className="h-6 w-6 text-white animate-spin" />
                                        </div>
                                    )}
                                    {img.status === 'done' && (
                                        <div className="absolute bottom-1 left-1">
                                            <Badge className="text-[10px] px-1 py-0 bg-green-500 text-white border-0">✓ Pronta</Badge>
                                        </div>
                                    )}
                                    {img.status === 'error' && (
                                        <div className="absolute inset-0 bg-red-900/60 flex flex-col items-center justify-center gap-1 p-2">
                                            <p className="text-white text-[10px] text-center line-clamp-2">{img.error}</p>
                                            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleRetry(img)}>
                                                <RotateCw className="h-3 w-3 mr-1" />Tentar
                                            </Button>
                                        </div>
                                    )}

                                    {/* Remove button */}
                                    {img.status !== 'processing' && (
                                        <button
                                            onClick={() => removeImage(img.id)}
                                            className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 items-center justify-center text-xs hidden group-hover:flex"
                                        >×</button>
                                    )}

                                    {/* Filename */}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[9px] px-1 py-0.5 truncate">
                                        {img.originalFile.name}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Process Button */}
                    {images.length > 0 && (
                        <div className="flex items-center justify-between pt-2 border-t">
                            <div className="text-sm text-muted-foreground">
                                {images.length} imagem(ns) • {pendingImages.length} pendente(s) • {doneImages.length} pronta(s)
                            </div>
                            <Button
                                onClick={handleProcess}
                                disabled={processing || pendingImages.length === 0}
                                className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
                            >
                                {processing ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" />Processando {processingImages.length > 0 ? `(${images.indexOf(processingImages[0]) + 1}/${pendingImages.length + processingImages.length})` : ''}...</>
                                ) : (
                                    <><Sparkles className="h-4 w-4" />Processar com IA</>
                                )}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── RESULTS ── */}
            {doneImages.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <ZoomIn className="h-4 w-4 text-primary" />
                                    Resultados
                                </CardTitle>
                                <CardDescription>Compare antes e depois com o slider interativo</CardDescription>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => downloadAllAsZip(doneImages)}
                            >
                                <Download className="h-4 w-4" />
                                Baixar Todas ({doneImages.length})
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {doneImages.map(img => (
                                <div key={img.id} className="space-y-2">
                                    <BeforeAfterSlider originalUrl={img.originalUrl} processedUrl={img.processedUrl!} />
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{img.originalFile.name}</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs gap-1"
                                            onClick={() => downloadDataUrl(img.processedUrl!, `${img.originalFile.name.replace(/\.[^.]+$/, '')}_ia.jpg`)}
                                        >
                                            <Download className="h-3 w-3" />
                                            Baixar
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

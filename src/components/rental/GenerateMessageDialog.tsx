import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Wand2, Copy, Check, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FaturaAluguel } from "@/types/rental";

interface GenerateMessageDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    bill: FaturaAluguel | null;
    clientName?: string;
}

export function GenerateMessageDialog({ open, onOpenChange, bill, clientName }: GenerateMessageDialogProps) {
    const [messageType, setMessageType] = useState<string>("reminder");
    const [tone, setTone] = useState<string>("friendly");
    const [generatedMessage, setGeneratedMessage] = useState<string>("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasCopied, setHasCopied] = useState(false);

    const handleGenerate = async () => {
        if (!bill) return;

        setIsGenerating(true);
        setGeneratedMessage(""); // Clear previous

        try {
            // Token da sessão explícito: o invoke sozinho não anexa o JWT do corretor
            // de forma confiável (mesmo padrão usado na emissão de cobrança).
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Sua sessão expirou. Entre novamente.');
            const { data, error } = await supabase.functions.invoke('generate-whatsapp-message', {
                headers: { Authorization: `Bearer ${session.access_token}` },
                body: {
                    clientName: clientName || "Cliente",
                    messageType,
                    tone,
                    details: {
                        amount: bill.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                        dueDate: new Date(bill.data_vencimento).toLocaleDateString('pt-BR'),
                        referenceMonth: bill.mes_referencia,
                        status: bill.status
                    }
                }
            });

            if (error) throw error;

            if (data?.message) {
                setGeneratedMessage(data.message);
            } else {
                throw new Error("Nenhuma mensagem retornada pela IA.");
            }
        } catch (error: any) {
            console.error("Error generating message:", error);
            toast.error("Erro ao gerar mensagem: " + (error.message || "Tente novamente."));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = () => {
        if (!generatedMessage) return;
        navigator.clipboard.writeText(generatedMessage);
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), 2000);
        toast.success("Mensagem copiada!");
    };

    const handleWhatsApp = () => {
        if (!generatedMessage) return;
        const encoded = encodeURIComponent(generatedMessage);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-purple-600" />
                        Gerar Mensagem com IA
                    </DialogTitle>
                    <DialogDescription>
                        Crie mensagens personalizadas para {clientName} usando inteligência artificial.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Tipo de Mensagem</Label>
                            <Select value={messageType} onValueChange={setMessageType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="reminder">Lembrete de Vencimento</SelectItem>
                                    <SelectItem value="late">Cobrança de Atraso</SelectItem>
                                    <SelectItem value="thank_you">Agradecimento de Pagamento</SelectItem>
                                    <SelectItem value="custom">Outro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Tom da Conversa</Label>
                            <Select value={tone} onValueChange={setTone}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="friendly">Amigável 😊</SelectItem>
                                    <SelectItem value="formal">Profissional 👔</SelectItem>
                                    <SelectItem value="stern">Incisivo ⚠️</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>Mensagem Gerada</Label>
                            {generatedMessage && (
                                <div className="flex gap-2">
                                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCopy} title="Copiar">
                                        {hasCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600" onClick={handleWhatsApp} title="Enviar WhatsApp">
                                        <MessageSquare className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            )}
                        </div>
                        <div className="relative">
                            <Textarea
                                className="min-h-[150px] resize-none pr-4 font-normal text-sm"
                                placeholder="Clique em gerar para criar a mensagem..."
                                value={generatedMessage}
                                onChange={(e) => setGeneratedMessage(e.target.value)}
                            />
                            {isGenerating && (
                                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-[1px] rounded-md">
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                                        <span className="text-xs text-purple-600 font-medium animate-pulse">Criando mágica...</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="sm:justify-between">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
                    <Button
                        onClick={handleGenerate}
                        disabled={isGenerating || !bill}
                        className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white border-0"
                    >
                        {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                        Gerar Mensagem
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

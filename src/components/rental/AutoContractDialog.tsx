import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, User as UserIcon, Building2, FileText, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { ContractUpload } from "./ContractUpload";
import { extractContractData, ExtractedContractData } from "@/services/contractExtractionService";
import { Database } from "@/integrations/supabase/types";

type TipoContrato = Database["public"]["Enums"]["tipo_contrato"];

interface AutoContractDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "analyzing" | "review";

// Comparação sem acentos/caixa para casar entidades extraídas com as já cadastradas
const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const looseMatch = (a: string, b: string) => {
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return (na.length >= 8 && nb.includes(na)) || (nb.length >= 8 && na.includes(nb));
};

// Vencimento seguro para meses curtos (dia 31 em fevereiro → último dia do mês)
const makeDueDate = (year: number, month: number, day: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, lastDay));
};

export function AutoContractDialog({ open, onOpenChange }: AutoContractDialogProps) {
    const queryClient = useQueryClient();

    const [step, setStep] = useState<Step>("upload");
    const [contractFile, setContractFile] = useState<File | null>(null);
    const [extracted, setExtracted] = useState<ExtractedContractData | null>(null);

    // Campos revisáveis (pré-preenchidos pela IA)
    const [tenantName, setTenantName] = useState("");
    const [tenantPhone, setTenantPhone] = useState("");
    const [tenantEmail, setTenantEmail] = useState("");
    const [ownerName, setOwnerName] = useState("");
    const [propertyAddress, setPropertyAddress] = useState("");
    const [propertyCity, setPropertyCity] = useState("");
    const [rentValue, setRentValue] = useState("");
    const [startDate, setStartDate] = useState("");
    const [duration, setDuration] = useState("30");
    const [dueDay, setDueDay] = useState("10");
    const [adminFee, setAdminFee] = useState("10");

    const { data: clients } = useQuery({
        queryKey: ["clients-select"],
        queryFn: async () => {
            const { data } = await supabase.from("clientes").select("id, nome").order("nome");
            return data || [];
        },
        enabled: open,
    });

    const { data: properties } = useQuery({
        queryKey: ["properties-select"],
        queryFn: async () => {
            const { data } = await supabase.from("imoveis").select("id, titulo, proprietario_nome, endereco").eq("ativo", true).order("titulo");
            return data || [];
        },
        enabled: open,
    });

    const matchedClient = clients?.find(c => tenantName && looseMatch(c.nome, tenantName));
    const matchedProperty = properties?.find(p =>
        (propertyAddress && (looseMatch(p.endereco || "", propertyAddress) || looseMatch(p.titulo, propertyAddress)))
    );

    const resetAll = () => {
        setStep("upload");
        setContractFile(null);
        setExtracted(null);
        setTenantName("");
        setTenantPhone("");
        setTenantEmail("");
        setOwnerName("");
        setPropertyAddress("");
        setPropertyCity("");
        setRentValue("");
        setStartDate("");
        setDuration("30");
        setDueDay("10");
        setAdminFee("10");
    };

    const handleOpenChange = (o: boolean) => {
        onOpenChange(o);
        if (!o) resetAll();
    };

    const handleAnalyze = async () => {
        if (!contractFile) return;
        setStep("analyzing");
        try {
            const dados = await extractContractData(contractFile);
            setExtracted(dados);

            setTenantName(dados.inquilino.nome || "");
            setTenantPhone(dados.inquilino.telefone || "");
            setTenantEmail(dados.inquilino.email || "");
            setOwnerName(dados.proprietario_nome || "");
            setPropertyAddress(dados.imovel.endereco || "");
            setPropertyCity(dados.imovel.cidade || "");
            setRentValue(dados.valor_aluguel?.toString() || "");
            setStartDate(dados.data_inicio || format(new Date(), "yyyy-MM-dd"));
            setDuration(dados.prazo_meses?.toString() || "30");
            setDueDay(dados.dia_vencimento?.toString() || "10");
            setAdminFee(dados.taxa_administracao?.toString() || "10");

            setStep("review");
            toast.success("Contrato analisado!", { description: "Confira os dados extraídos antes de criar." });
        } catch (err) {
            setStep("upload");
            toast.error("Não foi possível analisar o contrato", {
                description: err instanceof Error ? err.message : "Tente novamente.",
            });
        }
    };

    const createContractMutation = useMutation({
        mutationFn: async () => {
            const { data: corretorId, error: corretorError } = await supabase.rpc("get_corretor_id");
            if (corretorError || !corretorId) throw new Error("Perfil de corretor não encontrado");

            const rent = parseFloat(rentValue) || 0;
            const dueD = parseInt(dueDay) || 10;
            const feePct = parseFloat(adminFee) || 10;
            const months = parseInt(duration) || 30;

            // 1. Inquilino: usa o cadastrado se casar pelo nome, senão cria
            let clienteId = matchedClient?.id;
            if (!clienteId) {
                const obs = [
                    "Cadastrado automaticamente via importação de contrato (IA)",
                    extracted?.inquilino.cpf ? `CPF: ${extracted.inquilino.cpf}` : null,
                ].filter(Boolean).join(". ");

                const { data: newClient, error } = await supabase
                    .from("clientes")
                    .insert({
                        nome: tenantName.trim(),
                        telefone: tenantPhone.trim(),
                        email: tenantEmail.trim() || null,
                        tipo_interesse: "LOCACAO",
                        observacoes: obs,
                        corretor_id: corretorId,
                    })
                    .select("id")
                    .single();
                if (error) throw new Error("Erro ao criar inquilino: " + error.message);
                clienteId = newClient.id;
            }

            // 2. Imóvel: usa o cadastrado se casar pelo endereço, senão cria
            let imovelId = matchedProperty?.id;
            if (!imovelId) {
                const tipoImovel = (extracted?.imovel.tipo || "APARTAMENTO") as Database["public"]["Enums"]["tipo_imovel"];
                const { data: newProperty, error } = await supabase
                    .from("imoveis")
                    .insert({
                        titulo: propertyAddress.trim(),
                        tipo: tipoImovel,
                        valor: rent,
                        area_m2: 0,
                        dormitorios: 0,
                        garagem: 0,
                        endereco: propertyAddress.trim(),
                        bairro: extracted?.imovel.bairro || "",
                        cidade: propertyCity.trim(),
                        proprietario_nome: ownerName.trim(),
                        corretor_id: corretorId,
                    })
                    .select("id")
                    .single();
                if (error) throw new Error("Erro ao criar imóvel: " + error.message);
                imovelId = newProperty.id;
            }

            // 3. Arquivo do contrato no storage
            let arquivoPath: string | undefined;
            if (contractFile) {
                const fileExt = contractFile.name.split(".").pop();
                const filePath = `${corretorId}/${Date.now()}_contrato.${fileExt}`;
                const { error: uploadError } = await supabase.storage
                    .from("documentos")
                    .upload(filePath, contractFile);
                if (uploadError) {
                    toast.warning("Contrato será criado, mas o upload do arquivo falhou: " + uploadError.message);
                } else {
                    arquivoPath = filePath;
                }
            }

            // 4. Contrato (mesma estrutura do fluxo manual)
            const start = new Date(startDate + "T12:00:00");
            const end = new Date(start);
            end.setMonth(end.getMonth() + months);
            const payoutDay = dueD + 5 <= 31 ? dueD + 5 : 1;
            const tipo: TipoContrato = "LOCACAO_RESIDENCIAL";

            const obsParts = ["Contrato importado automaticamente via IA"];
            if (extracted?.observacoes) obsParts.push(extracted.observacoes);

            const { data: contract, error: contractError } = await supabase
                .from("contratos")
                .insert({
                    corretor_id: corretorId,
                    cliente_id: clienteId,
                    imovel_id: imovelId,
                    tipo,
                    valor: rent,
                    data_inicio: startDate,
                    dia_vencimento: dueD,
                    conteudo: JSON.stringify({
                        obs: obsParts.join(" — "),
                        dia_repasse: payoutDay,
                        taxa_administracao: feePct,
                        meses_duracao: months.toString(),
                        data_fim_calculada: end.toISOString(),
                    }),
                    status: "ATIVO",
                    arquivo_url: arquivoPath,
                })
                .select()
                .single();
            if (contractError) throw new Error("Erro ao criar contrato: " + contractError.message);

            // 5. Primeira fatura
            const now = new Date();
            const dueDate = makeDueDate(start.getFullYear(), start.getMonth(), dueD);
            const { error: billError } = await (supabase as any)
                .from("faturas_aluguel")
                .insert({
                    contrato_id: contract.id,
                    cliente_id: clienteId,
                    imovel_id: imovelId,
                    corretor_id: corretorId,
                    valor_aluguel: rent,
                    data_vencimento: dueDate.toISOString(),
                    status: dueDate < now ? "ATRASADO" : "PENDENTE",
                    mes_referencia: format(dueDate, "MM/yyyy"),
                });
            if (billError) {
                console.error("Erro ao gerar primeira fatura:", billError);
                toast.error("Contrato criado, mas erro ao gerar primeira fatura.");
            }

            return contract;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rental-contracts"] });
            queryClient.invalidateQueries({ queryKey: ["rental-bills"] });
            queryClient.invalidateQueries({ queryKey: ["clients-select"] });
            queryClient.invalidateQueries({ queryKey: ["properties-select"] });
            toast.success("Contrato criado com IA!", {
                description: "Inquilino, imóvel, contrato e primeira fatura registrados.",
            });
            handleOpenChange(false);
        },
        onError: (err) => {
            toast.error(err instanceof Error ? err.message : "Erro ao criar contrato");
        },
    });

    const isReviewValid = tenantName.trim() && propertyAddress.trim() && parseFloat(rentValue) > 0 && startDate;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl p-0 overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-4 border-b bg-muted/30">
                    <DialogTitle className="text-xl flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        Contrato Automático com IA
                    </DialogTitle>
                    <DialogDescription>
                        Envie o contrato assinado e a IA cria o inquilino, o imóvel, o contrato e a primeira fatura.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[65vh] overflow-y-auto p-6">
                    {step === "upload" && (
                        <div className="space-y-4">
                            <ContractUpload onFileSelect={setContractFile} />
                            <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/30 rounded-lg border">
                                <p>• A IA lê o contrato e identifica inquilino, imóvel, valor, datas e vencimento.</p>
                                <p>• Você revisa os dados extraídos antes de confirmar a criação.</p>
                                <p>• Inquilino e imóvel que ainda não existirem serão cadastrados automaticamente.</p>
                            </div>
                        </div>
                    )}

                    {step === "analyzing" && (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <div className="p-4 rounded-full bg-primary/10">
                                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                            </div>
                            <div className="text-center">
                                <p className="font-medium">Analisando o contrato...</p>
                                <p className="text-sm text-muted-foreground">A IA está lendo o documento e extraindo os dados.</p>
                            </div>
                        </div>
                    )}

                    {step === "review" && (
                        <div className="space-y-5">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-semibold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                        <UserIcon className="w-4 h-4" /> Inquilino
                                    </h3>
                                    {matchedClient ? (
                                        <Badge variant="secondary" className="text-green-700 bg-green-100">Já cadastrado</Badge>
                                    ) : (
                                        <Badge variant="secondary" className="text-blue-700 bg-blue-100">Será criado</Badge>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5 sm:col-span-2">
                                        <Label>Nome</Label>
                                        <Input value={tenantName} onChange={e => setTenantName(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Telefone</Label>
                                        <Input value={tenantPhone} onChange={e => setTenantPhone(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Email</Label>
                                        <Input value={tenantEmail} onChange={e => setTenantEmail(e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-semibold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                        <Building2 className="w-4 h-4" /> Imóvel
                                    </h3>
                                    {matchedProperty ? (
                                        <Badge variant="secondary" className="text-green-700 bg-green-100">Já cadastrado</Badge>
                                    ) : (
                                        <Badge variant="secondary" className="text-blue-700 bg-blue-100">Será criado</Badge>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5 sm:col-span-2">
                                        <Label>Endereço</Label>
                                        <Input value={propertyAddress} onChange={e => setPropertyAddress(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Cidade</Label>
                                        <Input value={propertyCity} onChange={e => setPropertyCity(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Proprietário</Label>
                                        <Input value={ownerName} onChange={e => setOwnerName(e.target.value)} />
                                    </div>
                                </div>
                                {matchedProperty && (
                                    <p className="text-xs text-muted-foreground">
                                        Vinculado a: <span className="font-medium text-foreground">{matchedProperty.titulo}</span>
                                    </p>
                                )}
                            </div>

                            <Separator />

                            <div className="space-y-3">
                                <h3 className="font-semibold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                    <FileText className="w-4 h-4" /> Contrato
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Aluguel (R$)</Label>
                                        <Input type="number" value={rentValue} onChange={e => setRentValue(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Início</Label>
                                        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Duração (meses)</Label>
                                        <Input type="number" value={duration} onChange={e => setDuration(e.target.value)} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Dia Vencimento</Label>
                                        <Select value={dueDay} onValueChange={setDueDay}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent className="max-h-60">
                                                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                                                    <SelectItem key={d} value={d.toString()}>{d}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Taxa Adm (%)</Label>
                                        <Input type="number" value={adminFee} onChange={e => setAdminFee(e.target.value)} />
                                    </div>
                                </div>
                                {extracted?.observacoes && (
                                    <p className="text-xs text-muted-foreground p-2 bg-muted/30 rounded border">
                                        <span className="font-medium">Cláusulas identificadas:</span> {extracted.observacoes}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="px-6 py-4 border-t bg-muted/30 gap-2">
                    {step === "upload" && (
                        <>
                            <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancelar</Button>
                            <Button onClick={handleAnalyze} disabled={!contractFile}>
                                <Sparkles className="mr-2 h-4 w-4" /> Analisar Contrato
                            </Button>
                        </>
                    )}
                    {step === "analyzing" && (
                        <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancelar</Button>
                    )}
                    {step === "review" && (
                        <>
                            <Button variant="ghost" onClick={() => { setStep("upload"); }}>
                                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                            </Button>
                            <Button
                                onClick={() => createContractMutation.mutate()}
                                disabled={!isReviewValid || createContractMutation.isPending}
                            >
                                {createContractMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Criar Contrato
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

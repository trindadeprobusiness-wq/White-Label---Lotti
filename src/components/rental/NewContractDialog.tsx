import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Calculator, CalendarDays, UploadCloud, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { ContractUpload } from "./ContractUpload";
import { parseContratoContent } from "@/types/rental";
import { validarCPF, formatarCPF } from "@/lib/validators";
import { Database } from "@/integrations/supabase/types";
import { NovoImovelDialog } from "@/components/imoveis/NovoImovelDialog";
import { NovoClienteDialog } from "@/components/clientes/NovoClienteDialog";
import { extractContractData } from "@/services/contractExtractionService";

type TipoContrato = Database["public"]["Enums"]["tipo_contrato"];

interface NewContractDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contractToEdit?: any;
}

export function NewContractDialog({ open, onOpenChange, contractToEdit }: NewContractDialogProps) {
    const queryClient = useQueryClient();
    const isEditing = !!contractToEdit;

    // Form States
    const [clientId, setClientId] = useState("");
    const [inquilinoCpf, setInquilinoCpf] = useState(""); // CPF do inquilino (grava em clientes.cpf)
    const [propertyId, setPropertyId] = useState("");
    const [rentValue, setRentValue] = useState("");
    const [adminFee, setAdminFee] = useState("10");
    const [startDate, setStartDate] = useState("");
    const [dueDay, setDueDay] = useState("10");
    const [payoutDay, setPayoutDay] = useState("15");
    const [duration, setDuration] = useState("30");
    const [contractFile, setContractFile] = useState<File | null>(null);
    const [isExtractingCpf, setIsExtractingCpf] = useState(false);
    // Multa/juros por atraso (padrão de mercado: 10% + 1%/mês). Controle por contrato.
    const [aplicarMulta, setAplicarMulta] = useState(true);
    const [multaPct, setMultaPct] = useState("10");
    const [jurosMesPct, setJurosMesPct] = useState("1");

    // Ref para evitar re-extração se o componente re-renderizar
    const extractionAbortRef = useRef<AbortController | null>(null);

    // Dialog states
    const [isNovoImovelOpen, setIsNovoImovelOpen] = useState(false);
    const [isNovoClienteOpen, setIsNovoClienteOpen] = useState(false);

    // Populate form when editing
    useEffect(() => {
        if (contractToEdit && open) {
            setClientId(contractToEdit.cliente_id || "");
            setPropertyId(contractToEdit.imovel_id || "");
            setRentValue(contractToEdit.valor?.toString() || "");
            setStartDate(contractToEdit.data_inicio ? contractToEdit.data_inicio.split('T')[0] : "");
            setDueDay(contractToEdit.dia_vencimento?.toString() || "10");

            const content = parseContratoContent(contractToEdit.conteudo);
            setAdminFee(content.taxa_administracao?.toString() || "10");
            setPayoutDay(content.dia_repasse?.toString() || "15");
            setDuration(content.meses_duracao?.toString() || "30");

            // Multa/juros: a coluna guarda o juros AO DIA → exibe o mensal (×30).
            const multaVal = Number(contractToEdit.multa_atraso_percentual ?? 10);
            const jurosMesVal = Math.round(Number(contractToEdit.juros_mora_diario_percentual ?? (1 / 30)) * 30 * 100) / 100;
            setAplicarMulta(multaVal > 0 || jurosMesVal > 0);
            setMultaPct(multaVal > 0 ? String(multaVal) : "10");
            setJurosMesPct(jurosMesVal > 0 ? String(jurosMesVal) : "1");
        } else if (!open && !contractToEdit) {
            setRentValue("");
            setClientId("");
            setPropertyId("");
            setContractFile(null);
            setStartDate("");
            setAplicarMulta(true);
            setMultaPct("10");
            setJurosMesPct("1");
        }
    }, [contractToEdit, open]);

    // Fetch Clients (inclui cpf p/ pré-preencher o campo do inquilino)
    const { data: clients } = useQuery({
        queryKey: ["clients-select"],
        queryFn: async () => {
            const { data } = await supabase.from("clientes").select("id, nome, cpf").order("nome");
            return data || [];
        }
    });

    // Pré-preenche o CPF com o do inquilino selecionado (cobre seleção manual e edição)
    useEffect(() => {
        if (!clientId) { setInquilinoCpf(""); return; }
        const cli = clients?.find((c: any) => c.id === clientId);
        setInquilinoCpf(cli?.cpf ? formatarCPF(cli.cpf) : "");
    }, [clientId, clients]);

    // Fetch Properties
    const { data: properties } = useQuery({
        queryKey: ["properties-select"],
        queryFn: async () => {
            const { data } = await supabase.from("imoveis").select("id, titulo, proprietario_nome, endereco").eq("ativo", true).order("titulo");
            return data || [];
        }
    });

    const selectedProperty = properties?.find(p => p.id === propertyId);

    const handleNovoImovelClose = (open: boolean) => {
        setIsNovoImovelOpen(open);
        if (!open) {
            queryClient.invalidateQueries({ queryKey: ["properties-select"] });
        }
    };

    const handleNovoClienteClose = (open: boolean) => {
        setIsNovoClienteOpen(open);
        if (!open) {
            queryClient.invalidateQueries({ queryKey: ["clients-select"] });
        }
    };

    // ── Handler de upload: salva o arquivo e dispara extração de CPF via IA ──
    const handleFileSelect = (file: File | null) => {
        setContractFile(file);

        // Cancela extração anterior, se existir
        if (extractionAbortRef.current) {
            extractionAbortRef.current.abort();
            extractionAbortRef.current = null;
        }

        if (!file) return;

        // Dispara extração assíncrona (não bloqueia o formulário)
        const controller = new AbortController();
        extractionAbortRef.current = controller;
        setIsExtractingCpf(true);

        extractContractData(file)
            .then((dados) => {
                if (controller.signal.aborted) return;

                if (dados.inquilino?.cpf) {
                    const cpfLimpo = dados.inquilino.cpf.replace(/\D/g, '');
                    if (cpfLimpo.length === 11) {
                        setInquilinoCpf(formatarCPF(cpfLimpo));
                        toast.success("CPF extraído do contrato via IA", {
                            description: `CPF identificado: ${formatarCPF(cpfLimpo)}`,
                            icon: <Sparkles className="w-4 h-4" />,
                        });
                    } else {
                        toast.warning("CPF encontrado no contrato parece incompleto. Confira manualmente.", {
                            icon: <Sparkles className="w-4 h-4" />,
                        });
                    }
                } else {
                    toast.warning("Não foi possível identificar o CPF do inquilino no contrato. Preencha manualmente.", {
                        icon: <Sparkles className="w-4 h-4" />,
                    });
                }
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                console.error("Erro na extração de CPF via IA:", err);
                toast.info("Não foi possível analisar o contrato via IA. O CPF pode ser preenchido manualmente.", {
                    description: err instanceof Error ? err.message : undefined,
                });
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsExtractingCpf(false);
                    extractionAbortRef.current = null;
                }
            });
    };

    // Calculations
    const rent = parseFloat(rentValue) || 0;
    const feePct = parseFloat(adminFee) || 0;
    const feeVal = rent * (feePct / 100);
    const netVal = rent - feeVal;

    // Validade do CPF do inquilino
    const cpfDigits = inquilinoCpf.replace(/\D/g, '');
    const cpfOk = validarCPF(inquilinoCpf);
    const cpfInvalido = cpfDigits.length > 0 && !cpfOk;

    // Mutation
    const upsertContractMutation = useMutation({
        mutationFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuário não autenticado");

            const { data: corretor } = await supabase.from("corretores").select("id").eq("user_id", user.id).single();
            if (!corretor) throw new Error("Perfil de corretor não encontrado");

            let arquivoPath = contractToEdit?.arquivo_url;

            if (contractFile) {
                const fileExt = contractFile.name.split('.').pop();
                const fileName = `${Date.now()}_contrato.${fileExt}`;
                const filePath = `${corretor.id}/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('documentos')
                    .upload(filePath, contractFile);

                if (uploadError) throw new Error("Erro ao fazer upload do contrato: " + uploadError.message);

                arquivoPath = filePath;
            }

            // Estimate end date
            const start = new Date(startDate);
            const end = new Date(start);
            end.setMonth(end.getMonth() + parseInt(duration));

            const tipo: TipoContrato = 'LOCACAO_RESIDENCIAL';

            const contractData = {
                corretor_id: corretor.id,
                cliente_id: clientId,
                imovel_id: propertyId,
                tipo,
                valor: rent,
                data_inicio: startDate || new Date().toISOString(),
                dia_vencimento: parseInt(dueDay),
                conteudo: JSON.stringify({
                    ...(contractToEdit ? parseContratoContent(contractToEdit.conteudo) : {}),
                    obs: "Contrato Gerado/Atualizado Manualmente", // Pode ser melhorado para preserver obs anterior se desejar, mas o foco é não perder as flags
                    dia_repasse: parseInt(payoutDay),
                    taxa_administracao: feePct,
                    meses_duracao: duration,
                    data_fim_calculada: end.toISOString()
                }),
                status: 'ATIVO',
                arquivo_url: arquivoPath,
                // Multa/juros por atraso. Coluna de juros é AO DIA (mensal ÷ 30).
                // Toggle desligado → 0/0 = boleto sem multa nem juros.
                multa_atraso_percentual: aplicarMulta ? (parseFloat(multaPct) || 0) : 0,
                juros_mora_diario_percentual: aplicarMulta ? ((parseFloat(jurosMesPct) || 0) / 30) : 0,
            };

            let result;

            if (isEditing && contractToEdit) {
                const { data, error } = await supabase
                    .from("contratos")
                    .update(contractData)
                    .eq("id", contractToEdit.id)
                    .select()
                    .single();

                if (error) throw error;
                result = data;

                // Sincroniza as faturas pendentes com o novo valor/dia do contrato e
                // atualiza os boletos já emitidos. IMPORTANTE: valor_total é coluna
                // GERADA (= valor_aluguel + condomínio + iptu + extras) → atualiza-se
                // valor_aluguel. A data só é remexida se o dia do contrato mudou (assim
                // vencimentos editados por fatura são preservados).
                try {
                    const { data: bills } = await (supabase as any)
                        .from('faturas_aluguel')
                        .select('id, mes_referencia, external_id')
                        .eq('contrato_id', contractToEdit.id)
                        .in('status', ['PENDENTE', 'ATRASADO']);

                    if (bills && bills.length > 0) {
                        const diaMudou = Number(contractToEdit.dia_vencimento) !== parseInt(dueDay);

                        await Promise.all(bills.map((bill: any) => {
                            const patch: Record<string, unknown> = { valor_aluguel: rent };
                            if (diaMudou) {
                                const [mm, yyyy] = String(bill.mes_referencia).split('/').map(Number);
                                const lastDay = new Date(yyyy, mm, 0).getDate();
                                const d = Math.min(parseInt(dueDay), lastDay);
                                patch.data_vencimento = `${yyyy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                            }
                            return (supabase as any).from('faturas_aluguel').update(patch).eq('id', bill.id);
                        }));

                        // Boletos já emitidos: re-sincroniza valor/data no Asaas (mesmo link).
                        const emitidas = bills.filter((b: any) => b.external_id);
                        if (emitidas.length > 0) {
                            const { data: { session } } = await supabase.auth.getSession();
                            if (session) {
                                await Promise.all(emitidas.map((b: any) =>
                                    supabase.functions.invoke('asaas-sync', {
                                        body: { action: 'atualizar_cobranca', fatura_id: b.id },
                                        headers: { Authorization: `Bearer ${session.access_token}` },
                                    })
                                ));
                            }
                        }
                    }
                } catch (syncError) {
                    console.error("Erro ao sincronizar faturas:", syncError);
                    toast.error("Contrato salvo, mas houve erro ao atualizar as faturas pendentes.");
                }

                toast.success("Contrato atualizado com sucesso!", {
                    description: "Faturas pendentes foram recalculadas."
                });
            } else {
                const { data, error } = await supabase
                    .from("contratos")
                    .insert(contractData)
                    .select()
                    .single();

                if (error) throw error;
                result = data;

                // Generate First Bill for the new contract
                try {
                    const now = new Date();
                    const start = new Date(startDate || now);
                    // Start month/year
                    const refMonth = start.getMonth();
                    const refYear = start.getFullYear();
                    const dueD = parseInt(dueDay);

                    const dueDate = new Date(refYear, refMonth, dueD);
                    // If due date has already passed for this month, maybe they start next month?
                    // Usually we just generate the first month's bill anyway.
                    const correctStatus = dueDate < now ? 'ATRASADO' : 'PENDENTE';
                    const referenceMonthStr = format(dueDate, 'MM/yyyy');

                    const { error: billError } = await (supabase as any)
                        .from('faturas_aluguel')
                        .insert({
                            contrato_id: result.id,
                            cliente_id: clientId,
                            imovel_id: propertyId,
                            corretor_id: corretor.id,
                            valor_aluguel: rent,
                            data_vencimento: dueDate.toISOString(),
                            status: correctStatus,
                            mes_referencia: referenceMonthStr
                        });

                    if (billError) {
                        console.error("Erro ao gerar primeira fatura:", billError);
                        toast.error("Contrato criado, mas erro ao gerar primeira fatura.");
                    } else {
                        toast.success("Contrato e fatura criados com sucesso!", {
                            description: "Contrato ativo e primeira fatura gerada."
                        });
                    }
                } catch (err) {
                    console.error(err);
                    toast.success("Contrato criado com sucesso!", {
                        description: "Contrato ativo, porém verifique as faturas."
                    });
                }
            }

            // Persiste o CPF no cadastro do inquilino (destrava a emissão no Asaas).
            // Idempotente; só grava quando tem 11 dígitos. RLS já permite o corretor
            // atualizar o próprio cliente.
            const cpfClean = inquilinoCpf.replace(/\D/g, '');
            if (clientId && cpfClean.length === 11) {
                const { error: cpfError } = await supabase
                    .from('clientes')
                    .update({ cpf: cpfClean })
                    .eq('id', clientId);
                if (cpfError) {
                    console.error("Erro ao salvar CPF do inquilino:", cpfError);
                    toast.error("Contrato salvo, mas não foi possível gravar o CPF do inquilino.");
                }
            }

            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rental-contracts"] });
            queryClient.invalidateQueries({ queryKey: ["rental-bills"] });
            queryClient.invalidateQueries({ queryKey: ["rental-bills-all"] });
            queryClient.invalidateQueries({ queryKey: ["clients-select"] });
            onOpenChange(false);

            if (!isEditing) {
                setRentValue("");
                setClientId("");
                setPropertyId("");
                setContractFile(null);
                setStartDate("");
            }
        },
        onError: (err) => {
            toast.error(`Erro ao ${isEditing ? 'atualizar' : 'criar'} contrato: ` + err.message);
        }
    });

    // CPF é opcional no contrato (exigido só na emissão), mas se preenchido deve ser válido.
    const isValid = clientId && propertyId && rentValue && startDate && !cpfInvalido;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl p-0 overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-4 border-b bg-muted/30">
                    <DialogTitle className="text-xl">{isEditing ? "Editar Contrato" : "Novo Contrato de Aluguel"}</DialogTitle>
                    <DialogDescription>
                        {isEditing ? "Atualize os dados do contrato." : "Preencha os dados do contrato. O sistema calculará automaticamente os repasses."}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-12 max-h-[70vh] overflow-y-auto">
                    {/* Left Column: Entities & Documentation */}
                    <div className="md:col-span-4 p-6 border-r space-y-6 bg-background">
                        <div className="space-y-4">
                            <h3 className="font-semibold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                <UploadCloud className="w-4 h-4" /> Entidades
                            </h3>

                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <Label>Imóvel</Label>
                                        <div className="flex gap-2 items-center">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                type="button"
                                                className="h-auto p-0 text-xs text-green-600 hover:text-green-700"
                                                onClick={() => setIsNovoImovelOpen(true)}
                                            >
                                                <Plus className="w-3 h-3 mr-1" /> Novo Imóvel
                                            </Button>
                                            {selectedProperty && (
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    type="button"
                                                    className="h-auto p-0 text-xs text-blue-600"
                                                    onClick={() => window.open(`/imoveis?q=${encodeURIComponent(selectedProperty.titulo)}`, '_blank')}
                                                >
                                                    Editar Imóvel
                                                    <UploadCloud className="w-3 h-3 ml-1" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <Select value={propertyId} onValueChange={setPropertyId}>
                                        <SelectTrigger>
                                            <div className="truncate pr-4 w-full text-left">
                                                <SelectValue placeholder="Selecione o imóvel" />
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {properties?.map(p => (
                                                <SelectItem key={p.id} value={p.id} className="cursor-pointer">
                                                    <div className="flex flex-col text-left">
                                                        <span className="font-medium">{p.titulo}</span>
                                                        <span className="text-xs text-muted-foreground">{p.proprietario_nome}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {selectedProperty && (
                                        <p className="text-xs text-muted-foreground px-1">
                                            Proprietário: <span className="font-medium text-foreground">{selectedProperty.proprietario_nome}</span>
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <Label>Inquilino</Label>
                                        <div className="flex gap-2 items-center">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                type="button"
                                                className="h-auto p-0 text-xs text-green-600 hover:text-green-700"
                                                onClick={() => setIsNovoClienteOpen(true)}
                                            >
                                                <Plus className="w-3 h-3 mr-1" /> Novo Inquilino
                                            </Button>
                                            {clientId && (
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    type="button"
                                                    className="h-auto p-0 text-xs text-blue-600"
                                                    onClick={() => {
                                                        const client = clients?.find(c => c.id === clientId);
                                                        if (client) {
                                                            window.open(`/clientes?q=${encodeURIComponent(client.nome)}`, '_blank');
                                                        }
                                                    }}
                                                >
                                                    Editar Inquilino
                                                    <UploadCloud className="w-3 h-3 ml-1" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <Select value={clientId} onValueChange={setClientId}>
                                        <SelectTrigger>
                                            <div className="truncate pr-4 w-full text-left">
                                                <SelectValue placeholder="Selecione o cliente" />
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {clients?.map(c => (
                                                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    {clientId && (
                                        <div className="space-y-1 pt-1">
                                            <div className="flex items-center gap-2">
                                                <Label className="text-xs">CPF do Inquilino</Label>
                                                {isExtractingCpf && (
                                                    <span className="flex items-center gap-1 text-[11px] text-primary animate-pulse">
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                        <Sparkles className="w-3 h-3" />
                                                        Analisando via IA...
                                                    </span>
                                                )}
                                            </div>
                                            <Input
                                                value={inquilinoCpf}
                                                onChange={(e) => setInquilinoCpf(formatarCPF(e.target.value))}
                                                placeholder="000.000.000-00"
                                                inputMode="numeric"
                                                maxLength={14}
                                                className={cpfInvalido ? "border-destructive focus-visible:ring-destructive" : (cpfOk ? "border-green-500" : "")}
                                            />
                                            {cpfInvalido ? (
                                                <p className="text-[11px] text-destructive">CPF inválido — confira os dígitos.</p>
                                            ) : (
                                                <p className="text-[11px] text-muted-foreground">
                                                    Necessário para emitir a cobrança no Asaas.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-4">
                            <h3 className="font-semibold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                <UploadCloud className="w-4 h-4" /> Documentação
                            </h3>
                            <div className="space-y-2">
                                <Label>Contrato Assinado (PDF)</Label>
                                <ContractUpload
                                    onFileSelect={handleFileSelect}
                                    existingFileUrl={contractToEdit?.arquivo_url}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Middle Column: Financials & Dates */}
                    <div className="md:col-span-4 p-6 border-r space-y-6 bg-background">
                        <div className="space-y-4">
                            <h3 className="font-semibold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                <Calculator className="w-4 h-4" /> Financeiro
                            </h3>

                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label>Valor do Aluguel (R$)</Label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-2.5 text-muted-foreground font-semibold">R$</span>
                                        <Input
                                            type="number"
                                            value={rentValue}
                                            onChange={e => setRentValue(e.target.value)}
                                            className="pl-10 font-medium"
                                            placeholder="0,00"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Taxa Adm (%)</Label>
                                        <Input
                                            type="number"
                                            value={adminFee}
                                            onChange={e => setAdminFee(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Duração (Meses)</Label>
                                        <Select value={duration} onValueChange={setDuration}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="12">12 Meses</SelectItem>
                                                <SelectItem value="24">24 Meses</SelectItem>
                                                <SelectItem value="30">30 Meses</SelectItem>
                                                <SelectItem value="36">36 Meses</SelectItem>
                                                <SelectItem value="48">48 Meses</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Multa e juros por atraso — controle por contrato (vale p/ o boleto do Asaas) */}
                                <div className="rounded-lg border p-3 space-y-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <Label className="text-sm">Multa e juros por atraso</Label>
                                        <Switch checked={aplicarMulta} onCheckedChange={setAplicarMulta} />
                                    </div>
                                    {aplicarMulta ? (
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-muted-foreground">Multa (%)</Label>
                                                <Input
                                                    type="number"
                                                    value={multaPct}
                                                    onChange={e => setMultaPct(e.target.value)}
                                                    placeholder="10"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-muted-foreground">Juros ao mês (%)</Label>
                                                <Input
                                                    type="number"
                                                    value={jurosMesPct}
                                                    onChange={e => setJurosMesPct(e.target.value)}
                                                    placeholder="1"
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-[11px] text-muted-foreground">
                                            Sem multa nem juros — o boleto não cobra nada após o vencimento.
                                        </p>
                                    )}
                                    <p className="text-[11px] text-muted-foreground">
                                        Cobrado no boleto do Asaas quando o inquilino paga em atraso. Padrão de mercado: 10% de multa + 1% de juros ao mês.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-4">
                            <h3 className="font-semibold flex items-center gap-2 text-sm text-muted-foreground uppercase tracking-wider">
                                <CalendarDays className="w-4 h-4" /> Prazos
                            </h3>

                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label>Data de Início</Label>
                                    <Input
                                        type="date"
                                        value={startDate}
                                        onChange={e => setStartDate(e.target.value)}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label>Dia Vencimento</Label>
                                        <Select value={dueDay} onValueChange={(val) => {
                                            setDueDay(val);
                                            const next = parseInt(val) + 5;
                                            setPayoutDay(next <= 31 ? next.toString() : "1");
                                        }}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent className="max-h-60">
                                                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                                                    <SelectItem key={d} value={d.toString()}>{d}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label>Dia Repasse</Label>
                                        <Select value={payoutDay} onValueChange={setPayoutDay}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent className="max-h-60">
                                                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                                                    <SelectItem key={d} value={d.toString()}>{d}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Summary */}
                    <div className="md:col-span-4 p-6 space-y-4 bg-muted/20">
                        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
                            Resumo Financeiro
                        </h3>

                        <Card className="shadow-sm">
                            <CardContent className="p-4 space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Aluguel Bruto:</span>
                                    <span className="font-semibold">R$ {rent.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                                <Separator />
                                <div className="flex justify-between items-center text-blue-600">
                                    <span>Taxa Administrativa ({feePct}%):</span>
                                    <span className="font-semibold">- R$ {feeVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                                <Separator />
                                <div className="flex justify-between items-center text-green-600">
                                    <span>Repasse ao Proprietário:</span>
                                    <span className="font-bold text-lg">R$ {netVal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="text-xs text-muted-foreground space-y-1 p-3 bg-background rounded-lg border">
                            <p>• A fatura será gerada mensalmente no dia <strong>{dueDay}</strong>.</p>
                            <p>• O repasse ao proprietário será agendado para o dia <strong>{payoutDay}</strong>.</p>
                            <p>• O contrato terá duração de <strong>{duration} meses</strong>.</p>
                            <p>• Atraso: {aplicarMulta
                                ? <><strong>{multaPct || 0}%</strong> de multa + <strong>{jurosMesPct || 0}%</strong>/mês de juros</>
                                : <strong>sem multa nem juros</strong>}.</p>
                        </div>
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t bg-muted/30">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button
                        onClick={() => upsertContractMutation.mutate()}
                        disabled={!isValid || upsertContractMutation.isPending}
                    >
                        {upsertContractMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isEditing ? "Salvar Alterações" : "Criar Contrato"}
                    </Button>
                </DialogFooter>
            </DialogContent>

            {/* Quick Create Dialogs */}
            <NovoImovelDialog
                open={isNovoImovelOpen}
                onOpenChange={handleNovoImovelClose}
            />
            <NovoClienteDialog
                open={isNovoClienteOpen}
                onOpenChange={handleNovoClienteClose}
            />
        </Dialog>
    );
}

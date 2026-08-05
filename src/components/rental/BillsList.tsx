import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, CalendarDays, Wallet, Search, AlertCircle, CheckCircle, ArrowUpRight, ArrowDownLeft, Building2, ChevronLeft, ChevronRight, Eye, X, UploadCloud, Landmark, RefreshCw, Link2, RotateCcw, CalendarClock, MoreHorizontal } from "lucide-react";
import { format, addMonths, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseContratoContent } from "@/types/rental";
import { extractContractData, type ExtractedContractData } from "@/services/contractExtractionService";

export function BillsList() {
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [referenceDate, setReferenceDate] = useState(new Date());
    const [contractViewerUrl, setContractViewerUrl] = useState<string | null>(null);
    const [contractViewerTitle, setContractViewerTitle] = useState("");
    const [contractViewerDetails, setContractViewerDetails] = useState<any>(null);
    const [loadingContractId, setLoadingContractId] = useState<string | null>(null);
    const [isUploadingContract, setIsUploadingContract] = useState(false);
    const contractFileInputRef = useRef<HTMLInputElement>(null);

    // Leitura do contrato por IA: extrai o CPF do inquilino do PDF anexado.
    // Nada é gravado sem o corretor confirmar (CPF errado = cobrança errada).
    const [isExtracting, setIsExtracting] = useState(false);
    const [extraido, setExtraido] = useState<ExtractedContractData | null>(null);
    const [savingCpf, setSavingCpf] = useState(false);

    // Saldo da conta Asaas (buscado via Edge Function asaas-sync; a chave nunca vem ao front)
    const [saldoAsaas, setSaldoAsaas] = useState<number | null>(null);
    const [saldoLoading, setSaldoLoading] = useState(true);
    const [saldoNote, setSaldoNote] = useState<string | null>(null);

    const referenceMonthStr = format(referenceDate, 'MM/yyyy');
    const refYear = referenceDate.getFullYear();
    const refMonth = referenceDate.getMonth();

    // 1. Load active contracts (The source of truth)
    const { data: activeContracts, isLoading: loadingContracts } = useQuery({
        queryKey: ["active-contracts-for-bills"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('contratos')
                .select(`
                    *,
                    imoveis ( titulo, endereco, proprietario_nome ),
                    clientes ( nome )
                `)
                .eq('status', 'ATIVO');
            if (error) throw error;
            return data;
        },
    });

    // 2. Load generated bills for ALL months — a aba "Atrasadas" precisa
    // enxergar competências antigas, não só o mês selecionado
    const { data: allBills, isLoading: loadingBills } = useQuery({
        queryKey: ["rental-bills-all"],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from("faturas_aluguel")
                .select('*');
            if (error) throw error;
            return data;
        },
    });

    const monthlyBills = useMemo(
        () => allBills?.filter((b: { mes_referencia: string }) => b.mes_referencia === referenceMonthStr),
        [allBills, referenceMonthStr]
    );

    // Vencimento seguro para meses curtos (ex.: dia 31 em fevereiro)
    const makeDueDate = (year: number, month: number, day: number) => {
        const lastDay = new Date(year, month + 1, 0).getDate();
        return new Date(year, month, Math.min(day, lastDay));
    };

    const isLoading = loadingContracts || loadingBills;

    // 3. Compute Smart Bills List
    const smartBills = useMemo(() => {
        if (!activeContracts) return [];
        const now = new Date();

        return activeContracts.map(contract => {
            const existingBill = monthlyBills?.find(b => b.contrato_id === contract.id);

            const dueDay = contract.dia_vencimento || 10;
            // Fatura materializada: usa a data gravada (pode ter sido editada por
            // fatura). Virtual (projetada): deriva do dia do contrato.
            const dueDate = existingBill?.data_vencimento
                ? new Date(String(existingBill.data_vencimento).slice(0, 10) + 'T00:00:00')
                : makeDueDate(refYear, refMonth, dueDay);
            const isLate = dueDate < now;

            // If bill exists in DB, use its data. Otherwise, project a virtual bill.
            const status = existingBill ? existingBill.status : (isLate ? 'ATRASADO' : 'PENDENTE');
            const valor = existingBill ? existingBill.valor_total : contract.valor;
            const boletoUrl = existingBill ? ((existingBill as any).boleto_url_asaas || (existingBill as any).boleto_url) : null;
            const id = existingBill ? existingBill.id : `virtual_${contract.id}`;

            return {
                id,
                isVirtual: !existingBill,
                contract,
                dueDate,
                status,
                valor_total: valor,
                boletoUrl,
                externalId: existingBill ? (existingBill as any).external_id : null,
                pixText: existingBill ? (existingBill as any).pix_qrcode_text : null,
                mesReferencia: referenceMonthStr,
            };
        }).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    }, [activeContracts, monthlyBills, refMonth, refYear, referenceMonthStr]);

    // Faturas atrasadas de TODOS os meses: percorre as competências desde o
    // início de cada contrato e considera atrasada toda competência vencida
    // sem fatura PAGA/CANCELADA registrada no banco.
    const overdueBills = useMemo(() => {
        if (!activeContracts) return [] as typeof smartBills;
        const now = new Date();
        const MAX_MONTHS_BACK = 24;
        const result: typeof smartBills = [];

        for (const contract of activeContracts) {
            const dueDay = contract.dia_vencimento || 10;
            const start = contract.data_inicio ? new Date(contract.data_inicio) : subMonths(now, 11);
            const earliest = subMonths(now, MAX_MONTHS_BACK);
            const cursor = new Date(Math.max(start.getTime(), earliest.getTime()));
            cursor.setDate(1);
            cursor.setHours(0, 0, 0, 0);

            while (cursor <= now) {
                const mesRef = format(cursor, 'MM/yyyy');
                const dueDate = makeDueDate(cursor.getFullYear(), cursor.getMonth(), dueDay);

                if (dueDate < now) {
                    const dbBill = allBills?.find(
                        (b: { contrato_id: string; mes_referencia: string; status: string }) =>
                            b.contrato_id === contract.id && b.mes_referencia === mesRef
                    );
                    if (!dbBill || (dbBill.status !== 'PAGO' && dbBill.status !== 'CANCELADO')) {
                        result.push({
                            id: dbBill ? dbBill.id : `virtual_${contract.id}_${mesRef}`,
                            isVirtual: !dbBill,
                            contract,
                            dueDate,
                            status: 'ATRASADO',
                            valor_total: dbBill ? dbBill.valor_total : contract.valor,
                            boletoUrl: dbBill ? (dbBill.boleto_url_asaas || dbBill.boleto_url) : null,
                            externalId: dbBill ? dbBill.external_id : null,
                            pixText: dbBill ? dbBill.pix_qrcode_text : null,
                            mesReferencia: mesRef,
                        });
                    }
                }
                cursor.setMonth(cursor.getMonth() + 1);
            }
        }

        return result.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    }, [activeContracts, allBills]);

    // 4. Filtering — "Atrasadas" cobre todos os meses; as demais abas, o mês selecionado
    const sourceBills = statusFilter === 'ATRASADO' ? overdueBills : smartBills;
    const filteredBills = sourceBills.filter(bill => {
        const matchesSearch =
            bill.contract.imoveis?.titulo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            bill.contract.clientes?.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            bill.contract.imoveis?.proprietario_nome?.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus =
            statusFilter === "ALL" || statusFilter === "ATRASADO" ? true : bill.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    // 5. Stats
    const totalPending = smartBills.filter(b => b.status === "PENDENTE" || b.status === "ATRASADO").reduce((acc, curr) => acc + curr.valor_total, 0);
    const totalPaid = smartBills.filter(b => b.status === "PAGO").reduce((acc, curr) => acc + curr.valor_total, 0);

    // Helpers
    const getStatusLabel = (status: string) => {
        const labels: Record<string, string> = {
            'PAGO': 'Pago',
            'PENDENTE': 'Pendente',
            'ATRASADO': 'Atrasado',
            'CANCELADO': 'Cancelado'
        };
        return labels[status] || status;
    };

    const getBadgeStyle = (status: string) => {
        switch (status) {
            case 'PAGO': return "bg-green-100 text-green-800 border-green-200 hover:bg-green-100";
            case 'PENDENTE': return "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100";
            case 'ATRASADO': return "bg-red-100 text-red-800 border-red-200 hover:bg-red-100";
            default: return "bg-gray-100 text-gray-800 border-gray-200";
        }
    };

    // Open contract viewer panel
    const handleOpenContractViewer = async (bill: any) => {
        const contract = bill.contract;
        setLoadingContractId(bill.id);

        try {
            // Prepare contract details for the panel
            const content = parseContratoContent(contract.conteudo);
            const taxaPct = content.taxa_administracao || contract.taxa_administracao_percentual || 10;

            setContractViewerTitle(contract.imoveis?.titulo || 'Contrato');
            setContractViewerDetails({
                id: contract.id,
                corretorId: contract.corretor_id,
                clienteId: contract.cliente_id,
                proprietario: contract.imoveis?.proprietario_nome || '—',
                inquilino: contract.clientes?.nome || '—',
                endereco: contract.imoveis?.endereco || '—',
                valor: contract.valor,
                taxaAdm: taxaPct,
                diaVencimento: contract.dia_vencimento,
                diaRepasse: content.dia_repasse || (contract.dia_vencimento + 5),
                dataInicio: contract.data_inicio,
                dataFim: content.data_fim_calculada,
                mesesDuracao: content.meses_duracao,
                multaAtraso: content.multa_atraso,
                jurosMora: content.juros_mora,
                obs: content.obs,
                garantia: (content as any).garantia_tipo,
                status: contract.status,
            });

            // Try to load the PDF if there's an arquivo_url
            if (contract.arquivo_url) {
                const { data, error } = await supabase.storage
                    .from('documentos')
                    .createSignedUrl(contract.arquivo_url, 60 * 60); // 1h

                if (!error && data?.signedUrl) {
                    setContractViewerUrl(data.signedUrl);
                } else {
                    setContractViewerUrl(null);
                }
            } else {
                setContractViewerUrl(null);
            }
        } catch (err) {
            console.error('Erro ao carregar contrato:', err);
            setContractViewerUrl(null);
        } finally {
            setLoadingContractId(null);
        }
    };

    const handleContractUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !contractViewerDetails?.id || !contractViewerDetails?.corretorId) return;

        setIsUploadingContract(true);
        const toastId = toast.loading("Fazendo upload do contrato...");

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${contractViewerDetails.id}_${Date.now()}.${fileExt}`;
            // A policy do bucket 'documentos' exige que a primeira pasta seja o corretor_id
            const filePath = `${contractViewerDetails.corretorId}/contratos_aluguel/${fileName}`;

            // Upload the file
            const { error: uploadError } = await supabase.storage
                .from('documentos')
                .upload(filePath, file, { cacheControl: '3600', upsert: false });

            if (uploadError) throw uploadError;

            // Update contract record
            const { error: updateError } = await supabase
                .from('contratos')
                .update({ arquivo_url: filePath })
                .eq('id', contractViewerDetails.id);

            if (updateError) throw updateError;

            // Fetch the signed URL immediately to show in the viewer
            const { data: urlData } = await supabase.storage
                .from('documentos')
                .createSignedUrl(filePath, 60 * 60);

            if (urlData?.signedUrl) {
                setContractViewerUrl(urlData.signedUrl);
            }

            toast.success("Contrato anexado com sucesso!", { id: toastId });
            queryClient.invalidateQueries({ queryKey: ["rental-contracts"] });
            queryClient.invalidateQueries({ queryKey: ["rental-bills-monthly", referenceMonthStr] });

            // Com o PDF em mãos, a IA lê o contrato e propõe os dados do inquilino
            // (principalmente o CPF, que o Asaas exige para emitir a cobrança).
            void readContractWithAI(file);

        } catch (error: any) {
            console.error("Erro no upload:", error);
            toast.error("Erro ao anexar contrato: " + error.message, { id: toastId });
        } finally {
            setIsUploadingContract(false);
            if (event.target) event.target.value = ''; // reset input
        }
    };

    // Lê o contrato com IA (Gemini lê o PDF direto, inclusive escaneado) e abre a
    // confirmação. Falha aqui não desfaz o upload — o anexo já valeu por si.
    const readContractWithAI = async (file: File) => {
        setIsExtracting(true);
        const toastId = toast.loading("Lendo o contrato com IA...");
        try {
            const dados = await extractContractData(file);
            if (!dados.inquilino?.cpf) {
                toast.info("A IA leu o contrato, mas não encontrou o CPF do inquilino nele.", { id: toastId });
                return;
            }
            toast.dismiss(toastId);
            setExtraido(dados);
        } catch (err: any) {
            toast.error("Não foi possível ler o contrato: " + (err?.message ?? "erro desconhecido"), { id: toastId });
        } finally {
            setIsExtracting(false);
        }
    };

    // Validação de CPF (dígitos verificadores). A IA pode ler um dígito errado —
    // um CPF inválido aqui viraria uma cobrança errada lá na frente.
    const cpfValido = (cpf: string): boolean => {
        const d = cpf.replace(/\D/g, '');
        if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
        const calc = (base: number) => {
            let soma = 0;
            for (let i = 0; i < base; i++) soma += Number(d[i]) * (base + 1 - i);
            const resto = (soma * 10) % 11;
            return resto === 10 ? 0 : resto;
        };
        return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
    };

    const formatCpf = (cpf: string) => {
        const d = cpf.replace(/\D/g, '');
        return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
    };

    // Grava o CPF (e completa telefone/e-mail apenas se estiverem vazios — nunca
    // sobrescreve dado que o corretor já cadastrou).
    const handleConfirmCpf = async () => {
        const inq = extraido?.inquilino;
        const clienteId = contractViewerDetails?.clienteId;
        if (!inq?.cpf || !clienteId) return;

        setSavingCpf(true);
        try {
            const { data: atual, error: readErr } = await (supabase as any)
                .from('clientes')
                .select('telefone, email')
                .eq('id', clienteId)
                .single();
            if (readErr) throw readErr;

            const patch: Record<string, unknown> = { cpf: inq.cpf.replace(/\D/g, '') };
            if (!atual?.telefone && inq.telefone) patch.telefone = inq.telefone;
            if (!atual?.email && inq.email) patch.email = inq.email;

            const { error } = await (supabase as any).from('clientes').update(patch).eq('id', clienteId);
            if (error) throw error;

            toast.success("CPF preenchido! Agora é possível emitir a cobrança deste inquilino.");
            setExtraido(null);
            queryClient.invalidateQueries({ queryKey: ["rental-bills-all"] });
            queryClient.invalidateQueries({ queryKey: ["active-contracts-for-bills"] });
        } catch (err: any) {
            toast.error("Erro ao salvar o CPF: " + (err?.message ?? "erro desconhecido"));
        } finally {
            setSavingCpf(false);
        }
    };

    const [emittingId, setEmittingId] = useState<string | null>(null);
    // Confirmação de baixa e desfazer pagamento (evita cliques acidentais).
    const [billToConfirmPayment, setBillToConfirmPayment] = useState<any>(null);
    const [billToRevert, setBillToRevert] = useState<any>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    // Editar vencimento de uma fatura específica (atualiza o boleto se emitida).
    const [billToEditDate, setBillToEditDate] = useState<any>(null);
    const [newDueDate, setNewDueDate] = useState("");
    const [savingDate, setSavingDate] = useState(false);

    // Garante que a fatura exista no banco (persiste virtuais como PENDENTE) e
    // devolve o id real. A transição para PAGO é feita à parte para o trigger
    // handle_bill_payment() rodar uma única vez.
    const ensureFatura = async (bill: any): Promise<string> => {
        if (!bill.isVirtual) return bill.id;
        const { data, error } = await (supabase as any)
            .from('faturas_aluguel')
            .insert({
                contrato_id: bill.contract.id,
                cliente_id: bill.contract.cliente_id,
                imovel_id: bill.contract.imovel_id,
                corretor_id: bill.contract.corretor_id,
                valor_aluguel: bill.contract.valor,
                status: 'PENDENTE',
                data_vencimento: bill.dueDate.toISOString().split('T')[0],
                mes_referencia: bill.mesReferencia || referenceMonthStr,
                gerada_por: 'manual',
            })
            .select('id')
            .single();
        if (error) throw error;
        return data.id;
    };

    // Actions — a confirmação é feita por AlertDialog (não por confirm() nativo,
    // que era fácil de disparar sem querer).
    const doConfirmPayment = async (bill: any) => {
        setProcessingId(bill.id);
        const loadingToast = toast.loading("Processando pagamento...");
        try {
            const faturaId = await ensureFatura(bill);
            // Apenas transiciona para PAGO. O trigger handle_bill_payment() cria o
            // repasse ao proprietário e o lançamento de comissão (fonte única).
            const { error } = await (supabase as any)
                .from("faturas_aluguel")
                .update({
                    status: 'PAGO',
                    data_pagamento: new Date().toISOString().split('T')[0],
                    valor_pago: bill.valor_total,
                })
                .eq('id', faturaId);
            if (error) throw error;

            toast.dismiss(loadingToast);
            toast.success("Pagamento confirmado com sucesso!");
            queryClient.invalidateQueries({ queryKey: ["rental-bills-all"] });
        } catch (error: any) {
            console.error("Erro ao baixar fatura:", error);
            toast.dismiss(loadingToast);
            toast.error("Erro ao confirmar pagamento: " + error.message);
        } finally {
            setProcessingId(null);
            setBillToConfirmPayment(null);
        }
    };

    // Desfaz o pagamento (estorno): a função no banco remove o repasse AGENDADO e
    // a comissão gerados, e volta a fatura para pendente/atrasado.
    const handleRevertPayment = async (bill: any) => {
        setProcessingId(bill.id);
        const loadingToast = toast.loading("Desfazendo pagamento...");
        try {
            const { error } = await (supabase as any).rpc('estornar_pagamento_fatura', { p_fatura_id: bill.id });
            if (error) throw error;

            toast.dismiss(loadingToast);
            toast.success("Pagamento desfeito — a fatura voltou a não paga; repasse e comissão foram removidos.");
            queryClient.invalidateQueries({ queryKey: ["rental-bills-all"] });
        } catch (error: any) {
            console.error("Erro ao desfazer pagamento:", error);
            toast.dismiss(loadingToast);
            toast.error("Não foi possível desfazer: " + (error?.message ?? "erro desconhecido"));
        } finally {
            setProcessingId(null);
            setBillToRevert(null);
        }
    };

    // Edita o vencimento de UMA fatura específica e, se ela já estiver emitida,
    // re-sincroniza o boleto no Asaas com a nova data (mesmo link).
    const handleSaveDueDate = async () => {
        if (!billToEditDate || !newDueDate) return;
        setSavingDate(true);
        const loadingToast = toast.loading("Atualizando vencimento...");
        try {
            const faturaId = await ensureFatura(billToEditDate);
            const { error } = await (supabase as any)
                .from('faturas_aluguel')
                .update({ data_vencimento: newDueDate })
                .eq('id', faturaId);
            if (error) throw error;

            // Se já emitida, atualiza o boleto no Asaas (a função lê a nova data).
            let boletoMsg = "";
            if (billToEditDate.externalId) {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    const { data, error: fnErr } = await supabase.functions.invoke('asaas-sync', {
                        body: { action: 'atualizar_cobranca', fatura_id: faturaId },
                        headers: { Authorization: `Bearer ${session.access_token}` },
                    });
                    boletoMsg = (fnErr || data?.error)
                        ? " (não consegui atualizar o boleto no Asaas — tente novamente)"
                        : " e o boleto foi atualizado";
                }
            }

            toast.dismiss(loadingToast);
            toast.success(`Vencimento atualizado${boletoMsg}.`);
            queryClient.invalidateQueries({ queryKey: ["rental-bills-all"] });
        } catch (error: any) {
            console.error("Erro ao editar vencimento:", error);
            toast.dismiss(loadingToast);
            toast.error("Erro ao atualizar vencimento: " + (error?.message ?? "erro"));
        } finally {
            setSavingDate(false);
            setBillToEditDate(null);
        }
    };

    // Emite a cobrança no Asaas (boleto/PIX) via Edge Function asaas-sync.
    const handleEmitCharge = async (bill: any) => {
        setEmittingId(bill.id);
        const loadingToast = toast.loading("Emitindo cobrança no Asaas...");
        try {
            const faturaId = await ensureFatura(bill);
            // Passa o token da sessão explicitamente (o invoke sozinho não anexa o JWT
            // do corretor de forma confiável — mesmo padrão robusto do ai-assistant).
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Sua sessão expirou. Entre novamente para emitir a cobrança.');
            const { data, error } = await supabase.functions.invoke('asaas-sync', {
                body: { action: 'emitir_cobranca', fatura_id: faturaId },
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (error) {
                // Erro HTTP da função traz o corpo em error.context
                let msg = error.message;
                try { msg = (await error.context?.json())?.error ?? msg; } catch { /* ignore */ }
                throw new Error(msg);
            }
            if (data?.error) throw new Error(data.error);

            toast.dismiss(loadingToast);
            toast.success(
                data?.already ? "Cobrança já estava emitida." : "Cobrança emitida! O inquilino já pode pagar por boleto ou PIX.",
                data?.boleto_url ? { action: { label: "Abrir boleto", onClick: () => window.open(data.boleto_url, "_blank") } } : undefined,
            );
            queryClient.invalidateQueries({ queryKey: ["rental-bills-all"] });
        } catch (error: any) {
            console.error("Erro ao emitir cobrança:", error);
            toast.dismiss(loadingToast);
            toast.error("Erro ao emitir cobrança: " + error.message);
        } finally {
            setEmittingId(null);
        }
    };

    const copyPix = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success("PIX copia-e-cola copiado!");
        } catch {
            toast.error("Não foi possível copiar o PIX.");
        }
    };

    const copyBoletoLink = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            toast.success("Link do boleto copiado!");
        } catch {
            toast.error("Não foi possível copiar o link do boleto.");
        }
    };

    // Busca o saldo da conta Asaas (mesmo padrão de sessão explícita da emissão).
    const fetchSaldo = async () => {
        setSaldoLoading(true);
        setSaldoNote(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("no session");
            const { data, error } = await supabase.functions.invoke('asaas-sync', {
                body: { action: 'saldo' },
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (error) {
                let msg = error.message;
                try { msg = (await error.context?.json())?.error ?? msg; } catch { /* ignore */ }
                throw new Error(msg);
            }
            if (data?.error) throw new Error(data.error);
            // Saldo indisponível por falta de permissão na chave → nota amigável, não é erro.
            if (data?.unavailable || data?.balance == null) {
                setSaldoAsaas(null);
                setSaldoNote(data?.message || "Saldo indisponível no momento.");
            } else {
                setSaldoAsaas(Number(data.balance));
            }
        } catch {
            setSaldoAsaas(null);
            setSaldoNote("Não foi possível carregar o saldo agora.");
        } finally {
            setSaldoLoading(false);
        }
    };

    useEffect(() => {
        fetchSaldo();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (isLoading) {
        return (
            <div className="p-8 text-center flex flex-col items-center gap-3 text-muted-foreground animate-pulse">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p>Carregando faturas inteligentes...</p>
            </div>
        );
    }

    return (
        <>
        <div className="space-y-6">
            {/* KPI Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="shadow-sm border-l-4 border-l-yellow-500">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">A Receber</p>
                            <h3 className="text-2xl font-bold text-yellow-600">R$ {totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                        </div>
                        <div className="p-2 bg-yellow-100 rounded-full text-yellow-600">
                            <AlertCircle className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-green-500">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Recebido</p>
                            <h3 className="text-2xl font-bold text-green-600">R$ {totalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                        </div>
                        <div className="p-2 bg-green-100 rounded-full text-green-600">
                            <CheckCircle className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-blue-500">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium text-muted-foreground">Saldo Asaas</p>
                                <button
                                    onClick={fetchSaldo}
                                    disabled={saldoLoading}
                                    aria-label="Atualizar saldo"
                                    className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                >
                                    <RefreshCw className={`h-3 w-3 ${saldoLoading ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                            {saldoLoading ? (
                                <h3 className="text-2xl font-bold text-blue-600 flex items-center h-8">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                </h3>
                            ) : saldoAsaas != null ? (
                                <h3 className="text-2xl font-bold text-blue-600">
                                    R$ {saldoAsaas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </h3>
                            ) : (
                                <button onClick={fetchSaldo} className="text-left" title={saldoNote ?? undefined}>
                                    <span className="text-lg font-semibold text-muted-foreground">Indisponível</span>
                                    {saldoNote && (
                                        <span className="block text-[10px] text-muted-foreground/80 leading-tight max-w-[15rem] mt-0.5">
                                            {saldoNote}
                                        </span>
                                    )}
                                </button>
                            )}
                        </div>
                        <div className="p-2 bg-blue-100 rounded-full text-blue-600">
                            <Landmark className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border shadow-sm bg-card/50">
                <CardHeader className="pb-4 border-b">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Wallet className="h-5 w-5 text-primary" />
                                Gestão de Faturas
                            </CardTitle>
                            <CardDescription>
                                Controle financeiro sincronizado automaticamente com seus contratos ativos.
                            </CardDescription>
                        </div>

                        <div className="flex items-center gap-4">
                            {/* Month Selector */}
                            <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1 border">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground"
                                    onClick={() => setReferenceDate(subMonths(referenceDate, 1))}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <div className="w-32 text-center font-medium text-sm capitalize">
                                    {format(referenceDate, "MMMM 'de' yyyy", { locale: ptBR })}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground"
                                    onClick={() => setReferenceDate(addMonths(referenceDate, 1))}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="relative flex-1 md:w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por fatura, imóvel..."
                                    className="pl-9 h-10"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Tabs defaultValue="ALL" onValueChange={setStatusFilter} className="w-full">
                        <div className="px-4 py-3 bg-muted/20 border-b">
                            <TabsList className="grid w-full grid-cols-4 md:w-[400px]">
                                <TabsTrigger value="ALL">Todas</TabsTrigger>
                                <TabsTrigger value="PENDENTE">Pendentes</TabsTrigger>
                                <TabsTrigger value="PAGO">Pagas</TabsTrigger>
                                <TabsTrigger value="ATRASADO">
                                    Atrasadas{overdueBills.length > 0 ? ` (${overdueBills.length})` : ''}
                                </TabsTrigger>
                            </TabsList>
                        </div>

                        {statusFilter === 'ATRASADO' && filteredBills.length > 0 && (
                            <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 border-b flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5" />
                                Exibindo faturas vencidas de todos os meses, independente do mês selecionado acima.
                            </div>
                        )}

                        <div>
                            {!filteredBills?.length ? (
                                <div className="text-center py-16 text-muted-foreground bg-muted/10">
                                    <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                                    <h3 className="text-lg font-medium text-foreground">
                                        {statusFilter === 'ATRASADO' ? 'Nenhuma fatura atrasada' : 'Nenhuma fatura encontrada'}
                                    </h3>
                                    <p className="text-sm">
                                        {statusFilter === 'ATRASADO'
                                            ? 'Tudo em dia! Nenhum aluguel vencido em aberto, em nenhum mês.'
                                            : 'Tente ajustar os filtros de busca no mês atual.'}
                                    </p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead className="w-[300px]">Imóvel</TableHead>
                                            <TableHead>Envolvidos</TableHead>
                                            <TableHead>Vencimento</TableHead>
                                            <TableHead>Valor Estimado</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Ações</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredBills.map((bill) => (
                                            <TableRow key={bill.id} className="hover:bg-muted/30 transition-colors">
                                                <TableCell>
                                                    <div className="flex items-start gap-3">
                                                        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-100 dark:border-blue-900/50">
                                                            <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-sm text-foreground">
                                                                {bill.contract.imoveis?.titulo}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                                {bill.contract.imoveis?.endereco || "Endereço não informado"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1.5 text-xs">
                                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                                            <ArrowUpRight className="h-3 w-3 text-red-400" />
                                                            <span className="font-medium text-foreground">Prop:</span> {bill.contract.imoveis?.proprietario_nome}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                                            <ArrowDownLeft className="h-3 w-3 text-green-500" />
                                                            <span className="font-medium text-foreground">Inq:</span> {bill.contract.clientes?.nome}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 text-sm text-foreground/80">
                                                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                                                        {format(bill.dueDate, "dd/MM/yyyy", { locale: ptBR })}
                                                        {bill.isVirtual && (
                                                            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground ml-1" title="Fatura estimativa, ainda não efetivada no banco">
                                                                A Gerar
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-semibold text-foreground">
                                                        R$ {bill.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={getBadgeStyle(bill.status)}>
                                                        {getStatusLabel(bill.status)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end items-center gap-1.5">
                                                        {/* Ação primária: baixar (pendente) ou selo Pago */}
                                                        {(bill.status === 'PENDENTE' || bill.status === 'ATRASADO') ? (
                                                            <Button
                                                                size="sm"
                                                                variant="default"
                                                                className="h-8 bg-green-600 hover:bg-green-700 text-white shadow-sm"
                                                                onClick={() => setBillToConfirmPayment(bill)}
                                                                disabled={processingId === bill.id}
                                                                title="Confirmar Pagamento (Baixar Fatura)"
                                                            >
                                                                <CheckCircle className="h-4 w-4 sm:mr-1.5" />
                                                                <span className="hidden sm:inline">Baixar</span>
                                                            </Button>
                                                        ) : bill.status === 'PAGO' ? (
                                                            <span className="flex items-center text-green-600 text-xs px-1.5 whitespace-nowrap">
                                                                <CheckCircle className="h-3.5 w-3.5 mr-1" /> Pago
                                                            </span>
                                                        ) : null}

                                                        {/* Demais ações agrupadas num menu (nada fica cortado / sem rolagem lateral) */}
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 rounded-full"
                                                                    title="Mais ações"
                                                                    disabled={processingId === bill.id || emittingId === bill.id || loadingContractId === bill.id}
                                                                >
                                                                    {(processingId === bill.id || emittingId === bill.id || loadingContractId === bill.id) ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                    ) : (
                                                                        <MoreHorizontal className="h-4 w-4" />
                                                                    )}
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-52">
                                                                <DropdownMenuItem onClick={() => handleOpenContractViewer(bill)}>
                                                                    <Eye className="h-4 w-4 mr-2 text-blue-600" /> Ver contrato
                                                                </DropdownMenuItem>

                                                                {(bill.status === 'PENDENTE' || bill.status === 'ATRASADO') && (
                                                                    <DropdownMenuItem onClick={() => { setBillToEditDate(bill); setNewDueDate(format(bill.dueDate, 'yyyy-MM-dd')); }}>
                                                                        <CalendarClock className="h-4 w-4 mr-2 text-indigo-600" /> Editar vencimento
                                                                    </DropdownMenuItem>
                                                                )}

                                                                {(bill.status === 'PENDENTE' || bill.status === 'ATRASADO') && !bill.externalId && (
                                                                    <DropdownMenuItem onClick={() => handleEmitCharge(bill)}>
                                                                        <ArrowUpRight className="h-4 w-4 mr-2 text-blue-700" /> Emitir cobrança
                                                                    </DropdownMenuItem>
                                                                )}

                                                                {bill.boletoUrl && (
                                                                    <>
                                                                        <DropdownMenuItem onClick={() => window.open(bill.boletoUrl!, '_blank', 'noopener')}>
                                                                            <FileText className="h-4 w-4 mr-2 text-blue-600" /> Abrir boleto
                                                                        </DropdownMenuItem>
                                                                        <DropdownMenuItem onClick={() => copyBoletoLink(bill.boletoUrl!)}>
                                                                            <Link2 className="h-4 w-4 mr-2 text-violet-600" /> Copiar link do boleto
                                                                        </DropdownMenuItem>
                                                                    </>
                                                                )}

                                                                {bill.pixText && (
                                                                    <DropdownMenuItem onClick={() => copyPix(bill.pixText)}>
                                                                        <Wallet className="h-4 w-4 mr-2 text-emerald-600" /> Copiar PIX
                                                                    </DropdownMenuItem>
                                                                )}

                                                                {bill.status === 'PAGO' && (
                                                                    <DropdownMenuItem onClick={() => setBillToRevert(bill)} className="text-amber-600 focus:text-amber-700">
                                                                        <RotateCcw className="h-4 w-4 mr-2" /> Desfazer pagamento
                                                                    </DropdownMenuItem>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    </Tabs>
                </CardContent>
            </Card>
        </div>

        {/* Confirmar baixa (recebimento) — evita clique acidental */}
        <AlertDialog open={!!billToConfirmPayment} onOpenChange={(o) => { if (!o) setBillToConfirmPayment(null); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Confirmar recebimento?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {billToConfirmPayment && (
                            <>
                                Você vai dar baixa na fatura de <strong>{billToConfirmPayment.contract?.imoveis?.titulo || billToConfirmPayment.contract?.titulo || 'imóvel'}</strong>
                                {' '}({billToConfirmPayment.mesReferencia}). Isso marca como <strong>paga</strong> e gera o repasse ao proprietário e a comissão. Confirme só se o inquilino realmente pagou.
                            </>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => billToConfirmPayment && doConfirmPayment(billToConfirmPayment)}
                    >
                        Confirmar recebimento
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        {/* Desfazer pagamento (estorno) */}
        <AlertDialog open={!!billToRevert} onOpenChange={(o) => { if (!o) setBillToRevert(null); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Desfazer o pagamento?</AlertDialogTitle>
                    <AlertDialogDescription>
                        A fatura volta a ficar <strong>não paga</strong> e o <strong>repasse ao proprietário</strong> e a <strong>comissão</strong> gerados por esta baixa serão removidos. Use quando marcou como paga por engano.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-amber-600 hover:bg-amber-700"
                        onClick={() => billToRevert && handleRevertPayment(billToRevert)}
                    >
                        Desfazer pagamento
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        {/* Editar vencimento de uma fatura específica */}
        <Dialog open={!!billToEditDate} onOpenChange={(o) => { if (!o) setBillToEditDate(null); }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Editar vencimento</DialogTitle>
                    <DialogDescription>
                        Escolha a nova data de vencimento desta fatura{billToEditDate?.externalId ? ' — o boleto no Asaas será atualizado com a mesma data.' : '.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-2">
                    <Input
                        type="date"
                        value={newDueDate}
                        min={format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => setNewDueDate(e.target.value)}
                    />
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setBillToEditDate(null)}>Cancelar</Button>
                    <Button onClick={handleSaveDueDate} disabled={savingDate || !newDueDate}>
                        {savingDate && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Contract Viewer Modal (Centered) */}
        {contractViewerDetails && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setContractViewerDetails(null); setContractViewerUrl(null); }}>
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
                {/* Modal */}
                <div
                    className="relative w-full max-w-3xl max-h-[90vh] bg-background shadow-2xl rounded-2xl border animate-in zoom-in-95 fade-in duration-200 flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-5 border-b bg-muted/30">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">{contractViewerTitle}</h3>
                                <p className="text-xs text-muted-foreground">Detalhes do contrato de locação</p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-full hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => { setContractViewerDetails(null); setContractViewerUrl(null); }}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Contract Info Cards */}
                    <div className="p-5 space-y-4 overflow-y-auto flex-1">
                        {/* Partes envolvidas */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 rounded-lg bg-muted/30 border">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Proprietário</p>
                                <p className="text-sm font-medium">{contractViewerDetails.proprietario}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30 border">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Inquilino</p>
                                <p className="text-sm font-medium">{contractViewerDetails.inquilino}</p>
                            </div>
                        </div>

                        {/* Endereço */}
                        <div className="p-3 rounded-lg bg-muted/30 border">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Endereço do Imóvel</p>
                            <p className="text-sm">{contractViewerDetails.endereco}</p>
                        </div>

                        {/* Financeiro */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30">
                                <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold mb-1">Aluguel</p>
                                <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                                    R$ {contractViewerDetails.valor?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30">
                                <p className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold mb-1">Taxa Adm</p>
                                <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                                    {contractViewerDetails.taxaAdm}%
                                </p>
                            </div>
                            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-900/30">
                                <p className="text-[10px] uppercase tracking-wider text-green-600 dark:text-green-400 font-semibold mb-1">Líquido</p>
                                <p className="text-lg font-bold text-green-700 dark:text-green-300">
                                    R$ {(contractViewerDetails.valor - (contractViewerDetails.valor * contractViewerDetails.taxaAdm / 100)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                        </div>

                        {/* Datas e detalhes */}
                        <div className="grid grid-cols-4 gap-3">
                            <div className="p-3 rounded-lg bg-muted/30 border">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Vencimento</p>
                                <p className="text-sm font-medium">Dia {contractViewerDetails.diaVencimento}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30 border">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Repasse</p>
                                <p className="text-sm font-medium">Dia {contractViewerDetails.diaRepasse}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30 border">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Início</p>
                                <p className="text-sm font-medium">
                                    {contractViewerDetails.dataInicio
                                        ? format(new Date(contractViewerDetails.dataInicio), "dd/MM/yyyy", { locale: ptBR })
                                        : '—'}
                                </p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/30 border">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Fim</p>
                                <p className="text-sm font-medium">
                                    {contractViewerDetails.dataFim
                                        ? format(new Date(contractViewerDetails.dataFim), "dd/MM/yyyy", { locale: ptBR })
                                        : contractViewerDetails.mesesDuracao
                                            ? `${contractViewerDetails.mesesDuracao} meses`
                                            : '—'}
                                </p>
                            </div>
                        </div>

                        {/* Multas e Juros */}
                        {(contractViewerDetails.multaAtraso || contractViewerDetails.jurosMora) && (
                            <div className="grid grid-cols-2 gap-3">
                                {contractViewerDetails.multaAtraso != null && (
                                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30">
                                        <p className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400 font-semibold mb-1">Multa Atraso</p>
                                        <p className="text-sm font-bold text-red-700 dark:text-red-300">{contractViewerDetails.multaAtraso}%</p>
                                    </div>
                                )}
                                {contractViewerDetails.jurosMora != null && (
                                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30">
                                        <p className="text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400 font-semibold mb-1">Juros Mora (diário)</p>
                                        <p className="text-sm font-bold text-red-700 dark:text-red-300">{contractViewerDetails.jurosMora}%</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Observações */}
                        {contractViewerDetails.obs && (
                            <div className="p-3 rounded-lg bg-muted/30 border">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Observações</p>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{contractViewerDetails.obs}</p>
                            </div>
                        )}

                        {/* Status Badge */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Status do contrato:</span>
                            <Badge
                                variant="outline"
                                className={`
                                    ${contractViewerDetails.status === 'ATIVO' ? 'border-green-500 text-green-600 bg-green-50 dark:bg-green-900/20' : ''}
                                    ${contractViewerDetails.status === 'ENCERRADO' ? 'border-slate-500 text-slate-600 bg-slate-50 dark:bg-slate-900/20' : ''}
                                    ${contractViewerDetails.status === 'CANCELADO' ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-900/20' : ''}
                                `}
                            >
                                {contractViewerDetails.status}
                            </Badge>
                        </div>

                        {/* PDF Viewer */}
                        {contractViewerUrl ? (
                            <div className="rounded-lg overflow-hidden border bg-white dark:bg-slate-900">
                                <div className="flex items-center justify-between p-2 bg-muted/50 border-b">
                                    <span className="text-xs font-medium text-muted-foreground">📄 Documento do Contrato</span>
                                    <a
                                        href={contractViewerUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                                            Abrir em nova aba
                                        </Button>
                                    </a>
                                </div>
                                <iframe
                                    src={contractViewerUrl}
                                    className="w-full border-0"
                                    style={{ height: '500px' }}
                                    title="Contrato PDF"
                                />
                            </div>
                        ) : (
                            <div className="p-8 text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed flex flex-col items-center justify-center">
                                <FileText className="h-12 w-12 mb-3 opacity-30 text-blue-600" />
                                <h4 className="text-sm font-semibold text-foreground mb-1">Nenhum arquivo de contrato anexado</h4>
                                <p className="text-xs mb-5 max-w-sm text-balance">
                                    Você pode fazer o upload do PDF do contrato assinado agora mesmo para tê-lo sempre à mão na hora de conferir as faturas.
                                </p>

                                <input
                                    type="file"
                                    accept=".pdf"
                                    className="hidden"
                                    ref={contractFileInputRef}
                                    onChange={handleContractUpload}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2 h-9 border-blue-200 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-700 dark:text-blue-400"
                                    onClick={() => contractFileInputRef.current?.click()}
                                    disabled={isUploadingContract || isExtracting}
                                >
                                    {isUploadingContract || isExtracting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <UploadCloud className="h-4 w-4" />
                                    )}
                                    {isUploadingContract
                                        ? "Enviando arquivo..."
                                        : isExtracting
                                            ? "Lendo o contrato com IA..."
                                            : "Anexar PDF do Contrato"}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Confirmação do que a IA leu no contrato. Nada é gravado sem o corretor conferir. */}
        <Dialog open={!!extraido} onOpenChange={(open) => !open && setExtraido(null)}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>Dados lidos do contrato</DialogTitle>
                    <DialogDescription>
                        A IA leu o PDF e encontrou os dados abaixo. Confira antes de salvar — o CPF
                        é o que o Asaas usa para emitir a cobrança.
                    </DialogDescription>
                </DialogHeader>

                {extraido && (() => {
                    const inq = extraido.inquilino;
                    const cpfOk = inq.cpf ? cpfValido(inq.cpf) : false;
                    return (
                        <div className="space-y-3">
                            <div className="rounded-lg border p-3 space-y-2 text-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <span className="text-muted-foreground">Inquilino</span>
                                    <span className="font-medium text-right">{inq.nome || '—'}</span>
                                </div>
                                <div className="flex items-start justify-between gap-3">
                                    <span className="text-muted-foreground">CPF</span>
                                    <span className={cpfOk ? 'font-semibold text-right' : 'font-semibold text-right text-destructive'}>
                                        {inq.cpf ? formatCpf(inq.cpf) : '—'}
                                    </span>
                                </div>
                                {inq.telefone && (
                                    <div className="flex items-start justify-between gap-3">
                                        <span className="text-muted-foreground">Telefone</span>
                                        <span className="text-right">{inq.telefone}</span>
                                    </div>
                                )}
                                {inq.email && (
                                    <div className="flex items-start justify-between gap-3">
                                        <span className="text-muted-foreground">E-mail</span>
                                        <span className="text-right break-all">{inq.email}</span>
                                    </div>
                                )}
                            </div>

                            {!cpfOk && (
                                <p className="text-xs text-destructive">
                                    Este CPF não passou na validação dos dígitos verificadores — a IA pode ter
                                    lido um número errado. Corrija no cadastro do cliente manualmente.
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Telefone e e-mail só serão preenchidos se estiverem vazios no cadastro.
                                Seu cadastro atual nunca é sobrescrito.
                            </p>
                        </div>
                    );
                })()}

                <DialogFooter>
                    <Button variant="outline" onClick={() => setExtraido(null)} disabled={savingCpf}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleConfirmCpf}
                        disabled={savingCpf || !extraido?.inquilino?.cpf || !cpfValido(extraido.inquilino.cpf)}
                    >
                        {savingCpf ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
                        ) : (
                            <><CheckCircle className="h-4 w-4 mr-2" /> Confirmar e salvar CPF</>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
}

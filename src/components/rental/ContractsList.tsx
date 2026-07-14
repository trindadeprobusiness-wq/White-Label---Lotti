import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, User as UserIcon, Building2, FileText, CalendarDays, ArrowUpRight, ArrowDownLeft, MoreHorizontal, Search, DollarSign, PowerOff, Plus, PenLine, Sparkles, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { NewContractDialog } from "./NewContractDialog";
import { AutoContractDialog } from "./AutoContractDialog";
import { parseContratoContent } from "@/types/rental";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ContractsList() {
    const queryClient = useQueryClient(); // Ensure this hook is used or imported if checking logic
    const [isCalcOpen, setIsCalcOpen] = useState(false);
    const [isNewContractOpen, setIsNewContractOpen] = useState(false);
    const [isAutoContractOpen, setIsAutoContractOpen] = useState(false);
    const [selectedContract, setSelectedContract] = useState<any>(null);
    const [contractToTerminate, setContractToTerminate] = useState<any>(null);
    const [contractToFinish, setContractToFinish] = useState<any>(null);
    const [simulatedRent, setSimulatedRent] = useState<number>(0);
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("ALL");

    const handleDeleteContract = async () => {
        if (!contractToTerminate) return;
        try {
            const { error } = await supabase
                .from('contratos')
                .delete()
                .eq('id', contractToTerminate.id);

            if (error) throw error;

            toast.success("Contrato excluído com sucesso.");
            setContractToTerminate(null);

            window.location.reload();
        } catch (error: any) {
            console.error("Erro ao excluir:", error);
            toast.error("Erro ao excluir contrato: " + error.message);
        }
    };

    const handleFinishContract = async () => {
        if (!contractToFinish) return;
        try {
            const { error } = await supabase
                .from('contratos')
                .update({ status: 'ENCERRADO' })
                .eq('id', contractToFinish.id);

            if (error) throw error;

            toast.success("Contrato encerrado com sucesso.");
            setContractToFinish(null);

            window.location.reload();
        } catch (error: any) {
            console.error("Erro ao encerrar contrato:", error);
            toast.error("Erro ao encerrar contrato: " + error.message);
        }
    };

    const { data: contracts, isLoading } = useQuery({
        queryKey: ["rental-contracts"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("contratos")
                .select(`
                    *,
                    clientes ( nome, telefone ),
                    imoveis ( titulo, endereco, proprietario_nome )
                `)
                .eq("tipo", "LOCACAO_RESIDENCIAL")
                .order("created_at", { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const filteredContracts = contracts?.filter(contract => {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch =
            contract.imoveis?.titulo?.toLowerCase().includes(searchLower) ||
            contract.imoveis?.proprietario_nome?.toLowerCase().includes(searchLower) ||
            contract.clientes?.nome?.toLowerCase().includes(searchLower);

        const matchesStatus = statusFilter === "ALL" ? true : contract.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    // Stats
    const totalActive = filteredContracts?.filter(c => c.status === 'ATIVO').length || 0;
    const totalRent = filteredContracts?.filter(c => c.status === 'ATIVO').reduce((acc, curr) => acc + (curr.valor || 0), 0) || 0;

    const handleOpenCalculator = (contract: any) => {
        setSelectedContract(contract);
        setSimulatedRent(contract.valor);
        setIsCalcOpen(true);
    };

    const handleViewContract = async (path: string) => {
        try {
            const { data, error } = await supabase.storage
                .from('documentos')
                .createSignedUrl(path, 60 * 60);

            if (error) throw error;
            if (data?.signedUrl) {
                window.open(data.signedUrl, '_blank');
            }
        } catch (error: any) {
            console.error('Erro ao abrir contrato:', error);
            alert('Erro ao abrir contrato: ' + error.message);
        }
    };

    const calculateBreakdown = () => {
        if (!selectedContract) return { fee: 0, net: 0, feePct: 0 };
        const content = parseContratoContent(selectedContract.conteudo);
        const feePct = content.taxa_administracao || selectedContract.taxa_administracao_percentual || 10;
        const fee = simulatedRent * (feePct / 100);
        const net = simulatedRent - fee;
        return { fee, net, feePct };
    };

    const { fee, net, feePct } = calculateBreakdown();

    if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando carteira de contratos...</div>;

    return (
        <>
            <Card className="border shadow-sm bg-card/50">
                <CardHeader className="pb-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" />
                                Carteira de Contratos
                            </CardTitle>
                            <CardDescription>
                                Gestão centralizada dos contratos de locação residencial
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <div className="relative flex-1 sm:w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por imóvel, proprietário..."
                                    className="pl-9 h-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button size="sm" className="h-9 shadow-sm">
                                        <Plus className="mr-2 h-4 w-4" /> Novo Contrato <ChevronDown className="ml-2 h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64">
                                    <DropdownMenuItem onClick={() => setIsNewContractOpen(true)} className="cursor-pointer">
                                        <PenLine className="mr-2 h-4 w-4" />
                                        <div className="flex flex-col">
                                            <span className="font-medium">Adicionar Manualmente</span>
                                            <span className="text-xs text-muted-foreground">Preencha os dados do contrato</span>
                                        </div>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setIsAutoContractOpen(true)} className="cursor-pointer">
                                        <Sparkles className="mr-2 h-4 w-4 text-primary" />
                                        <div className="flex flex-col">
                                            <span className="font-medium">Automático com IA</span>
                                            <span className="text-xs text-muted-foreground">Envie o contrato e a IA cria tudo</span>
                                        </div>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {!filteredContracts?.length ? (
                        <div className="text-center py-12 text-muted-foreground bg-muted/20 border-t">
                            <FileText className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                            <h3 className="text-lg font-medium text-foreground">Nenhum contrato encontrado</h3>
                            <p className="text-sm">Cadastre um novo contrato para começar a gerenciar.</p>
                        </div>
                    ) : (
                        <div className="rounded-md border-t overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-[300px]">Imóvel</TableHead>
                                        <TableHead>Envolvidos</TableHead>
                                        <TableHead className="text-right">Financeiro</TableHead>
                                        <TableHead className="text-center">Repasse</TableHead>
                                        <TableHead className="text-center">Vigência</TableHead>
                                        <TableHead className="text-center">Status</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredContracts.map((contract: any) => {
                                        const content = parseContratoContent(contract.conteudo);
                                        const contractFeePct = content.taxa_administracao || contract.taxa_administracao_percentual || 10;
                                        const currentFee = contract.valor * (contractFeePct / 100);
                                        const currentNet = contract.valor - currentFee;
                                        const startDate = new Date(contract.data_inicio);

                                        return (
                                            <TableRow key={contract.id} className="group hover:bg-muted/30 transition-colors">
                                                <TableCell>
                                                    <div className="flex items-start gap-3">
                                                        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-100 dark:border-blue-900/50">
                                                            <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-sm text-foreground">
                                                                {contract.imoveis?.titulo}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                                {contract.imoveis?.endereco || "Endereço não informado"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1.5 text-xs">
                                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                                            <ArrowUpRight className="h-3 w-3 text-red-400" />
                                                            <span className="font-medium text-foreground">Prop:</span> {contract.imoveis?.proprietario_nome}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                                            <ArrowDownLeft className="h-3 w-3 text-green-500" />
                                                            <span className="font-medium text-foreground">Inq:</span> {contract.clientes?.nome}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex flex-col items-end gap-0.5">
                                                        <div className="font-semibold text-sm">
                                                            R$ {contract.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                        </div>
                                                        <div className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                                            Taxa: {contractFeePct}% (- R$ {currentFee.toLocaleString("pt-BR", { minimumFractionDigits: 0 })})
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                        <div className="font-medium text-green-600 dark:text-green-400 text-sm">
                                                            R$ {currentNet.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground flex items-center">
                                                            Dia {content.dia_repasse || contract.dia_vencimento + 5}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground">
                                                        <div className="flex items-center gap-1">
                                                            <CalendarDays className="h-3 w-3" />
                                                            {format(startDate, "dd/MM/yyyy", { locale: ptBR })}
                                                        </div>
                                                        <div className="opacity-75" title={`Fim: ${content.data_fim_calculada ? format(new Date(content.data_fim_calculada), "dd/MM/yyyy", { locale: ptBR }) : 'Não informado'}`}>
                                                            Vence dia {contract.dia_vencimento}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <div className="flex flex-col gap-1 items-center">
                                                        <Badge
                                                            variant="outline"
                                                            className={`
                                                                ${contract.status === 'ATIVO' ? 'border-green-500 text-green-600 bg-green-50 dark:bg-green-900/20' : ''}
                                                                ${contract.status === 'PENDENTE' ? 'border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-900/20' : ''}
                                                                ${contract.status === 'CANCELADO' ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-900/20' : ''}
                                                                ${contract.status === 'ENCERRADO' ? 'border-slate-500 text-slate-600 bg-slate-50 dark:bg-slate-900/20' : ''}
                                                            `}
                                                        >
                                                            {contract.status}
                                                        </Badge>
                                                        {/* Asaas Badge - Checks if content has Asaas metadata or simply mocks it if user tagged it */}
                                                        {(content.asaas_integrated) && (
                                                            <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200 text-[10px] h-5 whitespace-nowrap px-2">
                                                                Asaas (Manual)
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuLabel>Ações</DropdownMenuLabel>
                                                            <DropdownMenuItem onClick={() => handleOpenCalculator(contract)}>
                                                                <Calculator className="mr-2 h-4 w-4" /> Simular Repasse
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => {
                                                                setSelectedContract(contract);
                                                                setIsNewContractOpen(true);
                                                            }}>
                                                                <MoreHorizontal className="mr-2 h-4 w-4" /> Editar Contrato
                                                            </DropdownMenuItem>

                                                            <DropdownMenuItem onClick={async () => {
                                                                try {
                                                                    const currentIntegrated = !!content.asaas_integrated;
                                                                    const newIntegrated = !currentIntegrated;

                                                                    // Clean up legacy string if exists to avoid confusion, but main logic is the boolean
                                                                    const newObs = (content.obs || '').replace(/\[?Asaas\]?/gi, '').trim();

                                                                    const newContent = {
                                                                        ...content,
                                                                        obs: newObs,
                                                                        asaas_integrated: newIntegrated
                                                                    };

                                                                    const { error } = await supabase
                                                                        .from('contratos')
                                                                        .update({ conteudo: JSON.stringify(newContent) })
                                                                        .eq('id', contract.id);

                                                                    if (error) throw error;

                                                                    // Optimistic update or refetch would be better, but for now relying on query invalidation if setup
                                                                    window.location.reload(); // Quick refresh to show change
                                                                } catch (err) {
                                                                    console.error('Erro ao alternar Asaas:', err);
                                                                    alert('Erro ao atualizar status Asaas');
                                                                }
                                                            }}>
                                                                <div className="flex items-center w-full">
                                                                    <DollarSign className="mr-2 h-4 w-4 text-secondary-foreground" />
                                                                    {content.asaas_integrated ? 'Desmarcar Asaas' : 'Marcar como Asaas'}
                                                                </div>
                                                            </DropdownMenuItem>
                                                            {contract.arquivo_url && (
                                                                <DropdownMenuItem onClick={() => handleViewContract(contract.arquivo_url)}>
                                                                    <FileText className="mr-2 h-4 w-4" /> Ver Contrato
                                                                </DropdownMenuItem>
                                                            )}
                                                            <DropdownMenuItem onClick={() => setContractToFinish(contract)}>
                                                                <PowerOff className="mr-2 h-4 w-4" /> Encerrar Contrato
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                                                onClick={() => setContractToTerminate(contract)}
                                                            >
                                                                Excluir Contrato
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                            <div className="bg-muted/30 p-4 border-t flex justify-between items-center text-sm">
                                <span className="text-muted-foreground">
                                    Total de <strong>{totalActive}</strong> contratos ativos
                                </span>
                                <div className="flex gap-6">
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground">Volume de Aluguéis:</span>
                                        <span className="font-semibold text-foreground">R$ {totalRent.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <NewContractDialog
                open={isNewContractOpen}
                onOpenChange={(open) => {
                    setIsNewContractOpen(open);
                    if (!open) setSelectedContract(null);
                }}
                contractToEdit={selectedContract}
            />

            <AutoContractDialog
                open={isAutoContractOpen}
                onOpenChange={setIsAutoContractOpen}
            />

            <Dialog open={isCalcOpen} onOpenChange={setIsCalcOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Simulador Financeiro</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-6 py-4">
                        <div className="p-4 bg-muted/50 rounded-lg flex items-center gap-4">
                            <div className="p-2 bg-background rounded-full border shadow-sm">
                                <Building2 className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-sm">{selectedContract?.imoveis?.titulo}</h4>
                                <p className="text-xs text-muted-foreground">{selectedContract?.imoveis?.endereco}</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Valor Base do Aluguel</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-muted-foreground">R$</span>
                                    <Input
                                        type="number"
                                        className="pl-9"
                                        value={simulatedRent}
                                        onChange={(e) => setSimulatedRent(Number(e.target.value))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 rounded-lg border bg-blue-50/50 dark:bg-blue-900/10 space-y-1">
                                    <div className="text-xs text-muted-foreground font-medium">Taxa ({feePct}%)</div>
                                    <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                                        R$ {fee.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                                <div className="p-4 rounded-lg border bg-green-50/50 dark:bg-green-900/10 space-y-1">
                                    <div className="text-xs text-muted-foreground font-medium">Líquido Proprietário</div>
                                    <div className="text-lg font-bold text-green-600 dark:text-green-400">
                                        R$ {net.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!contractToTerminate} onOpenChange={(open) => !open && setContractToTerminate(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir Contrato?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação <strong>excluirá permanentemente</strong> o contrato e todo o seu histórico.
                            Essa ação não pode ser desfeita.
                            <br /><br />
                            Contrato: <strong>{contractToTerminate?.imoveis?.titulo}</strong>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteContract}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                            Excluir Definitivamente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Dialog for Ending Contract */}
            <AlertDialog open={!!contractToFinish} onOpenChange={(open) => !open && setContractToFinish(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Encerrar Contrato?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação mudará o status do contrato para <strong>ENCERRADO</strong>, permitindo que você associe este imóvel a um novo inquilino. O histórico e faturas do contrato atual serão mantidos como registro.
                            <br /><br />
                            Contrato: <strong>{contractToFinish?.imoveis?.titulo}</strong>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleFinishContract}
                            className="bg-primary hover:bg-primary/90 focus:ring-primary"
                        >
                            Confirmar Encerramento
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

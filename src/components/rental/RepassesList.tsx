import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft, Loader2, CalendarDays, Search, AlertCircle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RepassesList() {
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("ALL");

    const { data: payouts, isLoading } = useQuery({
        queryKey: ["rental-payouts"],
        queryFn: async () => {
            // Fetch repasses with contract info
            const { data, error } = await (supabase as any)
                .from("repasses_proprietario")
                .select(`
                    *,
                    contratos (
                        imoveis ( titulo )
                    )
                `)
                .order("data_prevista", { ascending: true });

            if (error) throw error;
            return data;
        },
    });

    const queryClient = useQueryClient();

    const handleConfirmPayout = async (payoutId: string, value: number) => {
        if (!confirm("Confirmar que a transferência via PIX foi realizada para o proprietário?")) return;

        try {
            const { error } = await (supabase as any)
                .from("repasses_proprietario")
                .update({
                    status: 'CONFIRMADO',
                    // data_transferencia: new Date().toISOString() // Uncomment if column exists
                })
                .eq('id', payoutId);

            if (error) throw error;

            toast.success("Repasse confirmado e registrado com sucesso!");
            queryClient.invalidateQueries({ queryKey: ["rental-payouts"] });
        } catch (error: any) {
            console.error("Erro ao confirmar repasse:", error);
            toast.error("Erro ao confirmar repasse: " + error.message);
        }
    };

    const filteredPayouts = payouts?.filter(payout => {
        const matchesSearch =
            payout.proprietario_nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            payout.contratos?.imoveis?.titulo?.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus = statusFilter === "ALL" ? true : payout.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    // Stats
    const totalScheduled = payouts?.filter(p => p.status === "AGENDADO").reduce((acc, curr) => acc + curr.valor_liquido_repasse, 0) || 0;
    const totalConfirmed = payouts?.filter(p => p.status === "CONFIRMADO").reduce((acc, curr) => acc + curr.valor_liquido_repasse, 0) || 0;

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'CONFIRMADO': return "bg-green-100 text-green-800 border-green-200";
            case 'ENVIADO': return "bg-blue-100 text-blue-800 border-blue-200";
            case 'AGENDADO': return "bg-yellow-100 text-yellow-800 border-yellow-200";
            case 'ERRO': return "bg-red-100 text-red-800 border-red-200";
            default: return "bg-gray-100 text-gray-800 border-gray-200";
        }
    };

    if (isLoading) {
        return (
            <div className="p-8 text-center flex flex-col items-center gap-3 text-muted-foreground animate-pulse">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p>Carregando repasses inteligentes...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* KPI Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="shadow-sm border-l-4 border-l-yellow-500">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Agendado (Líquido)</p>
                            <h3 className="text-2xl font-bold text-yellow-600">R$ {totalScheduled.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                        </div>
                        <div className="p-2 bg-yellow-100 rounded-full text-yellow-600">
                            <CalendarDays className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-green-500">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Confirmado (Mês)</p>
                            <h3 className="text-2xl font-bold text-green-600">R$ {totalConfirmed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
                        </div>
                        <div className="p-2 bg-green-100 rounded-full text-green-600">
                            <CheckCircle2 className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border shadow-sm bg-card/50">
                <CardHeader className="pb-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <ArrowRightLeft className="h-5 w-5 text-primary" />
                                Repasses aos Proprietários
                            </CardTitle>
                            <CardDescription>
                                Gestão automatizada de transferências
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 w-full md:w-auto">
                            <div className="relative flex-1 md:w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar proprietário..."
                                    className="pl-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Tabs defaultValue="ALL" onValueChange={setStatusFilter} className="w-full">
                        <div className="px-4 pb-4">
                            <TabsList className="grid w-full grid-cols-4 md:w-[450px]">
                                <TabsTrigger value="ALL">Todos</TabsTrigger>
                                <TabsTrigger value="AGENDADO">Agendados</TabsTrigger>
                                <TabsTrigger value="ENVIADO">Enviados</TabsTrigger>
                                <TabsTrigger value="CONFIRMADO">Confirmados</TabsTrigger>
                            </TabsList>
                        </div>

                        <div className="border-t">
                            {!filteredPayouts?.length ? (
                                <div className="text-center py-16 text-muted-foreground bg-muted/20">
                                    <ArrowRightLeft className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                                    <h3 className="text-lg font-medium text-foreground">Nenhum repasse encontrado</h3>
                                    <p className="text-sm">Os repasses gerados aparecerão aqui.</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader className="bg-muted/50">
                                        <TableRow>
                                            <TableHead>Data Prevista</TableHead>
                                            <TableHead>Proprietário / Imóvel</TableHead>
                                            <TableHead>Valor Bruto</TableHead>
                                            <TableHead>Taxa Adm</TableHead>
                                            <TableHead>Valor Líquido</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Ação</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredPayouts.map((payout: any) => (
                                            <TableRow key={payout.id} className="hover:bg-muted/30 transition-colors">
                                                <TableCell>
                                                    <div className="flex items-center gap-2 font-medium">
                                                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                                                        {format(new Date(payout.data_prevista), "dd/MM/yyyy", { locale: ptBR })}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium text-foreground">{payout.proprietario_nome}</span>
                                                        <span className="text-xs text-muted-foreground">{payout.contratos?.imoveis?.titulo}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    R$ {payout.valor_bruto_recebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </TableCell>
                                                <TableCell className="text-red-500 text-xs">
                                                    - R$ {payout.valor_taxa_adm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-bold text-green-600">
                                                        R$ {payout.valor_liquido_repasse.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={getStatusStyle(payout.status)}>
                                                        {payout.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {payout.status === 'AGENDADO' || payout.status === 'ERRO' ? (
                                                        <Button
                                                            size="sm"
                                                            className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                                                            onClick={() => handleConfirmPayout(payout.id, payout.valor_liquido_repasse)}
                                                        >
                                                            Confirmar Envio
                                                        </Button>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">-</span>
                                                    )}
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
    );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { apiDisponivel } from "@/lib/api";
import { resumoLocacaoApi } from "@/lib/api/financeiro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Users, Wallet } from "lucide-react";
import { Dinheiro } from "@/components/ui/dinheiro";

export function DashboardKPICards() {
    const queryClient = useQueryClient();
    const { data: stats, isLoading } = useQuery({
        queryKey: ["rental-kpis"],
        queryFn: async () => {
            if (apiDisponivel()) {
                // Mesma chave dos gráficos: os dois abrem juntos e o resumo vem numa ida só.
                const resumo = await queryClient.fetchQuery({ queryKey: ["rental-resumo"], queryFn: resumoLocacaoApi, staleTime: 30_000 });
                const totalReceivable = resumo.soma_valor || 0;
                return {
                    totalReceivable,
                    totalTransferred: totalReceivable * 0.90,
                    activeContracts: resumo.contratos_ativos || 0,
                    estimatedCommission: totalReceivable * 0.10
                };
            }

            // Get active contracts and calculate estimates
            const { data: contracts, count: activeContracts } = await supabase
                .from("contratos")
                .select("valor", { count: 'exact' })
                .eq("status", "ATIVO");

            // Calculate estimates based on active contracts
            const totalReceivable = contracts?.reduce((acc, curr) => acc + (curr.valor || 0), 0) || 0;
            const estimatedCommission = totalReceivable * 0.10; // Default 10%
            const estimatedTransfer = totalReceivable * 0.90;

            return {
                totalReceivable,
                totalTransferred: estimatedTransfer,
                activeContracts: activeContracts || 0,
                estimatedCommission
            };
        }
    });

    if (isLoading) return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-pulse">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted rounded-xl"></div>)}
    </div>;

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total a Receber</CardTitle>
                    <ArrowUpRight className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        <Dinheiro valor={stats?.totalReceivable} />
                    </div>
                    <p className="text-xs text-muted-foreground">Estimado (contratos ativos)</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Repasses Estimados</CardTitle>
                    <ArrowDownRight className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        <Dinheiro valor={stats?.totalTransferred} />
                    </div>
                    <p className="text-xs text-muted-foreground">Valor líquido aos proprietários</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Contratos Ativos</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{stats?.activeContracts}</div>
                    <p className="text-xs text-muted-foreground">Imóveis alugados</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Comissão (Est.)</CardTitle>
                    <Wallet className="h-4 w-4 text-purple-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        <Dinheiro valor={stats?.estimatedCommission} />
                    </div>
                    <p className="text-xs text-muted-foreground">Sua receita prevista</p>
                </CardContent>
            </Card>
        </div>
    );
}

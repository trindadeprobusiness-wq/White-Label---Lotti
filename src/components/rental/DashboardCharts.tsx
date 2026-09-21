import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { VALOR_MASCARADO } from '@/lib/privacidade';
import { usePrivacidade } from '@/stores/privacidadeStore';

export function DashboardCharts() {
  // O gráfico também expõe dinheiro: tooltip, legenda e totais.
  const oculto = usePrivacidade((s) => s.valoresOcultos);
    const { data: chartData, isLoading } = useQuery({
        queryKey: ["rental-charts"],
        queryFn: async () => {
            // Fetch all active contracts - using only existing columns
            const { data: contracts } = await supabase
                .from("contratos")
                .select("valor")
                .eq("status", "ATIVO");

            let totalRent = 0;
            let totalCommission = 0;
            let totalOwner = 0;

            contracts?.forEach(c => {
                const rent = c.valor || 0;
                const feePct = 10; // Default 10% admin fee
                const fee = rent * (feePct / 100);

                totalRent += rent;
                totalCommission += fee;
                totalOwner += (rent - fee);
            });

            const pieData = [
                { name: 'Repasse Proprietários', value: totalOwner, color: '#22c55e' },
                { name: 'Comissão Adm.', value: totalCommission, color: '#3b82f6' },
            ];

            const barData = [
                { name: 'Total Movimentado', receita: totalRent, repasse: totalOwner, comissao: totalCommission }
            ];

            return { pieData, barData };
        }
    });

    if (isLoading) return <div className="h-64 bg-muted animate-pulse rounded-xl mt-6"></div>;

    const { pieData, barData } = chartData || { pieData: [], barData: [] };

    return (
        <div className="grid gap-4 md:grid-cols-2 mt-6">
            <Card className="col-span-1">
                <CardHeader>
                    <CardTitle>Distribuição da Receita</CardTitle>
                </CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {pieData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => (oculto ? VALOR_MASCARADO : `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)} />
                            <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            <Card className="col-span-1">
                <CardHeader>
                    <CardTitle>Balanço Estimado (Mensal)</CardTitle>
                </CardHeader>
                <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={barData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip formatter={(value: number) => (oculto ? VALOR_MASCARADO : `R$ ${value.toLocaleString('pt-BR')}`)} />
                            <Legend />
                            <Bar dataKey="receita" name="Receita Bruta" fill="#94a3b8" />
                            <Bar dataKey="repasse" name="Repasse Líquido" fill="#22c55e" />
                            <Bar dataKey="comissao" name="Comissão" fill="#3b82f6" />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>
        </div>
    );
}

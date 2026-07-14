import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillsList } from "@/components/rental/BillsList";
import { RepassesList } from "@/components/rental/RepassesList";
import { ContractsList } from "@/components/rental/ContractsList";
import { DashboardKPICards } from "@/components/rental/DashboardKPICards";
import { DashboardCharts } from "@/components/rental/DashboardCharts";

const RentalManagement = () => {
    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Gestão de Aluguéis</h1>
                    <p className="text-sm text-muted-foreground">
                        Gerencie faturas e repasses de forma automatizada.
                    </p>
                </div>
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
                <TabsList className="w-full grid grid-cols-4 h-auto">
                    <TabsTrigger value="overview" className="text-xs sm:text-sm py-2">Visão Geral</TabsTrigger>
                    <TabsTrigger value="bills" className="text-xs sm:text-sm py-2">Faturas</TabsTrigger>
                    <TabsTrigger value="transfers" className="text-xs sm:text-sm py-2">Repasses</TabsTrigger>
                    <TabsTrigger value="contracts" className="text-xs sm:text-sm py-2">Contratos</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                    <DashboardKPICards />
                    <DashboardCharts />
                </TabsContent>

                <TabsContent value="bills">
                    <BillsList />
                </TabsContent>

                <TabsContent value="transfers">
                    <RepassesList />
                </TabsContent>

                <TabsContent value="contracts">
                    <ContractsList />
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default RentalManagement;

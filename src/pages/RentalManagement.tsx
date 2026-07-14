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
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestão de Aluguéis</h1>
                    <p className="text-muted-foreground">
                        Gerencie faturas e repasses de forma automatizada.
                    </p>
                </div>
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Visão Geral</TabsTrigger>
                    <TabsTrigger value="bills">Faturas</TabsTrigger>
                    <TabsTrigger value="transfers">Repasses</TabsTrigger>
                    <TabsTrigger value="contracts">Contratos</TabsTrigger>
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

import { useParams, Link, useNavigate } from 'react-router-dom';
import { paraTipoUI } from '@/lib/crm/historico';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowLeft,
  Phone,
  Mail,
  AlertTriangle,
  MessageSquare,
  Calendar,
  Building2,
  FileText,
  CheckCircle,
  Clock,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useCRMStore } from '@/stores/crmStore';
import { STATUS_FUNIL_LABELS, TIPO_CONTATO_LABELS, StatusFunil } from '@/types/crm';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { RegistrarContatoDialog } from '@/components/clientes/RegistrarContatoDialog';
import { GerarContratoDialog } from '@/components/juridico/GerarContratoDialog';
import { NovoClienteDialog } from '@/components/clientes/NovoClienteDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { DadoSensivel } from '@/components/ui/dado-sensivel';
import { AvisoContratosEmRisco } from '@/components/clientes/AvisoContratosEmRisco';
import { podeExcluirCliente, temContrato, useContratosDosClientes } from '@/hooks/crm/useContratosDosClientes';

const statusColors: Record<StatusFunil, string> = {
  QUALIFICACAO: 'bg-primary text-primary-foreground',
  VISITA_PROPOSTA: 'bg-warning text-warning-foreground',
  DOCUMENTACAO: 'bg-orange-500 text-white',
  FECHADO_GANHO: 'bg-success text-success-foreground',
  FECHADO_PERDIDO: 'bg-destructive text-destructive-foreground',
};

const tipoContatoIcons: Record<string, React.ReactNode> = {
  LIGACAO: <Phone className="w-4 h-4" />,
  EMAIL: <Mail className="w-4 h-4" />,
  WHATSAPP: <MessageSquare className="w-4 h-4" />,
  VISITA: <Building2 className="w-4 h-4" />,
  PROPOSTA: <FileText className="w-4 h-4" />,
  NOTA: <FileText className="w-4 h-4" />,
};

export default function ClienteDetalhes() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { clientes, imoveis, historico, documentos, alertas, fetchImoveis, fetchHistorico, removeCliente } = useCRMStore();
  const { toast } = useToast();
  const [contatoDialogOpen, setContatoDialogOpen] = useState(false);
  const [contratoDialogOpen, setContratoDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Excluir cliente apaga em cascata os contratos dele, com faturas e repasses.
  // A consulta roda ao abrir a confirmação, para dizer o que vai junto.
  const contratosEmRisco = useContratosDosClientes(id ? [id] : [], deleteDialogOpen);

  // Ensure imoveis are loaded to resolve the link
  useEffect(() => {
    fetchImoveis();
  }, []);

  // O histórico nunca era buscado ao abrir o cliente — o DataLoader carrega
  // clientes, imóveis, contratos, corretor e alertas, mas não este. A timeline
  // só aparecia se o usuário registrasse um contato na mesma sessão.
  useEffect(() => {
    if (id) fetchHistorico(id);
  }, [id, fetchHistorico]);

  const cliente = clientes.find((c) => c.id === id);

  if (!cliente) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Cliente não encontrado.</p>
        <Button variant="link" onClick={() => navigate('/clientes')}>
          Voltar para Clientes
        </Button>
      </div>
    );
  }

  const clienteHistorico = historico.filter((h) => h.cliente_id === cliente.id);
  const clienteDocumentos = documentos.filter((d) => d.cliente_id === cliente.id);
  const clienteAlertas = alertas.filter((a) => a.cliente_id === cliente.id && !a.lido);
  const imoveisInteresse = imoveis.filter((i) => cliente.imoveis_interesse.includes(i.id));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/clientes')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{cliente.nome}</h1>
            <Badge className={cn(statusColors[cliente.status_funil])}>
              {STATUS_FUNIL_LABELS[cliente.status_funil]}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-1 text-muted-foreground">
            <span className="flex items-center gap-1">
              <Phone className="w-4 h-4" />
              <DadoSensivel valor={cliente.telefone} tipo="telefone" />
            </span>
            {cliente.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-4 h-4" />
                <DadoSensivel valor={cliente.email} tipo="email" />
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
            <Pencil className="w-4 h-4 mr-2" />
            Editar
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="w-4 h-4 mr-2" />
            Excluir
          </Button>
        </div>
      </div>

      {/* Critical Alerts */}
      {clienteAlertas.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" />
              Alertas Críticos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {clienteAlertas.map((alerta) => (
                <li key={alerta.id} className="text-sm flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
                  {alerta.mensagem}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ações Rápidas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setContatoDialogOpen(true)}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Registrar Contato
            </Button>
            <Button variant="outline">
              <Calendar className="w-4 h-4 mr-2" />
              Agendar Visita
            </Button>
            <Button variant="outline" asChild>
              <Link to="/imoveis">
                <Building2 className="w-4 h-4 mr-2" />
                Vincular Imóvel
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setContratoDialogOpen(true)}>
              <FileText className="w-4 h-4 mr-2" />
              Gerar Contrato
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Properties of Interest */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Imóveis de Interesse ({imoveisInteresse.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {imoveisInteresse.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum imóvel vinculado ainda.
              </p>
            ) : (
              <ul className="space-y-2">
                {imoveisInteresse.map((imovel) => (
                  <li key={imovel.id} className="text-sm p-2 bg-muted rounded-lg">
                    <p className="font-medium">{imovel.titulo}</p>
                    <p className="text-muted-foreground">
                      {imovel.bairro} •{' '}
                      {imovel.valor > 10000
                        ? `R$ ${(imovel.valor / 1000).toFixed(0)}k`
                        : `R$ ${imovel.valor.toLocaleString('pt-BR')}/mês`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Documentos ({clienteDocumentos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {clienteDocumentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum documento cadastrado.
              </p>
            ) : (
              <ul className="space-y-2">
                {clienteDocumentos.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between text-sm p-2 bg-muted rounded-lg">
                    <span>{doc.nome}</span>
                    {doc.validado ? (
                      <CheckCircle className="w-4 h-4 text-success" />
                    ) : (
                      <Clock className="w-4 h-4 text-warning" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Histórico de Contatos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clienteHistorico.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum contato registrado ainda.
            </p>
          ) : (
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
              <ul className="space-y-4">
                {clienteHistorico.map((item) => {
                  // A tabela guarda o canal (TELEFONE/PRESENCIAL/...); o tipo que
                  // a UI mostra vem de metadata.tipo_ui quando existe.
                  const tipoUI = paraTipoUI(item.tipo, (item as { metadata?: Record<string, unknown> }).metadata);
                  const quando = (item as { data_contato?: string }).data_contato;
                  return (
                    <li key={item.id} className="relative pl-8">
                      <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-card border-2 border-primary flex items-center justify-center">
                        {tipoContatoIcons[tipoUI]}
                      </div>
                      <div className="bg-muted rounded-lg p-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                          <span className="font-medium text-foreground">
                            {TIPO_CONTATO_LABELS[tipoUI]}
                          </span>
                          <span>•</span>
                          <span>
                            {quando ? format(new Date(quando), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : '—'}
                          </span>
                        </div>
                        <p className="text-sm">{(item as { conteudo?: string }).conteudo}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <RegistrarContatoDialog
        open={contatoDialogOpen}
        onOpenChange={setContatoDialogOpen}
        clienteId={cliente.id}
      />

      <GerarContratoDialog
        open={contratoDialogOpen}
        onOpenChange={setContratoDialogOpen}
        clienteId={cliente.id}
      />

      {/* Edit Client Dialog */}
      <NovoClienteDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        clienteToEdit={cliente}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Excluir Cliente
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{cliente.nome}</strong>? Esta ação é irreversível e todos os dados associados
              (histórico de contatos, vínculos com imóveis, contratos, etc.) serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AvisoContratosEmRisco consulta={contratosEmRisco} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting || !podeExcluirCliente(contratosEmRisco)}
              onClick={async (e) => {
                e.preventDefault();
                setIsDeleting(true);
                const result = await removeCliente(cliente.id);
                setIsDeleting(false);
                if (result.success) {
                  toast({ title: 'Cliente excluído com sucesso' });
                  navigate('/clientes');
                } else {
                  toast({
                    variant: 'destructive',
                    title: 'Erro ao excluir cliente',
                    description: 'Verifique se não há contratos vinculados a este cliente.',
                  });
                  setDeleteDialogOpen(false);
                }
              }}
            >
              {isDeleting ? 'Excluindo...' : temContrato(contratosEmRisco) ? 'Excluir cliente e contratos' : 'Sim, Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

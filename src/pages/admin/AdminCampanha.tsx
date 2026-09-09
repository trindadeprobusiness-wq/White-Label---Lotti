import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Save, GripVertical, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { EstadoErro } from '@/components/admin/Estados';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfigAdmin, useSalvarConfig } from '@/hooks/admin/useSaasDados';
import { usePapeis } from '@/hooks/admin/usePapeis';
import { getPublicBaseUrl } from '@/lib/publicBaseUrl';

/** Chaves que esta tela administra, na ordem em que aparecem. */
const CAMPOS_PROGRAMA: {
  chave: string;
  label: string;
  tipo: 'numero' | 'booleano';
  sufixo?: string;
  ajuda?: string;
}[] = [
  {
    chave: 'programa_comissao_padrao',
    label: 'Comissão padrão',
    tipo: 'numero',
    sufixo: '%',
    ajuda:
      'Valor sugerido ao cadastrar a primeira vigência de um parceiro. Não é aplicado sozinho: sem vigência cadastrada, nenhuma comissão é gerada.',
  },
  {
    chave: 'atribuicao_janela_dias',
    label: 'Janela de atribuição',
    tipo: 'numero',
    sufixo: 'dias',
    ajuda:
      'Prazo entre o clique e o cadastro para o parceiro receber o crédito. Vale para atribuições novas; as existentes congelaram a janela vigente.',
  },
  {
    chave: 'programa_comissao_recorrente',
    label: 'Comissão recorrente',
    tipo: 'booleano',
    ajuda: 'Renovações elegíveis também geram comissão.',
  },
  {
    chave: 'programa_cortesia_ativa',
    label: 'Cortesia automática',
    tipo: 'booleano',
    ajuda: 'Concede acesso cortesia ao ativar um parceiro.',
  },
  {
    chave: 'programa_cortesia_dias',
    label: 'Dias de cortesia',
    tipo: 'numero',
    sufixo: 'dias',
  },
  {
    chave: 'programa_saldo_minimo',
    label: 'Saldo mínimo para repasse',
    tipo: 'numero',
    sufixo: 'R$',
  },
  {
    chave: 'programa_hold_dias',
    label: 'Prazo de liberação',
    tipo: 'numero',
    sufixo: 'dias',
    ajuda:
      'Tempo entre a receita confirmada e a comissão poder entrar em lote. Cobre a janela de estorno e chargeback.',
  },
  {
    chave: 'programa_ciclo_dia',
    label: 'Dia do ciclo de pagamento',
    tipo: 'numero',
    sufixo: 'do mês',
  },
];

export default function AdminCampanha() {
  const { data, isLoading, error, refetch } = useConfigAdmin();
  const salvar = useSalvarConfig();
  const { podeExecutar } = usePapeis();
  const editavel = podeExecutar('alterar_config_programa');

  const [rascunho, setRascunho] = useState<Record<string, unknown>>({});
  const [beneficios, setBeneficios] = useState<string[]>([]);

  const porChave = useMemo(() => {
    const mapa: Record<string, unknown> = {};
    for (const c of data ?? []) mapa[c.chave] = c.valor;
    return mapa;
  }, [data]);

  // O rascunho nasce do servidor e só é reinicializado quando os dados chegam.
  // Sobrescrevê-lo a cada render apagaria o que o operador está digitando.
  useEffect(() => {
    if (!data) return;
    setRascunho(porChave);
    const lista = porChave.portal_beneficios;
    setBeneficios(Array.isArray(lista) ? (lista as string[]) : []);
  }, [data, porChave]);

  const valorDe = (chave: string) => rascunho[chave];
  const definir = (chave: string, valor: unknown) =>
    setRascunho((r) => ({ ...r, [chave]: valor }));

  const alterado = (chave: string) =>
    JSON.stringify(rascunho[chave]) !== JSON.stringify(porChave[chave]);

  const salvarChave = async (chave: string, valor: unknown) => {
    await salvar.mutateAsync({ chave, valor });
  };

  const linkPortal = `${getPublicBaseUrl()}/parceiros`;

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(linkPortal);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione e copie manualmente.');
    }
  };

  if (error) {
    return (
      <>
        <CabecalhoAdmin titulo="Campanha e portal" />
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      </>
    );
  }

  return (
    <>
      <CabecalhoAdmin
        titulo="Campanha e portal"
        descricao="Regras do programa de parceiros e conteúdo da página pública de inscrição."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Campanha' }]}
      />

      {!editavel && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4 text-sm">
            Você pode consultar estas configurações, mas alterá-las exige papel de super
            admin — elas mudam como a receita é atribuída e como o repasse é calculado.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="programa">
        <TabsList className="mb-4">
          <TabsTrigger value="programa">Programa</TabsTrigger>
          <TabsTrigger value="portal">Portal do parceiro</TabsTrigger>
        </TabsList>

        <TabsContent value="programa">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regras da campanha</CardTitle>
              <CardDescription>
                Alterações valem para o futuro. Atribuições e comissões já criadas
                congelaram a regra vigente na própria linha e não são reescritas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))
                : CAMPOS_PROGRAMA.map((campo) => (
                    <div
                      key={campo.chave}
                      className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="max-w-md">
                        <Label htmlFor={`cfg-${campo.chave}`} className="text-sm font-medium">
                          {campo.label}
                        </Label>
                        {campo.ajuda && (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {campo.ajuda}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {campo.tipo === 'booleano' ? (
                          <Switch
                            id={`cfg-${campo.chave}`}
                            checked={valorDe(campo.chave) === true}
                            disabled={!editavel}
                            onCheckedChange={(v) => {
                              definir(campo.chave, v);
                              void salvarChave(campo.chave, v);
                            }}
                          />
                        ) : (
                          <>
                            <Input
                              id={`cfg-${campo.chave}`}
                              type="number"
                              inputMode="decimal"
                              className="w-28"
                              disabled={!editavel}
                              value={String(valorDe(campo.chave) ?? '')}
                              onChange={(e) =>
                                definir(
                                  campo.chave,
                                  e.target.value === '' ? '' : Number(e.target.value),
                                )
                              }
                            />
                            {campo.sufixo && (
                              <span className="text-sm text-muted-foreground">
                                {campo.sufixo}
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!editavel || !alterado(campo.chave)}
                              onClick={() =>
                                void salvarChave(campo.chave, valorDe(campo.chave))
                              }
                            >
                              <Save className="h-3.5 w-3.5" />
                              <span className="sr-only">Salvar {campo.label}</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="portal">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conteúdo do portal</CardTitle>
              <CardDescription>
                A página pública de inscrição ainda não existe — este conteúdo já fica
                persistido e será usado quando ela entrar no ar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label>Link público</Label>
                <div className="flex gap-2">
                  <Input readOnly value={linkPortal} className="font-mono text-sm" />
                  <Button variant="outline" size="icon" onClick={() => void copiarLink()}>
                    <Copy className="h-4 w-4" />
                    <span className="sr-only">Copiar link do portal</span>
                  </Button>
                  <Button variant="outline" size="icon" asChild>
                    <a href={linkPortal} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      <span className="sr-only">Abrir prévia do portal</span>
                    </a>
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <Label htmlFor="cfg-portal-publicado" className="text-sm font-medium">
                    Publicado
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Em rascunho, o portal não fica visível publicamente.
                  </p>
                </div>
                <Switch
                  id="cfg-portal-publicado"
                  checked={valorDe('portal_publicado') === true}
                  disabled={!editavel}
                  onCheckedChange={(v) => {
                    definir('portal_publicado', v);
                    void salvarChave('portal_publicado', v);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cfg-portal-titulo">Título</Label>
                <div className="flex gap-2">
                  <Input
                    id="cfg-portal-titulo"
                    disabled={!editavel}
                    value={String(valorDe('portal_titulo') ?? '')}
                    onChange={(e) => definir('portal_titulo', e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!editavel || !alterado('portal_titulo')}
                    onClick={() => void salvarChave('portal_titulo', valorDe('portal_titulo'))}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cfg-portal-descricao">Descrição</Label>
                <Textarea
                  id="cfg-portal-descricao"
                  rows={3}
                  disabled={!editavel}
                  value={String(valorDe('portal_descricao') ?? '')}
                  onChange={(e) => definir('portal_descricao', e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!editavel || !alterado('portal_descricao')}
                  onClick={() =>
                    void salvarChave('portal_descricao', valorDe('portal_descricao'))
                  }
                >
                  <Save className="mr-2 h-4 w-4" />
                  Salvar descrição
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Benefícios</Label>
                {beneficios.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <Input
                      value={b}
                      disabled={!editavel}
                      aria-label={`Benefício ${i + 1}`}
                      onChange={(e) => {
                        const novo = [...beneficios];
                        novo[i] = e.target.value;
                        setBeneficios(novo);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={!editavel}
                      onClick={() => setBeneficios(beneficios.filter((_, j) => j !== i))}
                      aria-label={`Remover benefício ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!editavel}
                    onClick={() => setBeneficios([...beneficios, ''])}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar
                  </Button>
                  <Button
                    size="sm"
                    disabled={!editavel}
                    onClick={() =>
                      void salvarChave(
                        'portal_beneficios',
                        beneficios.map((b) => b.trim()).filter(Boolean),
                      )
                    }
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Salvar benefícios
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

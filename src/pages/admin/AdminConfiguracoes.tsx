import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { CabecalhoAdmin } from '@/components/admin/CabecalhoAdmin';
import { EstadoErro } from '@/components/admin/Estados';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { tabelaAdmin } from '@/lib/admin/api';
import { apiDisponivel } from '@/lib/api';
import { atualizarConfigApi, listarLinhasConfigApi } from '@/lib/api/parceiros';
import { adminKeys } from '@/hooks/admin/usePapeis';
import { mensagemDeErro } from '@/lib/errors';

interface LinhaConfig {
  chave: string;
  valor: unknown;
  descricao: string | null;
}

export default function AdminConfiguracoes() {
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...adminKeys.todos, 'config'],
    queryFn: async () => {
      if (apiDisponivel()) return (await listarLinhasConfigApi()) as unknown as LinhaConfig[];
      const { data, error } = await tabelaAdmin('admin_config').select('*').order('chave');
      if (error) throw error;
      return (data ?? []) as unknown as LinhaConfig[];
    },
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    setValores(
      Object.fromEntries(
        data.map((l) => [l.chave, String(l.valor).replace(/^"|"$/g, '')]),
      ),
    );
  }, [data]);

  const salvar = async (chave: string) => {
    setSalvando(chave);
    try {
      const bruto = valores[chave];
      // O JSONB guarda tipo: número vira número, texto vira string entre aspas.
      // Gravar "30" como texto faria admin_config_int devolver o default e a
      // métrica de atividade mudaria sem ninguém entender por quê.
      const numerico = Number(bruto);
      const valorJson = bruto !== '' && !Number.isNaN(numerico) ? numerico : bruto;

      if (apiDisponivel()) {
        await atualizarConfigApi(chave, valorJson);
      } else {
        const { error } = await tabelaAdmin('admin_config')
          .update({ valor: valorJson, atualizado_em: new Date().toISOString() })
          .eq('chave', chave);

        if (error) throw error;
      }

      toast.success('Configuração salva.');
      void qc.invalidateQueries({ queryKey: adminKeys.todos });
    } catch (e) {
      toast.error(mensagemDeErro(e, 'Não foi possível salvar. Só um super admin pode alterar.'));
    } finally {
      setSalvando(null);
    }
  };

  if (error) {
    return (
      <>
        <CabecalhoAdmin titulo="Configurações" />
        <EstadoErro erro={error} aoTentarNovamente={() => void refetch()} />
      </>
    );
  }

  return (
    <>
      <CabecalhoAdmin
        titulo="Configurações"
        descricao="Parâmetros que definem como a operação é medida e como a origem é atribuída."
        migalhas={[{ label: 'Back office', href: '/admin' }, { label: 'Configurações' }]}
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {(data ?? []).map((linha) => (
            <Card key={linha.chave}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{rotulo(linha.chave)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor={`cfg-${linha.chave}`} className="sr-only">
                      {rotulo(linha.chave)}
                    </Label>
                    {linha.chave === 'atribuicao_modelo' ? (
                      <Select
                        value={valores[linha.chave] ?? ''}
                        onValueChange={(v) =>
                          setValores((a) => ({ ...a, [linha.chave]: v }))
                        }
                      >
                        <SelectTrigger id={`cfg-${linha.chave}`} className="sm:w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="primeiro_clique">Primeiro clique</SelectItem>
                          <SelectItem value="ultimo_clique">Último clique</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`cfg-${linha.chave}`}
                        value={valores[linha.chave] ?? ''}
                        onChange={(e) =>
                          setValores((a) => ({ ...a, [linha.chave]: e.target.value }))
                        }
                        className="sm:w-[220px]"
                      />
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void salvar(linha.chave)}
                    disabled={salvando === linha.chave}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {salvando === linha.chave ? 'Salvando...' : 'Salvar'}
                  </Button>
                </div>

                {linha.descricao && (
                  <p className="mt-3 text-sm text-muted-foreground">{linha.descricao}</p>
                )}

                {/* Diz o alcance da mudança. Sem isso, alguém supõe que baixar a
                    janela reclassifica o passado, ou que mudar o modelo
                    reescreve atribuições existentes. */}
                <p className="mt-2 text-xs text-muted-foreground">
                  {linha.chave === 'janela_atividade_dias'
                    ? 'Vale imediatamente para todas as telas: ativo e inativo são recalculados na hora da consulta.'
                    : 'Vale apenas para atribuições novas. As existentes guardam a regra com que nasceram e não mudam.'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function rotulo(chave: string): string {
  const mapa: Record<string, string> = {
    janela_atividade_dias: 'Janela de atividade (dias)',
    atribuicao_modelo: 'Modelo de atribuição',
    atribuicao_janela_dias: 'Janela de atribuição padrão (dias)',
  };
  return mapa[chave] ?? chave;
}

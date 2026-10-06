import { chamarApiAdministrador } from '@/lib/api';
import type { SessaoSuporte } from '@/lib/admin/suporte';
import { corpoJson, lerErroApi } from './http';

// Atendimento do backoffice pela API Lotti (no lugar da Edge `admin-suporte`). Só é chamado atrás
// de apiDisponivel(). As duas rotas são do ADMINISTRADOR: vão sempre com o token do login dele
// (chamarApiAdministrador), nunca com o token de atendimento.

/**
 * Abre o atendimento da conta (`corretor_id`, o id da rota /suporte/:id). Devolve o mesmo corpo da
 * Edge mais o `token` de atendimento, pronto para salvarSuporte(). Erros chegam como ErroApi com o
 * texto da API (conta inativa, administrativa, sem permissão...).
 */
export async function abrirSuporteApi(corretorId: string, motivo?: string): Promise<SessaoSuporte> {
  const res = await chamarApiAdministrador('/api/admin/suporte/abrir',
    corpoJson('POST', motivo ? { corretor_id: corretorId, motivo } : { corretor_id: corretorId }));
  if (!res.ok) throw await lerErroApi(res, 'Não foi possível abrir o atendimento.');
  const dados = (await res.json()) as Partial<SessaoSuporte> | null;
  if (!dados?.id || !dados.user?.id || !dados.expira_em || !dados.token) throw new Error('A sessão não foi criada.');
  return dados as SessaoSuporte;
}

/** Encerra o atendimento (só o administrador que abriu). O token de atendimento morre no servidor. */
export async function encerrarSuporteApi(sessaoId: string): Promise<void> {
  const res = await chamarApiAdministrador('/api/admin/suporte/encerrar', corpoJson('POST', { sessao_id: sessaoId }));
  if (!res.ok) throw await lerErroApi(res, 'Não foi possível encerrar o atendimento.');
}

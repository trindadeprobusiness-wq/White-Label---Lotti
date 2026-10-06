// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Modo API (bloco B1): o contrato salvo abre pela API, nunca pelo Storage do Supabase.
// O Supabase vira um objeto vazio: qualquer supabase.storage/from aqui quebraria o teste.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true }));
const arquivos = vi.hoisted(() => ({ abrirPrivadoApi: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/arquivos', () => arquivos);
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from 'sonner';
import { ContractUpload } from './ContractUpload';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ContractUpload com a API', () => {
  it('visualizar abre o documento privado pela API com a mesma key', async () => {
    render(<ContractUpload onFileSelect={() => undefined} existingFileUrl="corretor-1/1700000000000_contrato.pdf" />);
    fireEvent.click(screen.getByTitle('Visualizar contrato'));
    await waitFor(() => expect(arquivos.abrirPrivadoApi).toHaveBeenCalledWith('documento', 'corretor-1/1700000000000_contrato.pdf'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('falha ao abrir mostra o erro, como antes', async () => {
    arquivos.abrirPrivadoApi.mockRejectedValueOnce(new Error('Sem acesso.'));
    render(<ContractUpload onFileSelect={() => undefined} existingFileUrl="corretor-1/c.pdf" />);
    fireEvent.click(screen.getByTitle('Visualizar contrato'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro ao abrir contrato: Sem acesso.'));
  });
});

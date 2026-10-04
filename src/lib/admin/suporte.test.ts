// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarFetchSuporte, salvarSuporte, type SessaoSuporte } from './suporte';

const base = 'https://projeto.supabase.co';
const sessao = { id: 'sessao', user: { id: 'cliente' }, expira_em: '2099-01-01', nome: 'Teste' } as SessaoSuporte;
describe('transporte de atendimento separado do login administrativo', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.setItem('admin-login', 'preservado'); });
  it('encaminha leitura e escrita ao proxy sem tocar o login do administrador', async () => {
    salvarSuporte(sessao);
    const original = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const enviar = criarFetchSuporte(base, original);
    await enviar(`${base}/rest/v1/clientes?id=eq.1`, { method: 'PATCH', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Atualizado' }) });
    const [url, opcoes] = original.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/admin-suporte?sessao=sessao&path=');
    expect(opcoes?.method).toBe('PATCH');
    expect(new TextDecoder().decode(opcoes?.body as ArrayBuffer)).toBe('{"nome":"Atualizado"}');
    expect(localStorage.getItem('admin-login')).toBe('preservado');
  });
  it('nao intercepta autenticacao, encerramento, outros dominios nem abas normais', async () => {
    const original = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const enviar = criarFetchSuporte(base, original);
    await enviar(`${base}/rest/v1/clientes`);
    salvarSuporte(sessao);
    await enviar(`${base}/auth/v1/token`);
    await enviar(`${base}/functions/v1/admin-suporte`);
    await enviar('https://outro.test/rest/v1/clientes');
    expect(original.mock.calls.map(c => String(c[0]))).toEqual([`${base}/rest/v1/clientes`,`${base}/auth/v1/token`,`${base}/functions/v1/admin-suporte`,'https://outro.test/rest/v1/clientes']);
  });
  it('impede requisicoes apos expirar', async () => {
    salvarSuporte({ ...sessao, expira_em: '2000-01-01' });
    const original = vi.fn<typeof fetch>();
    const resposta = await criarFetchSuporte(base, original)(`${base}/rest/v1/clientes`);
    expect(resposta.status).toBe(403); expect(original).not.toHaveBeenCalled();
  });
});

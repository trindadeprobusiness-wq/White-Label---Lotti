// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ErroApi } from '@/lib/api/http';
import { textoErroConvite } from './AdminParceiroDetalhe';

const PADRAO = 'Não foi possível enviar o convite. Confira o provedor de e-mail.';

describe('textoErroConvite', () => {
  it('usa a message da API quando o erro vem da API Lotti', () => {
    const erro = new ErroApi(503, 'provedor_de_email_nao_configurado',
      'O envio de convites por e-mail ainda não está configurado no servidor.');
    expect(textoErroConvite(erro)).toBe('O envio de convites por e-mail ainda não está configurado no servidor.');
  });

  it('no ramo Supabase ignora o texto técnico do supabase-js', () => {
    const erro = new Error('Edge Function returned a non-2xx status code');
    expect(textoErroConvite(erro)).toBe(PADRAO);
    expect(textoErroConvite(erro, 'Ative o parceiro antes de enviar o convite.'))
      .toBe('Ative o parceiro antes de enviar o convite.');
  });

  it('sem erro, usa o error do corpo e depois o padrão', () => {
    expect(textoErroConvite(null, 'Cadastro salvo.')).toBe('Cadastro salvo.');
    expect(textoErroConvite(null)).toBe(PADRAO);
  });
});

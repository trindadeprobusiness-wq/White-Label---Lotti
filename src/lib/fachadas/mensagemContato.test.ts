import { describe, expect, it } from 'vitest';
import { MENSAGEM_PADRAO, linkDeContato, montarMensagemDeContato } from './mensagemContato';

describe('mensagem de contato da fachada', () => {
  it('preenche nome e imóvel no modelo do corretor', () => {
    const texto = montarMensagemDeContato('Oi {nome}, ainda tem interesse no {imovel}?', {
      nome: 'Tatiane C Fernandes', imovel: 'Apartamento 302 — Setor Bueno',
    });
    expect(texto).toBe('Oi Tatiane, ainda tem interesse no Apartamento 302 — Setor Bueno?');
  });

  it('usa só o primeiro nome', () => {
    // "Olá Maria Aparecida da Silva Santos!" soa a cadastro, não a conversa.
    expect(montarMensagemDeContato('Olá {nome}!', { nome: 'Maria Aparecida da Silva Santos' }))
      .toBe('Olá Maria!');
  });

  it('sem modelo salvo, usa o padrão', () => {
    const texto = montarMensagemDeContato('', { nome: 'Gustavo', imovel: 'Casa no Jardim Goiás' });
    expect(texto).toContain('Gustavo');
    expect(texto).toContain('Casa no Jardim Goiás');
    expect(MENSAGEM_PADRAO).toContain('{nome}');
  });

  it('campo vazio não deixa buraco nem espaço solto', () => {
    // Fachada sem imóvel vinculado não pode gerar "pelo  ." com dois espaços.
    const texto = montarMensagemDeContato('Vi seu interesse pelo {imovel}. Posso ajudar?', { imovel: null });
    expect(texto).toBe('Vi seu interesse pelo. Posso ajudar?');
    expect(texto).not.toContain('  ');
  });

  it('campo que não existe fica como está, em vez de sumir', () => {
    // Erro de digitação do corretor tem que aparecer na prévia, não virar vazio
    // silencioso que ele só descobre com o lead do outro lado.
    expect(montarMensagemDeContato('Oi {nome}, {inventado}', { nome: 'Ana' }))
      .toBe('Oi Ana, {inventado}');
  });

  it('monta o link do WhatsApp com o texto', () => {
    const link = linkDeContato('(62) 99999-1234', 'Olá Ana!');
    expect(link).toBe('https://wa.me/5562999991234?text=Ol%C3%A1%20Ana!');
  });

  it('não duplica o código do país quando o telefone já tem', () => {
    expect(linkDeContato('5562999991234', 'oi')).toContain('wa.me/5562999991234?');
  });
});

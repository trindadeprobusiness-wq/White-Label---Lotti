import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EMAIL_PUBLICO, EnviarLeadDto, normalizarTelefone, TELEFONE_VALIDO } from './fachadas-publico.dto';

const OPCOES = { whitelist: true, forbidNonWhitelisted: true };
const propriedades = (corpo: Record<string, unknown>) =>
  validateSync(plainToInstance(EnviarLeadDto, corpo), OPCOES).map((e) => e.property).sort();

const lead = (extra: Record<string, unknown> = {}) => ({ nome: 'Ana Souza', telefone: '(11) 99999-8888', ...extra });

describe('normalizarTelefone e TELEFONE_VALIDO: tradução literal do gatilho', () => {
  const casos: Array<[string, boolean]> = [
    ['(11) 99999-8888', true],
    ['+55 11 99999-8888', true],
    ['5511999998888', true],
    ['011999998888', false],
    ['1199999888', true],
    ['119999988', false],
    ['0'.repeat(10), false],
  ];

  it.each(casos)('%s', (valor, esperado) => {
    expect(TELEFONE_VALIDO.test(normalizarTelefone(valor))).toBe(esperado);
  });

  it('telefone de 10 dígitos com DDD passa', () => {
    expect(TELEFONE_VALIDO.test(normalizarTelefone('(11) 3333-4444'))).toBe(true);
  });

  it('tira o 55 só de 12 ou 13 dígitos', () => {
    expect(normalizarTelefone('5511999998888')).toBe('11999998888'); // 13 dígitos
    expect(normalizarTelefone('551133334444')).toBe('1133334444'); // 12 dígitos
    expect(normalizarTelefone('5511999998888000')).toBe('5511999998888000'); // 16 dígitos: fica como veio
  });
});

describe('EMAIL_PUBLICO é o regex do gatilho em sintaxe JS', () => {
  it('aceita e recusa como o banco', () => {
    expect(EMAIL_PUBLICO.test('ana@exemplo.com.br')).toBe(true);
    expect(EMAIL_PUBLICO.test('sem-arroba')).toBe(false);
    expect(EMAIL_PUBLICO.test('ana@exemplo')).toBe(false);
    expect(EMAIL_PUBLICO.test('a na@exemplo.com')).toBe(false);
  });
});

describe('EnviarLeadDto', () => {
  it('aceita o corpo mínimo e com e-mail', () => {
    expect(propriedades(lead())).toEqual([]);
    expect(propriedades(lead({ email: 'ana@exemplo.com' }))).toEqual([]);
  });

  it('o trim roda antes do MinLength, como o gatilho faz', () => {
    expect(plainToInstance(EnviarLeadDto, lead({ nome: '  Ana  ' })).nome).toBe('Ana');
    expect(propriedades(lead({ nome: '  a  ' }))).toEqual(['nome']);
    expect(propriedades(lead({ nome: '   ' }))).toEqual(['nome']);
  });

  it('as fronteiras são as do gatilho: nome 2..120, telefone <= 32, e-mail <= 254', () => {
    expect(propriedades(lead({ nome: 'ab' }))).toEqual([]);
    expect(propriedades(lead({ nome: 'a'.repeat(120) }))).toEqual([]);
    expect(propriedades(lead({ nome: 'a'.repeat(121) }))).toEqual(['nome']);
    expect(propriedades(lead({ telefone: `${'1'.repeat(33)}` }))).toEqual(['telefone']);
    expect(propriedades(lead({ email: `${'a'.repeat(250)}@b.co` }))).toEqual(['email']);
  });

  it('telefone sem DDD válido é recusado com mensagem em português', () => {
    const erros = validateSync(plainToInstance(EnviarLeadDto, lead({ telefone: '011999998888' })), OPCOES);
    expect(erros.map((e) => e.property)).toEqual(['telefone']);
    expect(Object.values(erros[0].constraints ?? {})).toEqual(['Informe um telefone válido com DDD.']);
  });

  it("email: '' é recusado — divergência deliberada do gatilho (§2.3)", () => {
    expect(propriedades(lead({ email: '' }))).toEqual(['email']);
  });

  it('exige nome e telefone', () => {
    expect(propriedades({})).toEqual(['nome', 'telefone']);
  });

  it('recusa as chaves que o visitante não pode forjar', () => {
    for (const chave of ['convertido', 'cliente_id', 'created_at', 'ip_hash', 'fachada_id', 'corretor_id']) {
      expect(propriedades(lead({ [chave]: 'x' }))).toEqual([chave]);
    }
  });
});

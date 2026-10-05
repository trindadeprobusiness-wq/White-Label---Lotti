import { hashIp, ipDoRequest, limparUtm, motivoDeInvalidez, slugValido, truncar, visitanteValido } from './utilitarios';

const V4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('utilitarios: slug e visitante', () => {
  it('slugValido aceita o formato do CHECK da tabela', () => {
    expect(slugValido('parceiro-teste')).toBe(true);
    expect(slugValido('ab')).toBe(false);
    expect(slugValido('Parceiro')).toBe(false);
    expect(slugValido('-abc')).toBe(false);
    expect(slugValido('abc-')).toBe(false);
    expect(slugValido(42)).toBe(false);
  });

  it('visitanteValido exige v4 canônico (paridade com uuidValido)', () => {
    expect(visitanteValido(V4)).toBe(true);
    expect(visitanteValido('11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(visitanteValido('aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa')).toBe(false);
    expect(visitanteValido(null)).toBe(false);
  });
});

describe('utilitarios: utm, truncar, ip', () => {
  it('limparUtm é allowlist, apara e corta em 200', () => {
    const limpo = limparUtm({ utm_source: '  google  ', fbclid: 'x'.repeat(300), is_admin: 'true', utm_term: '   ' });
    expect(limpo).toEqual({ utm_source: 'google', fbclid: 'x'.repeat(200) });
    expect(limparUtm({})).toBeNull();
    expect(limparUtm(null)).toBeNull();
    expect(limparUtm('texto')).toBeNull();
  });

  it('truncar apara, corta e devolve null para vazio ou não-texto', () => {
    expect(truncar('  oi  ', 10)).toBe('oi');
    expect(truncar('a'.repeat(50), 10)).toBe('a'.repeat(10));
    expect(truncar('   ', 10)).toBeNull();
    expect(truncar(undefined, 10)).toBeNull();
  });

  it('hashIp devolve 64 hex, e null sem IP ou sem salt', () => {
    const h = hashIp('203.0.113.9', 'salt');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('203.0.113.9', 'outro')).not.toBe(h);
    expect(hashIp(null, 'salt')).toBeNull();
    expect(hashIp('203.0.113.9', null)).toBeNull();
  });

  it('ipDoRequest pega o primeiro do x-forwarded-for, depois x-real-ip', () => {
    expect(ipDoRequest({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })).toBe('198.51.100.7');
    expect(ipDoRequest({ 'x-real-ip': '198.51.100.8' })).toBe('198.51.100.8');
    expect(ipDoRequest({ 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '198.51.100.9' })).toBe('198.51.100.9');
    expect(ipDoRequest({})).toBeNull();
  });
});

describe('utilitarios: motivoDeInvalidez', () => {
  const futuro = new Date(Date.now() + 86_400_000).toISOString();
  const base = {
    statusParceiro: 'ativo',
    expiraEm: futuro,
    emailParceiro: 'parceiro@x.com',
    emailCorretor: 'cliente@x.com',
    userIdParceiro: 'p',
    userIdCorretor: 'c',
  };

  it('caso válido devolve null', () => {
    expect(motivoDeInvalidez(base)).toBeNull();
  });

  it('parceiro fora de ativo', () => {
    expect(motivoDeInvalidez({ ...base, statusParceiro: 'suspenso' })).toBe('parceiro com status "suspenso"');
  });

  it('janela inválida e expirada', () => {
    expect(motivoDeInvalidez({ ...base, expiraEm: 'não é data' })).toBe('janela de atribuição inválida');
    expect(motivoDeInvalidez({ ...base, expiraEm: '2020-01-01T00:00:00.000Z' })).toBe('janela de atribuição expirada');
  });

  it('autoindicação por conta e por e-mail', () => {
    expect(motivoDeInvalidez({ ...base, userIdParceiro: 'c' })).toBe('autoindicação: o parceiro é o próprio usuário');
    expect(motivoDeInvalidez({ ...base, emailCorretor: '  PARCEIRO@X.COM ' })).toBe('autoindicação: mesmo e-mail do parceiro');
  });
});

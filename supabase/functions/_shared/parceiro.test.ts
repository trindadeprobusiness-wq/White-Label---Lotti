/**
 * Estas regras decidem se um parceiro recebe comissão. Cada teste trava uma
 * porta de fraude ou de dado sujo:
 *
 * - slug/uuid frouxos deixariam consultar a tabela com lixo, ou colidir com o
 *   CHECK do banco e derrubar a rota de redirecionamento em produção;
 * - UTM sem allowlist vira despejo arbitrário numa coluna JSONB;
 * - autoindicação é o abuso mais óbvio do programa: criar a própria conta pelo
 *   próprio link e faturar sobre a própria assinatura.
 */
import { describe, it, expect } from 'vitest';
import {
  slugValido,
  uuidValido,
  hashIp,
  ipDoRequest,
  limparUtm,
  truncar,
  motivoDeInvalidez,
} from './parceiro';

describe('slugValido', () => {
  it('aceita slug minúsculo com hífen no meio', () => {
    expect(slugValido('imobiliaria-x')).toBe(true);
    expect(slugValido('parceiro123')).toBe(true);
  });

  it('recusa maiúscula, acento e espaço — o slug vai na URL e é lido ao telefone', () => {
    expect(slugValido('Imobiliaria')).toBe(false);
    expect(slugValido('imobiliária')).toBe(false);
    expect(slugValido('imobiliaria x')).toBe(false);
  });

  it('recusa hífen nas pontas', () => {
    expect(slugValido('-abc')).toBe(false);
    expect(slugValido('abc-')).toBe(false);
  });

  it('exige de 3 a 48 caracteres', () => {
    // O limite espelha exatamente o CHECK de parceiro_links. Se divergir, a
    // função aceita e o INSERT explode com erro de constraint no meio do
    // redirecionamento — o visitante veria uma página de erro.
    expect(slugValido('abc')).toBe(true);
    expect(slugValido('ab')).toBe(false);
    expect(slugValido('a')).toBe(false);
    expect(slugValido('a'.repeat(48))).toBe(true);
    expect(slugValido('a'.repeat(49))).toBe(false);
  });

  it('recusa o que não é string', () => {
    expect(slugValido(null)).toBe(false);
    expect(slugValido(123)).toBe(false);
    expect(slugValido({})).toBe(false);
  });
});

describe('uuidValido', () => {
  it('aceita UUID v4 do crypto.randomUUID()', () => {
    expect(uuidValido('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('recusa string arbitrária — evita consulta com lixo vindo do cliente', () => {
    expect(uuidValido('abc')).toBe(false);
    expect(uuidValido('')).toBe(false);
    expect(uuidValido("' OR 1=1--")).toBe(false);
    expect(uuidValido(null)).toBe(false);
  });
});

describe('hashIp', () => {
  it('produz SHA-256 hex de 64 caracteres', async () => {
    const h = await hashIp('187.1.2.3', 'salt');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('é determinístico — o mesmo IP conta como o mesmo visitante', async () => {
    expect(await hashIp('187.1.2.3', 'salt')).toBe(await hashIp('187.1.2.3', 'salt'));
  });

  it('salt diferente muda o hash, então um vazamento não é reversível por rainbow table', async () => {
    expect(await hashIp('187.1.2.3', 'salt-a')).not.toBe(await hashIp('187.1.2.3', 'salt-b'));
  });

  it('IP ausente vira null em vez de hash de string vazia', async () => {
    expect(await hashIp(null, 'salt')).toBeNull();
  });
});

describe('ipDoRequest', () => {
  it('pega o primeiro IP do x-forwarded-for — o resto é proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '187.1.2.3, 10.0.0.1, 10.0.0.2' });
    expect(ipDoRequest(h)).toBe('187.1.2.3');
  });

  it('cai para x-real-ip quando não há forwarded', () => {
    expect(ipDoRequest(new Headers({ 'x-real-ip': '200.1.1.1' }))).toBe('200.1.1.1');
  });

  it('sem header devolve null', () => {
    expect(ipDoRequest(new Headers())).toBeNull();
  });
});

describe('limparUtm', () => {
  it('mantém só os campos conhecidos', () => {
    const r = limparUtm({
      utm_source: 'instagram',
      utm_campaign: 'lancamento',
      payload_gigante: 'x'.repeat(10_000),
      __proto__: 'nada',
    });
    expect(r).toEqual({ utm_source: 'instagram', utm_campaign: 'lancamento' });
  });

  it('trunca valor muito longo', () => {
    const r = limparUtm({ utm_source: 'a'.repeat(500) });
    expect(r?.utm_source).toHaveLength(200);
  });

  it('devolve null quando não sobra nada, em vez de {} na coluna', () => {
    expect(limparUtm({ irrelevante: 1 })).toBeNull();
    expect(limparUtm(null)).toBeNull();
    expect(limparUtm('string')).toBeNull();
  });
});

describe('truncar', () => {
  it('corta no limite e remove espaços das pontas', () => {
    expect(truncar('  abc  ', 10)).toBe('abc');
    expect(truncar('abcdef', 3)).toBe('abc');
  });

  it('string vazia e não-string viram null', () => {
    expect(truncar('   ', 10)).toBeNull();
    expect(truncar(42, 10)).toBeNull();
  });
});

describe('motivoDeInvalidez', () => {
  const agora = new Date('2026-08-14T12:00:00Z');
  const base = {
    statusParceiro: 'ativo',
    expiraEm: '2026-11-12T12:00:00Z',
    emailParceiro: 'parceiro@exemplo.com',
    emailCorretor: 'corretor@exemplo.com',
    userIdParceiro: null,
    userIdCorretor: 'user-corretor',
    agora,
  };

  it('conversão legítima passa', () => {
    expect(motivoDeInvalidez(base)).toBeNull();
  });

  it('parceiro não-ativo não recebe cadastro novo', () => {
    for (const status of ['inativo', 'suspenso', 'encerrado']) {
      expect(motivoDeInvalidez({ ...base, statusParceiro: status })).toContain(status);
    }
  });

  it('fora da janela, o crédito expira', () => {
    // Um clique de meses atrás não pode render comissão para sempre.
    expect(motivoDeInvalidez({ ...base, expiraEm: '2026-08-13T12:00:00Z' })).toBe(
      'janela de atribuição expirada',
    );
  });

  it('no último instante da janela ainda vale', () => {
    expect(
      motivoDeInvalidez({ ...base, expiraEm: '2026-08-14T12:00:01Z' }),
    ).toBeNull();
  });

  it('autoindicação pela mesma conta é bloqueada', () => {
    expect(
      motivoDeInvalidez({ ...base, userIdParceiro: 'u1', userIdCorretor: 'u1' }),
    ).toContain('autoindicação');
  });

  it('autoindicação pelo mesmo e-mail é bloqueada, ignorando caixa e espaço', () => {
    expect(
      motivoDeInvalidez({
        ...base,
        emailParceiro: 'Alguem@Exemplo.com',
        emailCorretor: '  alguem@exemplo.com ',
      }),
    ).toContain('autoindicação');
  });

  it('e-mails ausentes não viram falso positivo de autoindicação', () => {
    // Dois nulos são "iguais" em JS; comparar sem checar presença bloquearia
    // toda conversão em que o e-mail não foi carregado.
    expect(
      motivoDeInvalidez({ ...base, emailParceiro: null, emailCorretor: null }),
    ).toBeNull();
  });

  it('data de expiração inválida não passa como válida', () => {
    expect(motivoDeInvalidez({ ...base, expiraEm: 'nao-e-data' })).toBe(
      'janela de atribuição inválida',
    );
  });
});

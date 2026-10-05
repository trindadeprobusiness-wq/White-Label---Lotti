import {
  chaveDestino, encargosDaCobranca, ErroValidacaoAsaas, EVENTOS_WEBHOOK_ASAAS, extrairDadosConta, hojeSaoPaulo, idDoEvento, moedaBR,
  montarWebhookAsaas, normalizarAmbiente, normalizarApiKey, sha256Hex, somarMeses, telefoneParaAsaas, tokensIguais, vencimentoDaCobranca,
} from './asaas-regras';

// Casos portados de supabase/functions/_shared/{telefone,asaas-conexao,asaas-origem}.test.ts.

describe('telefoneParaAsaas', () => {
  it('remove máscara e envia celular no campo correto', () => {
    expect(telefoneParaAsaas('(62) 99999-8888')).toEqual({ mobilePhone: '62999998888' });
  });
  it('remove o código do país gravado por integrações', () => {
    expect(telefoneParaAsaas('55 62 99999-8888')).toEqual({ mobilePhone: '62999998888' });
  });
  it('envia telefone fixo como phone, nunca como mobilePhone', () => {
    expect(telefoneParaAsaas('(62) 3333-4444')).toEqual({ phone: '6233334444' });
  });
  it.each([null, '', 'não informado', '(20) 99999-8888', '629999888'])('omite telefone ausente ou inválido: %s', (t) => {
    expect(telefoneParaAsaas(t)).toEqual({});
  });
});

describe('conexão Asaas self-service', () => {
  it('aceita uma chave plausível sem depender do prefixo; recusa curta ou com espaço (ErroValidacaoAsaas)', () => {
    expect(normalizarApiKey('  $aact_prod_12345678901234567890  ')).toBe('$aact_prod_12345678901234567890');
    expect(() => normalizarApiKey('curta')).toThrow(/formato válido/);
    expect(() => normalizarApiKey('$aact_prod_1234567890 com espaço')).toThrow(ErroValidacaoAsaas);
    expect(() => normalizarApiKey(42)).toThrow('Informe a chave de API da sua conta Asaas.');
    expect(() => normalizarApiKey('x'.repeat(513))).toThrow(ErroValidacaoAsaas);
  });

  it('produção é o padrão e sandbox precisa ser explícito', () => {
    expect(normalizarAmbiente('producao')).toBe('producao');
    expect(normalizarAmbiente('qualquer-coisa')).toBe('producao');
    expect(normalizarAmbiente('sandbox')).toBe('sandbox');
  });

  it('extrai metadados seguros e usa o e-mail da sessão como reserva', () => {
    expect(extrairDadosConta({ companyName: 'Imobiliária Horizonte', cpfCnpj: '00000000000100' }, 'dono@exemplo.com'))
      .toEqual({ nome: 'Imobiliária Horizonte', email: 'dono@exemplo.com', cpfCnpj: '00000000000100' });
    expect(() => extrairDadosConta({}, null)).toThrow(ErroValidacaoAsaas);
  });

  it('provisiona o webhook com token próprio, os 13 eventos e NON_SEQUENTIALLY', () => {
    const payload = montarWebhookAsaas('https://api.exemplo.com/api/financeiro/asaas/webhook?t=slug', 'dono@exemplo.com', 'token-opaco');
    expect(payload.events).toEqual([...EVENTOS_WEBHOOK_ASAAS]);
    expect(payload.events).toHaveLength(13);
    expect(payload.events).toContain('PAYMENT_RECEIVED');
    expect(payload.events).toContain('TRANSFER_DONE');
    expect(payload.sendType).toBe('NON_SEQUENTIALLY');
    expect(payload).toMatchObject({ enabled: true, interrupted: false, apiVersion: 3, authToken: 'token-opaco' });
  });
});

describe('tokensIguais', () => {
  it('compara conteúdo e recusa ausência', () => {
    expect(tokensIguais('abc', 'abc')).toBe(true);
    expect(tokensIguais('abc', 'abd')).toBe(false);
    expect(tokensIguais(null, 'abc')).toBe(false);
    expect(tokensIguais('', 'abc')).toBe(false);
  });
  it("não vaza o comprimento: tamanhos diferentes continuam só 'diferentes'", () => {
    expect(tokensIguais('a', 'a'.repeat(100))).toBe(false);
  });
});

describe('idDoEvento', () => {
  it('usa o id do Asaas quando existe', () => {
    expect(idDoEvento({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).toBe('evt_1');
  });
  it('sem id, hash de evento:pagamento:dateCreated', () => {
    expect(idDoEvento({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', dateCreated: '2026-10-05' } }))
      .toBe(sha256Hex('PAYMENT_RECEIVED:pay_1:2026-10-05'));
  });
  it('sem id, a transferência entra no hash (duas transferências não colidem)', () => {
    const a = idDoEvento({ event: 'TRANSFER_DONE', transfer: { id: 'tr_1', dateCreated: '2026-10-05' } });
    const b = idDoEvento({ event: 'TRANSFER_DONE', transfer: { id: 'tr_2', dateCreated: '2026-10-05' } });
    expect(a).toBe(sha256Hex('TRANSFER_DONE:tr_1:2026-10-05'));
    expect(a).not.toBe(b);
  });
});

describe('somarMeses (date-fns addMonths)', () => {
  it('ajusta para o último dia do mês, inclusive em ano bissexto', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29');
    expect(somarMeses('2026-01-15', 11)).toBe('2026-12-15');
    expect(somarMeses('2026-12-31', 2)).toBe('2027-02-28');
    expect(somarMeses('2026-03-31', 1)).toBe('2026-04-30');
  });
});

describe('vencimentoDaCobranca e encargos', () => {
  const hoje = '2026-10-05';
  it('data gravada vence, mas nunca antes de hoje', () => {
    expect(vencimentoDaCobranca({ data_vencimento: '2026-11-10' }, null, hoje)).toBe('2026-11-10');
    expect(vencimentoDaCobranca({ data_vencimento: '2026-09-10' }, null, hoje)).toBe(hoje);
  });
  it('sem data, mes_referencia + dia do contrato limitado ao fim do mês (padrão 10)', () => {
    expect(vencimentoDaCobranca({ mes_referencia: '02/2027' }, { dia_vencimento: 31 }, hoje)).toBe('2027-02-28');
    expect(vencimentoDaCobranca({ mes_referencia: '12/2026' }, null, hoje)).toBe('2026-12-10');
    expect(vencimentoDaCobranca({ mes_referencia: 'xx' }, null, hoje)).toBe(hoje);
  });
  it('multa e juros sempre explícitos, juros ao mês = dia × 30', () => {
    expect(encargosDaCobranca({ multa_atraso_percentual: 10, juros_mora_diario_percentual: 0.0333 })).toEqual({
      multaPct: 10, jurosMensalPct: 1, fine: { value: 10, type: 'PERCENTAGE' }, interest: { value: 1 },
    });
    expect(encargosDaCobranca(null)).toMatchObject({ fine: { value: 0, type: 'PERCENTAGE' }, interest: { value: 0 } });
  });
  it('hoje em São Paulo', () => {
    expect(hojeSaoPaulo(new Date('2026-10-06T02:00:00Z'))).toBe('2026-10-05');
  });
});

describe('moedaBR e chaveDestino', () => {
  it('formata em reais e trata ausência', () => {
    expect(moedaBR(1840)).toMatch(/R\$\s?1\.840,00/);
    expect(moedaBR(null)).toBe('R$ —');
  });
  it('procura a chave PIX nos formatos do Asaas', () => {
    expect(chaveDestino({ pixAddressKey: 'a' })).toBe('a');
    expect(chaveDestino({ bankAccount: { cpfCnpj: 'b' } })).toBe('b');
    expect(chaveDestino({})).toBeNull();
  });
});

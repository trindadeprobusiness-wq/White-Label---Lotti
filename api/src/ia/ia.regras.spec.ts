import { deflateRawSync } from 'node:zlib';
import { AcaoInvalida, validarProposta } from './acoes';
import { mensagensDoHistorico } from './assistente.service';
import { extrair, textoDoDocx, textoDoPdf, textoDoXlsx, xmlNoZip } from './extracao';
import { argUuid, filtroNumero, filtroTexto, limiteEntre, termoDeBusca } from './ferramentas';
import { inicioDoPeriodo } from './ferramentas.service';
import { limitarParametros, PARAMETROS_PADRAO, sanitizarClassificacao } from './fotos.service';
import { estimarUso } from './gemini';
import { validarEntradaSugestao } from './mensagens.service';
import { nomeOriginal } from './anexos.service';
import { normalizarPedidoIa, PedidoIaInvalido } from './pedido';
import { contextoPublicoImovel, promptSistemaAssistente, promptUsuarioWhatsapp, VERSOES_PROMPT_IA } from './prompts';

const AUT = { organizationId: '55555555-5555-4555-8555-555555555555', userId: '66666666-6666-4666-8666-666666666666' };
const CLIENTE = '11111111-1111-4111-8111-111111111111';

describe('normalizarPedidoIa (contracts.ts)', () => {
  it('aplica os padrões e ignora identidade vinda do corpo', () => {
    const p = normalizarPedidoIa({ message: '  oi  ', organizationId: 'x', userId: 'y' }, AUT);
    expect(p).toMatchObject({
      organizationId: AUT.organizationId, userId: AUT.userId, module: 'assistant', intent: 'general.answer',
      message: 'oi', entityRefs: [], locale: 'pt-BR', timezone: 'America/Sao_Paulo', outputMode: 'text', requiresConfirmation: false,
    });
    expect(p.traceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('mantém trace_id válido, corta a mensagem em 4000 e normaliza entity_refs', () => {
    const p = normalizarPedidoIa({
      message: 'x'.repeat(5000), trace_id: 'trace_12345', module: 'finance', intent: 'assistant.chat', output_mode: 'structured',
      entity_refs: [{ type: 'cliente', id: CLIENTE }], requires_confirmation: true, timezone: 'America/Recife',
    }, AUT);
    expect(p.message).toHaveLength(4000);
    expect(p).toMatchObject({ traceId: 'trace_12345', module: 'finance', outputMode: 'structured', requiresConfirmation: true, timezone: 'America/Recife' });
    expect(p.entityRefs).toEqual([{ type: 'cliente', id: CLIENTE }]);
  });

  it.each([
    [null, 'Corpo da solicitação inválido'],
    [{}, 'Mensagem obrigatória'],
    [{ message: 'a', module: 'outro' }, 'Módulo de IA inválido'],
    [{ message: 'a', intent: 'Maiúscula' }, 'Intenção de IA inválida'],
    [{ message: 'a', output_mode: 'xml' }, 'Modo de saída inválido'],
    [{ message: 'a', timezone: 'Fuso;drop' }, 'Fuso horário inválido'],
    [{ message: 'a', entity_refs: 'x' }, 'entity_refs deve ser uma lista'],
    [{ message: 'a', entity_refs: Array.from({ length: 11 }, () => ({ type: 't', id: '1' })) }, 'Máximo de 10 entidades por solicitação'],
    [{ message: 'a', entity_refs: [{ type: 'a b', id: '1' }] }, 'Referência de entidade inválida'],
  ])('recusa %j com "%s"', (corpo, texto) => {
    expect(() => normalizarPedidoIa(corpo, AUT)).toThrow(new PedidoIaInvalido(texto));
  });
});

describe('validarProposta (actions.ts sem zod)', () => {
  it('create_client: trim, telefone padrão "" e tipo opcional omitido', () => {
    expect(validarProposta({ action_type: 'create_client', params: { nome: '  Ana ' }, description: ' Cadastrar ' })).toEqual({
      action_type: 'create_client', params: { nome: 'Ana', telefone: '' }, description: 'Cadastrar',
    });
  });

  it('create_property e create_financial_entry aceitam o que o esquema aceita', () => {
    expect(validarProposta({
      action_type: 'create_property', description: 'x',
      params: { titulo: 'Apto', tipo: 'CASA', valor: 320000, area_m2: 70.5, dormitorios: 2, garagem: 1, endereco: 'Rua 1', cidade: 'Anápolis' },
    }).params).toEqual({ titulo: 'Apto', tipo: 'CASA', valor: 320000, area_m2: 70.5, dormitorios: 2, garagem: 1, endereco: 'Rua 1', cidade: 'Anápolis' });
    expect(validarProposta({
      action_type: 'create_financial_entry', description: 'x',
      params: { tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'Luz', valor: 10.5, data: '2026-10-06', recorrente: false },
    }).params).toEqual({ tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'Luz', valor: 10.5, data: '2026-10-06', recorrente: false });
  });

  it.each([
    { action_type: 'drop_table', params: {}, description: 'x' },
    { action_type: 'create_client', params: { nome: 'A', extra: 1 }, description: 'x' },
    { action_type: 'create_client', params: { nome: '   ' }, description: 'x' },
    { action_type: 'create_client', params: { nome: 'A', telefone: null }, description: 'x' },
    { action_type: 'create_client', params: { nome: 'A' }, description: '' },
    { action_type: 'update_client_status', params: { client_id: 'abc', status: 'QUALIFICACAO' }, description: 'x' },
    { action_type: 'schedule_followup', params: { client_id: CLIENTE, date: '06/10/2026' }, description: 'x' },
    { action_type: 'create_property', params: { titulo: 'A', dormitorios: 1.5 }, description: 'x' },
    { action_type: 'create_property', params: { titulo: 'A', valor: -1 }, description: 'x' },
    { action_type: 'create_financial_entry', params: { tipo: 'RECEITA', categoria: 'OUTROS', descricao: 'x', valor: 0 }, description: 'x' },
    { action_type: 'create_financial_entry', params: { tipo: 'RECEITA', categoria: 'PIX', descricao: 'x', valor: 1 }, description: 'x' },
    { action_type: 'create_alert', params: { mensagem: 'x', prioridade: 'URGENTE' }, description: 'x' },
  ])('recusa %j', (proposta) => {
    expect(() => validarProposta(proposta as Record<string, unknown>)).toThrow(AcaoInvalida);
  });
});

describe('extração do ai-process-file', () => {
  function zip(nome: string, conteudo: string, comprimir = true): Buffer {
    const dados = comprimir ? deflateRawSync(Buffer.from(conteudo)) : Buffer.from(conteudo);
    const cabecalho = Buffer.alloc(30);
    cabecalho.writeUInt32LE(0x04034b50, 0);
    cabecalho.writeUInt16LE(comprimir ? 8 : 0, 8);
    cabecalho.writeUInt32LE(dados.length, 18);
    cabecalho.writeUInt16LE(Buffer.byteLength(nome), 26);
    cabecalho.writeUInt16LE(0, 28);
    return Buffer.concat([Buffer.alloc(7), cabecalho, Buffer.from(nome), dados]);
  }

  it('lê DOCX comprimido e respeita o byteOffset do Buffer', () => {
    const arquivo = zip('word/document.xml', '<w:document><w:p><w:t>Contrato &amp; Locação</w:t></w:p><w:p><w:t>Cláusula</w:t></w:p></w:document>');
    const fatia = new Uint8Array(Buffer.concat([Buffer.from('lixo'), arquivo]).subarray(4));
    expect(xmlNoZip(fatia, 'word/document.xml')).toContain('Contrato &amp; Locação');
    expect(textoDoDocx(fatia)).toBe('Contrato & Locação\nCláusula');
    expect(textoDoDocx(new Uint8Array(zip('outro.xml', 'x')))).toBe('[Não foi possível extrair texto do DOCX]');
  });

  it('lê XLSX (sharedStrings) e PDF pelos parênteses', () => {
    expect(textoDoXlsx(new Uint8Array(zip('xl/sharedStrings.xml', '<sst><si><t>Nome</t></si><si><t xml:space="preserve"> Valor </t></si></sst>', false))))
      .toBe('Nome, Valor');
    expect(textoDoPdf(new Uint8Array(Buffer.from('BT (Contrato de) Tj (loca\\\\cao\\nlinha) Tj (x) ET', 'latin1')))).toBe('Contrato de loca\\cao\nlinha');
    expect(textoDoPdf(new Uint8Array(Buffer.from('%PDF sem texto')))).toMatch(/^\[Não foi possível extrair texto do PDF/);
  });

  it('texto, imagem e vídeo como a função', () => {
    const longo = new TextEncoder().encode('a'.repeat(50_001));
    expect(extrair(longo, 'text/plain', 'n.txt', 'txt', 'k').texto).toBe(`${'a'.repeat(50_000)}\n\n[...conteúdo truncado]`);
    expect(extrair(new Uint8Array(3), 'image/png', 'foto.png', 'png', 'u/1.png')).toEqual({
      texto: '[Imagem: foto.png]', metadata: { storage_path: 'u/1.png', width: 0, height: 0 },
    });
    const video = extrair(new Uint8Array(1024 * 1024), 'video/mp4', 'v.mp4', 'mp4', 'k');
    expect(video).toEqual({ texto: '[Vídeo: v.mp4, 1.0MB]', metadata: { duration_estimate: 'unknown', size_mb: '1.00', format: 'mp4' } });
  });

  it('nome do arquivo: desfaz o latin1 do multipart só quando é UTF-8 válido', () => {
    expect(nomeOriginal(Buffer.from('contrato-locação.pdf', 'utf8').toString('latin1'))).toBe('contrato-locação.pdf');
    expect(nomeOriginal('simples.pdf')).toBe('simples.pdf');
    expect(nomeOriginal('café.pdf')).toBe('café.pdf');
  });
});

describe('auxiliares das ferramentas', () => {
  it('limites, termo de busca, filtros e uuid', () => {
    expect(limiteEntre(undefined, 10, 25)).toBe(10);
    expect(limiteEntre(100, 10, 25)).toBe(25);
    expect(limiteEntre(0, 10, 25)).toBe(1);
    expect(limiteEntre(2.5, 10, 25)).toBe(10);
    expect(termoDeBusca(' ana,%(x) ')).toBe('ana   x ');
    expect(termoDeBusca(5)).toBe('');
    expect(filtroTexto('')).toBeNull();
    expect(filtroTexto('CASA')).toBe('CASA');
    expect(filtroNumero(0)).toBeNull();
    expect(filtroNumero('100')).toBe(100);
    expect(filtroNumero('abc')).toBeNull();
    expect(argUuid({ client_id: CLIENTE }, 'client_id')).toBe(CLIENTE);
    expect(argUuid({ client_id: '11111111-1111-1111-1111-111111111111' }, 'client_id')).toBeNull();
  });

  it('início do período em UTC', () => {
    const agora = new Date('2026-08-15T12:00:00Z');
    expect(inicioDoPeriodo('month', agora)).toBe('2026-08-01');
    expect(inicioDoPeriodo('quarter', agora)).toBe('2026-07-01');
    expect(inicioDoPeriodo('year', agora)).toBe('2026-01-01');
    expect(inicioDoPeriodo('semana', agora)).toBe('2026-08-01');
  });
});

describe('prompts e auxiliares de resposta', () => {
  it('prompt do assistente: identidade, versões, regra do módulo, contexto delimitado e documento', () => {
    const p = promptSistemaAssistente({ module: 'finance', crmContext: 'ctx <b>', fileContext: 'doc' });
    expect(p).toContain('Você é a assistente operacional da Lotti');
    expect(p).toContain(`Versões: ${VERSOES_PROMPT_IA.core}; ${VERSOES_PROMPT_IA.assistant}`);
    expect(p).toContain('Regra do módulo: Use valores do sistema');
    expect(p).toContain('<external_data kind="crm_context">\nctx &lt;b&gt;\n</external_data>');
    expect(p).toContain('Quando houver documento anexado:');
    expect(p).toContain('<external_data kind="uploaded_document">\ndoc\n</external_data>');
    expect(promptSistemaAssistente({ module: 'assistant', crmContext: 'c' })).not.toContain('Regra do módulo');
  });

  it('prompt do WhatsApp traduz tipo e tom como a função', () => {
    const p = promptUsuarioWhatsapp({ clientName: ' Ana ', messageType: 'late', tone: 'formal', details: { amount: 'R$ 1' } });
    expect(p).toContain('<external_data kind="whatsapp_request">');
    expect(p).toContain('{"clientName":"Ana","messageType":"Cobrança de Atraso","tone":"Profissional","details":{"amount":"R$ 1"}}');
    expect(promptUsuarioWhatsapp({ clientName: 'A', messageType: 'x', tone: 'x', details: '' })).toContain('"messageType":"Outro","tone":"Incisivo"');
  });

  it('histórico para o provedor: mais antigo primeiro, tool e tool_calls preservados', () => {
    expect(mensagensDoHistorico('S', [
      { role: 'assistant', content: 'fim', tool_calls: null, tool_name: null },
      { role: 'tool', content: '{}', tool_calls: null, tool_name: 'call_1' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1' }], tool_name: null },
      { role: 'user', content: 'oi', tool_calls: null, tool_name: null },
    ])).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1' }] },
      { role: 'tool', content: '{}', tool_call_id: 'call_1' },
      { role: 'assistant', content: 'fim' },
    ]);
  });

  it('parâmetros de realce limitados, classificação com uma entrada por foto, cadastro público e entrada da sugestão', () => {
    expect(limitarParametros({ brightness: 9, warmth: -99 })).toEqual({ ...PARAMETROS_PADRAO, brightness: 1.3, warmth: -20 });
    expect(sanitizarClassificacao({ fotos: [{ indice: 1, categoria: 'cozinha' }, { indice: '0', categoria: 'xyz' }, { indice: 9 }], descricao_sugerida: ' Bela casa ' }, 3))
      .toEqual({ fotos: [{ indice: 0, categoria: 'OUTRO' }, { indice: 1, categoria: 'COZINHA' }, { indice: 2, categoria: 'OUTRO' }], descricao_sugerida: 'Bela casa' });
    expect(contextoPublicoImovel({ id: '1', titulo: 'T', proprietario_nome: 'X', endereco: 'Rua' })).toEqual({ id: '1', titulo: 'T' });
    expect(validarEntradaSugestao({ propertyId: CLIENTE, question: ' tem vaga? ' })).toEqual({ propertyId: CLIENTE, question: 'tem vaga?' });
    expect(() => validarEntradaSugestao({ propertyId: 'x', question: 'a' })).toThrow();
    expect(() => validarEntradaSugestao({ propertyId: CLIENTE, question: 'a'.repeat(2001) })).toThrow();
  });

  it('estimativa de uso com os preços padrão', () => {
    const anterior = { ...process.env };
    delete process.env.LOTTI_AI_INPUT_USD_PER_MTOK;
    delete process.env.LOTTI_AI_OUTPUT_USD_PER_MTOK;
    const uso = estimarUso(4_000_000, 400_000);
    expect(uso).toMatchObject({ inputTokens: 1_000_000, outputTokens: 100_000 });
    expect(uso.estimatedCostUsd).toBeCloseTo(0.55, 10);
    process.env = anterior;
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import {
  CriarFachadaDto, CriarTemplateDto, EditarFachadaDto, FORMATO_UUID, LIMITE_LISTA, ListarLeadsDto,
  ListarTemplatesDto, MetricasDto, PorImagemDto,
} from './fachadas.dto';
import { EnviarLeadDto } from './publico/fachadas-publico.dto';

const OPCOES = { whitelist: true, forbidNonWhitelisted: true };
const IMOVEL = '22222222-2222-4222-8222-222222222222';

type Classe = new () => object;
const CLASSES: Array<[string, Classe]> = [
  ['CriarFachadaDto', CriarFachadaDto], ['EditarFachadaDto', EditarFachadaDto], ['ListarLeadsDto', ListarLeadsDto],
  ['MetricasDto', MetricasDto], ['ListarTemplatesDto', ListarTemplatesDto], ['CriarTemplateDto', CriarTemplateDto],
  ['PorImagemDto', PorImagemDto], ['EnviarLeadDto', EnviarLeadDto],
];

function erros(Classe: Classe, corpo: Record<string, unknown>): ValidationError[] {
  return validateSync(plainToInstance(Classe, corpo), OPCOES);
}
const propriedades = (Classe: Classe, corpo: Record<string, unknown>) => erros(Classe, corpo).map((e) => e.property).sort();
const mensagens = (Classe: Classe, corpo: Record<string, unknown>) => erros(Classe, corpo).flatMap((e) => Object.values(e.constraints ?? {}));

const criar = (extra: Record<string, unknown> = {}) => ({
  imovel_id: IMOVEL, tipo_negocio: 'VENDA', template_id: 'venda-classica', cta_principal: 'WHATSAPP',
  modo_conversao: false, ...extra,
});

describe('LIMITE_LISTA e FORMATO_UUID', () => {
  it('LIMITE_LISTA é o max-rows do PostgREST', () => {
    expect(LIMITE_LISTA).toBe(1000);
  });

  it('FORMATO_UUID tem a mesma paridade do ParseUUIDPipe sem versão', () => {
    expect(FORMATO_UUID.test('11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(FORMATO_UUID.test('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(true);
    expect(FORMATO_UUID.test('nao-e-uuid')).toBe(false);
    expect(FORMATO_UUID.test('')).toBe(false);
    expect(FORMATO_UUID.test(`${IMOVEL} `)).toBe(false);
  });
});

describe('CriarFachadaDto', () => {
  it('aceita o corpo mínimo e os opcionais', () => {
    expect(propriedades(CriarFachadaDto, criar())).toEqual([]);
    expect(propriedades(CriarFachadaDto, criar({
      mensagem_whatsapp: 'olá', mensagem_contato: 'oi', logo_url: 'https://host/l.png',
      foto_principal_url: 'https://host/f.jpg', ativo: true,
    }))).toEqual([]);
  });

  it('exige os cinco campos obrigatórios', () => {
    expect(propriedades(CriarFachadaDto, {})).toEqual(['cta_principal', 'imovel_id', 'modo_conversao', 'template_id', 'tipo_negocio']);
  });

  it('tipo_negocio e cta_principal repetem os checks do banco', () => {
    expect(propriedades(CriarFachadaDto, criar({ tipo_negocio: 'PERMUTA' }))).toEqual(['tipo_negocio']);
    expect(propriedades(CriarFachadaDto, criar({ cta_principal: 'LIGAR' }))).toEqual(['cta_principal']);
    for (const t of ['VENDA', 'ALUGUEL', 'TEMPORADA', 'LANCAMENTO']) expect(propriedades(CriarFachadaDto, criar({ tipo_negocio: t }))).toEqual([]);
    for (const c of ['AGENDAR_VISITA', 'WHATSAPP', 'SOLICITAR_INFO', 'FAZER_PROPOSTA']) {
      expect(propriedades(CriarFachadaDto, criar({ cta_principal: c }))).toEqual([]);
    }
  });

  it('template_id aceita até 2048 (hoje guarda a URL da arte) e não tem lista fechada', () => {
    expect(propriedades(CriarFachadaDto, criar({ template_id: `https://host/${'a'.repeat(2000)}` }))).toEqual([]);
    expect(propriedades(CriarFachadaDto, criar({ template_id: 'a'.repeat(2049) }))).toEqual(['template_id']);
    expect(propriedades(CriarFachadaDto, criar({ template_id: '' }))).toEqual(['template_id']);
  });

  it('mensagens espelham o check de 600 do banco', () => {
    expect(propriedades(CriarFachadaDto, criar({ mensagem_contato: 'a'.repeat(601) }))).toEqual(['mensagem_contato']);
    expect(propriedades(CriarFachadaDto, criar({ mensagem_whatsapp: 'a'.repeat(601) }))).toEqual(['mensagem_whatsapp']);
    expect(propriedades(CriarFachadaDto, criar({ mensagem_contato: 'a'.repeat(600) }))).toEqual([]);
  });

  it('recusa as colunas que o cliente nunca manda', () => {
    for (const chave of ['id', 'corretor_id', 'total_escaneamentos', 'total_leads', 'created_at']) {
      expect(propriedades(CriarFachadaDto, criar({ [chave]: 'x' }))).toEqual([chave]);
    }
  });
});

describe('EditarFachadaDto', () => {
  it('corpo vazio é válido (quem recusa é o service com nada_para_atualizar)', () => {
    expect(propriedades(EditarFachadaDto, {})).toEqual([]);
  });

  it('não aceita imovel_id: trocar o imóvel mudaria o que o QR mostra sem mudar o QR', () => {
    expect(propriedades(EditarFachadaDto, { imovel_id: IMOVEL })).toEqual(['imovel_id']);
  });

  it('recusa id, corretor_id e os contadores', () => {
    for (const chave of ['id', 'corretor_id', 'total_escaneamentos', 'total_leads', 'created_at']) {
      expect(propriedades(EditarFachadaDto, { [chave]: 'x' })).toEqual([chave]);
    }
  });
});

describe('ListarLeadsDto, MetricasDto, ListarTemplatesDto, CriarTemplateDto e PorImagemDto', () => {
  it('fachada_id é opcional e segue FORMATO_UUID', () => {
    expect(propriedades(ListarLeadsDto, {})).toEqual([]);
    expect(propriedades(ListarLeadsDto, { fachada_id: IMOVEL })).toEqual([]);
    expect(propriedades(ListarLeadsDto, { fachada_id: 'x' })).toEqual(['fachada_id']);
  });

  it('dias vem da query como texto e é convertido; fora de 1..365 é recusado', () => {
    expect(propriedades(MetricasDto, {})).toEqual([]);
    expect(plainToInstance(MetricasDto, { dias: '30' }).dias).toBe(30);
    expect(propriedades(MetricasDto, { dias: '7' })).toEqual([]);
    for (const v of ['0', '366', 'abc', '1.5']) expect(propriedades(MetricasDto, { dias: v })).toEqual(['dias']);
  });

  it('escopo só aceita meus ou todos', () => {
    expect(propriedades(ListarTemplatesDto, {})).toEqual([]);
    for (const e of ['meus', 'todos']) expect(propriedades(ListarTemplatesDto, { escopo: e })).toEqual([]);
    expect(propriedades(ListarTemplatesDto, { escopo: 'outros' })).toEqual(['escopo']);
  });

  it('template: nome, categoria do check do banco, config objeto e padrao opcional', () => {
    const base = { nome: 'Arte', categoria: 'VENDA', config: { imagem_url: 'x' } };
    expect(propriedades(CriarTemplateDto, base)).toEqual([]);
    expect(propriedades(CriarTemplateDto, {})).toEqual(['categoria', 'config', 'nome']);
    expect(propriedades(CriarTemplateDto, { ...base, categoria: 'OUTRA' })).toEqual(['categoria']);
    for (const c of ['VENDA', 'ALUGUEL', 'ALTO_PADRAO', 'COMERCIAL', 'RURAL', 'LANCAMENTO']) {
      expect(propriedades(CriarTemplateDto, { ...base, categoria: c })).toEqual([]);
    }
    expect(propriedades(CriarTemplateDto, { ...base, config: 'texto' })).toEqual(['config']);
    expect(propriedades(CriarTemplateDto, { ...base, nome: 'a'.repeat(121) })).toEqual(['nome']);
    expect(propriedades(CriarTemplateDto, { ...base, corretor_id: IMOVEL })).toEqual(['corretor_id']);
  });

  it('imagem_url é obrigatório e limitado a 2048', () => {
    expect(propriedades(PorImagemDto, { imagem_url: 'https://host/a.png' })).toEqual([]);
    expect(propriedades(PorImagemDto, {})).toEqual(['imagem_url']);
    expect(propriedades(PorImagemDto, { imagem_url: 'a'.repeat(2049) })).toEqual(['imagem_url']);
  });
});

describe('todas as mensagens dos DTOs estão em português', () => {
  const INGLES = /\b(must|should|cannot|invalid value|each value|property|longer|shorter|string|boolean|number|array|object|empty|exist|allowed)\b/i;

  it('nenhum constraint devolve texto em inglês', () => {
    const corpos: Array<[Classe, Record<string, unknown>]> = [
      [CriarFachadaDto, {}],
      [CriarFachadaDto, criar({ tipo_negocio: 'X', cta_principal: 'X', template_id: '', modo_conversao: 'nao', ativo: 'sim', mensagem_contato: 'a'.repeat(601), logo_url: 1, foto_principal_url: 1, mensagem_whatsapp: 1 })],
      [CriarFachadaDto, criar({ imovel_id: 'x' })],
      [EditarFachadaDto, { tipo_negocio: 'X', cta_principal: 'X', modo_conversao: 1, ativo: 1, template_id: '', logo_url: 1 }],
      [ListarLeadsDto, { fachada_id: 'x' }],
      [MetricasDto, { dias: '0' }],
      [MetricasDto, { dias: 'abc' }],
      [ListarTemplatesDto, { escopo: 'x' }],
      [CriarTemplateDto, {}],
      [CriarTemplateDto, { nome: 'a'.repeat(121), categoria: 'X', config: 'x', padrao: 'x' }],
      [PorImagemDto, { imagem_url: '' }],
      [EnviarLeadDto, {}],
      [EnviarLeadDto, { nome: ' a ', telefone: 'abc', email: 'sem-arroba' }],
      [EnviarLeadDto, { nome: 'a'.repeat(121), telefone: '1'.repeat(33), email: `${'a'.repeat(250)}@b.co` }],
    ];
    const todas = corpos.flatMap(([Classe, corpo]) => mensagens(Classe, corpo));
    expect(todas.length).toBeGreaterThan(20);
    for (const m of todas) expect(m).not.toMatch(INGLES);
  });

  it('cada DTO tem ao menos uma mensagem própria e nenhuma fica vazia', () => {
    for (const [, Classe] of CLASSES) {
      const ms = mensagens(Classe, { lixo: 'x' });
      for (const m of ms) expect(String(m).trim()).not.toBe('');
    }
  });
});

describe('nenhum DTO usa IsUUID', () => {
  it('a varredura dos arquivos de DTO não acha IsUUID', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    for (const arquivo of [`${__dirname}/fachadas.dto.ts`, `${__dirname}/publico/fachadas-publico.dto.ts`]) {
      expect(readFileSync(arquivo, 'utf8')).not.toContain('IsUUID');
    }
  });
});

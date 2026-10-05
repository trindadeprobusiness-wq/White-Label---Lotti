import { Prisma } from '@prisma/client';
import { EnviarLeadDto } from './fachadas-publico.dto';
import { FachadasPublicoRepo } from './fachadas-publico.repo';

const FACHADA = '11111111-1111-4111-8111-111111111111';

/** Chaves exatas da allowlist pública (contrato §2.1). Nem uma a mais. */
export const CHAVES_FACHADA_PUBLICA = ['id', 'corretor_id', 'imovel_id', 'tipo_negocio', 'template_id', 'cta_principal',
  'modo_conversao', 'mensagem_whatsapp', 'logo_url', 'foto_principal_url', 'ativo', 'created_at', 'imovel', 'corretor'];
export const CHAVES_IMOVEL_PUBLICO = ['id', 'titulo', 'tipo', 'valor', 'area_m2', 'dormitorios', 'banheiros', 'garagem',
  'endereco', 'bairro', 'cidade', 'estado', 'descricao'];
export const CHAVES_CORRETOR_PUBLICO = ['nome', 'telefone', 'email', 'creci', 'foto_url', 'razao_social'];
export const CHAVES_FOTO_PUBLICA = ['id', 'arquivo_url', 'principal'];

function montar() {
  const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn(async () => 1), $executeRawUnsafe: jest.fn(async () => 0) };
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (w: (t: typeof tx) => unknown) => w(tx)),
  };
  return { tx, prisma, repo: new FachadasPublicoRepo(prisma as never) };
}

/** Aceita as duas formas do Prisma: tag function (`$executeRaw\`...\``) e Prisma.sql pronto. */
function sqlDe(m: jest.Mock, i: number): Prisma.Sql {
  const [primeiro, ...resto] = m.mock.calls[i];
  if (Array.isArray(primeiro) && 'raw' in primeiro) return Prisma.sql(primeiro as unknown as TemplateStringsArray, ...resto);
  return primeiro as Prisma.Sql;
}
const textoDe = (m: jest.Mock, i: number) => sqlDe(m, i).text.replace(/\s+/g, ' ').trim();
const todosOsTextos = (m: jest.Mock) => m.mock.calls.map((_c, i) => textoDe(m, i));

/**
 * Lê as chaves do PRIMEIRO nível de um jsonb_build_object no texto da consulta, respeitando parênteses:
 * as chaves dos objetos aninhados (imovel, corretor) não contam aqui.
 */
export function chavesDe(texto: string, apos: string): string[] {
  const inicio = texto.indexOf(apos);
  expect(inicio).toBeGreaterThanOrEqual(0);
  const corpo = texto.slice(inicio + apos.length);
  const chaves: string[] = [];
  let profundidade = 0;
  for (let i = 0; i < corpo.length; i += 1) {
    const c = corpo[i];
    if (c === '(') profundidade += 1;
    else if (c === ')') {
      if (profundidade === 0) break; // fecha o jsonb_build_object deste nível
      profundidade -= 1;
    } else if (c === "'" && profundidade === 0) {
      const fim = corpo.indexOf("'", i + 1);
      const valor = corpo.slice(i + 1, fim);
      // Só conta quando é chave: vem seguida de vírgula.
      if (corpo[fim + 1] === ',') chaves.push(valor);
      i = fim;
    }
  }
  return chaves;
}

describe('FachadasPublicoRepo P1 verFachada', () => {
  it('lê como dono do banco, sem transação e sem troca de role', async () => {
    const { prisma, repo } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([{ fachada: { id: FACHADA }, fotos: [] }]);
    expect(await repo.verFachada(FACHADA)).toEqual({ fachada: { id: FACHADA }, fotos: [] });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(sqlDe(prisma.$queryRaw, 0).values).toEqual([FACHADA]);
  });

  it('filtra por id e ativo = true, sem select * e sem to_jsonb da linha', async () => {
    const { prisma, repo } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    expect(await repo.verFachada(FACHADA)).toBeNull();
    const t = textoDe(prisma.$queryRaw, 0);
    expect(t).toContain('from public.fachadas f where f.id = $1::uuid and f.ativo = true');
    expect(t).not.toContain('select *');
    expect(t).not.toContain('to_jsonb(f)');
    expect(t).not.toMatch(/\$\d+(?!\d|::)/);
  });

  it('a allowlist de colunas é exatamente a da Edge Function, caractere a caractere', async () => {
    const { prisma, repo } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await repo.verFachada(FACHADA);
    const t = textoDe(prisma.$queryRaw, 0);
    expect(chavesDe(t, 'select jsonb_build_object(')).toEqual(CHAVES_FACHADA_PUBLICA);
    expect(chavesDe(t, "'imovel', (select jsonb_build_object(")).toEqual(CHAVES_IMOVEL_PUBLICO);
    expect(chavesDe(t, "'corretor', (select jsonb_build_object(")).toEqual(CHAVES_CORRETOR_PUBLICO);
    expect(chavesDe(t, 'jsonb_agg(jsonb_build_object(')).toEqual(CHAVES_FOTO_PUBLICA);
    expect(t).toContain('order by p.ordem asc nulls last, p.id');
    expect(t).toContain("'[]'::jsonb) as fotos");
  });

  it('nenhuma coluna de proprietário nem contador aparece em rota pública', async () => {
    const { prisma, repo } = montar();
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const { tx, repo: outro } = montar();
    await repo.verFachada(FACHADA);
    await outro.registrarEscaneamento(FACHADA, 'ua');
    await outro.criarLead(FACHADA, Object.assign(new EnviarLeadDto(), { nome: 'Ana', telefone: '11999998888' }));
    const textos = [textoDe(prisma.$queryRaw, 0), ...todosOsTextos(tx.$executeRaw)];
    expect(textos).toHaveLength(5); // P1 + (set_config + insert) x 2
    for (const t of textos) {
      for (const proibida of ['mensagem_contato', 'total_escaneamentos', 'total_leads',
        'proprietario_cpf', 'proprietario_nome', 'proprietario_telefone', 'proprietario_email']) {
        expect(t).not.toContain(proibida);
      }
    }
  });
});

describe('FachadasPublicoRepo: escrita como anon', () => {
  it('P2 grava fachada_id e user_agent sem RETURNING, dentro de set local role anon', async () => {
    const { tx, prisma, repo } = montar();
    await repo.registrarEscaneamento(FACHADA, 'Mozilla/5.0');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(textoDe(tx.$executeRaw, 0)).toContain("select set_config('request.jwt.claims', $1, true)");
    expect(sqlDe(tx.$executeRaw, 0).values).toEqual(['{"role":"anon"}']);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('set local role anon');
    const t = textoDe(tx.$executeRaw, 1);
    expect(t).toBe('insert into public.fachada_escaneamentos (fachada_id, user_agent) values ($1::uuid, $2::text)');
    expect(sqlDe(tx.$executeRaw, 1).values).toEqual([FACHADA, 'Mozilla/5.0']);
    expect(t).not.toContain('returning');
    expect(t).not.toContain('ip_hash');
    expect(t).not.toContain('created_at');
  });

  it('P2 com cabeçalho ausente grava null', async () => {
    const { tx, repo } = montar();
    await repo.registrarEscaneamento(FACHADA, null);
    expect(sqlDe(tx.$executeRaw, 1).values).toEqual([FACHADA, null]);
  });

  it('P3 grava só quatro colunas e o telefone como digitado', async () => {
    const { tx, repo } = montar();
    const dto = Object.assign(new EnviarLeadDto(), { nome: 'Ana Souza', telefone: '(11) 99999-8888' });
    await repo.criarLead(FACHADA, dto);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('set local role anon');
    const t = textoDe(tx.$executeRaw, 1);
    expect(t).toBe('insert into public.fachada_leads (fachada_id, nome, telefone, email) values ($1::uuid, $2::text, $3::text, $4::text)');
    expect(sqlDe(tx.$executeRaw, 1).values).toEqual([FACHADA, 'Ana Souza', '(11) 99999-8888', null]);
    for (const proibida of ['convertido', 'cliente_id', 'created_at', 'ip_hash', 'returning']) expect(t).not.toContain(proibida);
  });

  it('P3 com e-mail repassa o e-mail', async () => {
    const { tx, repo } = montar();
    await repo.criarLead(FACHADA, Object.assign(new EnviarLeadDto(), { nome: 'Ana', telefone: '11999998888', email: 'ana@x.com' }));
    expect(sqlDe(tx.$executeRaw, 1).values[3]).toBe('ana@x.com');
  });

  it('$executeRawUnsafe é chamado uma vez por escrita, sempre com a mesma string constante', async () => {
    const { tx, repo } = montar();
    await repo.registrarEscaneamento(FACHADA, 'ua');
    await repo.criarLead(FACHADA, Object.assign(new EnviarLeadDto(), { nome: 'Ana', telefone: '11999998888' }));
    expect(tx.$executeRawUnsafe.mock.calls).toEqual([['set local role anon'], ['set local role anon']]);
  });
});

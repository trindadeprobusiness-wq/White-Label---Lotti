import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Um cliente por telefone em cada conta.
 *
 * Todo cadastro de cliente passa pelo banco: crm_criar_cliente (CRM),
 * crm_converter_lead (leads das fachadas), lead_capture_upsert_cliente
 * (captura pública) e lotti_find_or_create_cliente (Edge Functions). Elas
 * procuram o telefone em qualquer grafia sob a mesma trava antes de criar.
 * Um `.from('clientes').insert(` novo pularia essa busca e recriaria o
 * duplicado que o gatilho do banco recusa com `duplicate_client_phone`.
 *
 * A lista de exceções é vazia de propósito: se um fluxo novo precisar criar
 * cliente, ele chama uma dessas RPCs.
 */
const EXCECOES: string[] = [];
const PASTAS = ['src', 'supabase/functions'];
const INSERT_EM_CLIENTES = /\.from\(\s*(['"`])clientes\1\s*\)\s*\.(insert|upsert)\s*\(/;

function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return nome === 'node_modules' ? [] : arquivos(caminho);
    // Testes simulam o banco; o que importa é o código que roda de verdade.
    return /\.(ts|tsx|js|mjs)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

describe('cadastro de cliente só pelas RPCs do banco', () => {
  it('a verificação reconhece um insert direto, mesmo quebrado em linhas', () => {
    expect(INSERT_EM_CLIENTES.test("await db.from('clientes')\n  .insert({ nome })")).toBe(true);
    expect(INSERT_EM_CLIENTES.test('supabase.from("clientes").upsert(dados)')).toBe(true);
    expect(INSERT_EM_CLIENTES.test("db.from('clientes').update({ cpf })")).toBe(false);
    expect(INSERT_EM_CLIENTES.test("db.from('cliente_imovel').insert({})")).toBe(false);
  });

  it('src/ e supabase/functions/ não inserem em clientes direto', () => {
    const encontrados = PASTAS.flatMap(arquivos)
      .map((caminho) => relative('.', caminho).replace(/\\/g, '/'))
      .filter((caminho) => !EXCECOES.includes(caminho))
      .filter((caminho) => INSERT_EM_CLIENTES.test(readFileSync(caminho, 'utf8')));
    expect(encontrados).toEqual([]);
  });
});

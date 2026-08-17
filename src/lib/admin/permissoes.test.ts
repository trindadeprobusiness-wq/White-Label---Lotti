/**
 * Trava a hierarquia admin × super_admin.
 *
 * O caso que estes testes existem para impedir: um `admin` operacional
 * conseguindo `conceder_papel`. Se isso passar, ele se promove a super_admin e
 * os dois níveis viram um só — que é exatamente o que a policy de INSERT em
 * user_roles (`WITH CHECK (is_super_admin())`) impede no banco. Aqui garantimos
 * que a interface concorda com o banco, em vez de oferecer um botão que o
 * servidor vai recusar.
 */
import { describe, it, expect } from 'vitest';
import {
  ehAdmin,
  ehSuperAdmin,
  podeAcessar,
  podeExecutar,
  recursosVisiveis,
} from './permissoes';

describe('ehAdmin', () => {
  it('qualquer papel administrativo abre o back office', () => {
    expect(ehAdmin(['admin'])).toBe(true);
    expect(ehAdmin(['super_admin'])).toBe(true);
  });

  it('sem papel, sem back office', () => {
    expect(ehAdmin([])).toBe(false);
    expect(ehAdmin(null)).toBe(false);
    expect(ehAdmin(undefined)).toBe(false);
  });

  it('papel desconhecido não vira acesso', () => {
    // Defesa contra a RPC devolver algo inesperado — um enum novo no banco não
    // pode virar permissão só por existir na string.
    expect(ehAdmin(['corretor'])).toBe(false);
    expect(ehAdmin(['ADMIN'])).toBe(false);
    expect(ehAdmin(['admin '])).toBe(false);
  });
});

describe('ehSuperAdmin', () => {
  it('admin não é super_admin', () => {
    expect(ehSuperAdmin(['admin'])).toBe(false);
  });

  it('reconhece o super_admin mesmo acompanhado', () => {
    expect(ehSuperAdmin(['admin', 'super_admin'])).toBe(true);
  });
});

describe('podeAcessar', () => {
  it('super_admin acumula os recursos de admin', () => {
    // Quem pode tudo pode o menos: nenhuma tela de admin some do super_admin.
    for (const r of recursosVisiveis(['admin'])) {
      expect(podeAcessar(['super_admin'], r)).toBe(true);
    }
  });

  it('configurações da plataforma só para super_admin', () => {
    expect(podeAcessar(['admin'], 'configuracoes')).toBe(false);
    expect(podeAcessar(['super_admin'], 'configuracoes')).toBe(true);
  });

  it('usuário sem papel não acessa nem a visão geral', () => {
    expect(podeAcessar([], 'visao_geral')).toBe(false);
    expect(podeAcessar(null, 'usuarios')).toBe(false);
  });
});

describe('podeExecutar', () => {
  it('admin NÃO concede nem revoga papéis', () => {
    // O teste central deste arquivo. Ver o comentário do topo.
    expect(podeExecutar(['admin'], 'conceder_papel')).toBe(false);
    expect(podeExecutar(['admin'], 'revogar_papel')).toBe(false);
    expect(podeExecutar(['super_admin'], 'conceder_papel')).toBe(true);
  });

  it('admin opera parceiros e aprova comissão, mas não paga nem estorna', () => {
    // Aprovar é conferência; pagar e estornar movem dinheiro e sobem de nível.
    expect(podeExecutar(['admin'], 'criar_parceiro')).toBe(true);
    expect(podeExecutar(['admin'], 'alterar_percentual')).toBe(true);
    expect(podeExecutar(['admin'], 'aprovar_comissao')).toBe(true);

    expect(podeExecutar(['admin'], 'pagar_comissao')).toBe(false);
    expect(podeExecutar(['admin'], 'estornar_comissao')).toBe(false);
  });

  it('registrar e estornar receita são exclusivos do super_admin', () => {
    // Enquanto não há gateway, a receita entra por lançamento manual. É o ponto
    // onde alguém poderia inventar faturamento, então fica no nível mais alto.
    expect(podeExecutar(['admin'], 'registrar_receita')).toBe(false);
    expect(podeExecutar(['admin'], 'estornar_receita')).toBe(false);
    expect(podeExecutar(['super_admin'], 'registrar_receita')).toBe(true);
  });

  it('sem papel, nenhuma ação', () => {
    expect(podeExecutar([], 'suspender_usuario')).toBe(false);
    expect(podeExecutar(undefined, 'exportar_dados')).toBe(false);
  });
});

describe('recursosVisiveis', () => {
  it('devolve lista vazia para quem não é admin — o menu some inteiro', () => {
    expect(recursosVisiveis([])).toEqual([]);
  });

  it('super_admin vê ao menos um recurso a mais que admin', () => {
    expect(recursosVisiveis(['super_admin']).length).toBeGreaterThan(
      recursosVisiveis(['admin']).length,
    );
  });

  it('a lista devolvida não é a interna — mutar o retorno não corrompe a matriz', () => {
    const primeira = recursosVisiveis(['admin']);
    primeira.push('configuracoes');
    expect(recursosVisiveis(['admin'])).not.toContain('configuracoes');
  });
});

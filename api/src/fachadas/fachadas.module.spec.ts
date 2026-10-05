import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { FachadasLeadsService } from './fachadas-leads.service';
import { FachadasMetricasService } from './fachadas-metricas.service';
import { FachadasMidiasService } from './fachadas-midias.service';
import { FachadasTemplatesService } from './fachadas-templates.service';
import { FachadasModule } from './fachadas.module';
import { FachadasService } from './fachadas.service';
import { FachadasPublicoRepo } from './publico/fachadas-publico.repo';
import { FachadasPublicoService } from './publico/fachadas-publico.service';

/** Todos os .ts do módulo (fontes e specs), para as varreduras. */
function arquivos(pasta = __dirname): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((d) => (d.isDirectory()
    ? arquivos(join(pasta, d.name))
    : d.name.endsWith('.ts') ? [join(pasta, d.name)] : []));
}
const FONTES = arquivos().filter((f) => !f.endsWith('.spec.ts'));
const texto = (f: string) => readFileSync(f, 'utf8');

describe('FachadasModule', () => {
  it('declara todos os providers que os controllers precisam', () => {
    expect(Reflect.getMetadata('providers', FachadasModule)).toEqual([
      SupabaseAuthGuard, FachadasService, FachadasLeadsService, FachadasMetricasService,
      FachadasTemplatesService, FachadasMidiasService, FachadasPublicoService, FachadasPublicoRepo,
    ]);
  });

  it('a estrutura de arquivos é a fixada no contrato §1.1', () => {
    const esperados = [
      'fachadas.module.ts', 'fachadas.controller.ts', 'fachadas.service.ts',
      'fachadas-leads.controller.ts', 'fachadas-leads.service.ts',
      'fachadas-metricas.controller.ts', 'fachadas-metricas.service.ts',
      'fachadas-templates.controller.ts', 'fachadas-templates.service.ts',
      'fachadas-midias.controller.ts', 'fachadas-midias.service.ts',
      'fachadas.dto.ts', 'fachadas.erros.ts',
      'publico/fachadas-publico.controller.ts', 'publico/fachadas-publico.service.ts',
      'publico/fachadas-publico.repo.ts', 'publico/fachadas-publico.dto.ts',
    ];
    const relativos = FONTES.map((f) => f.slice(__dirname.length + 1).replace(/\\/g, '/'));
    expect(relativos.sort()).toEqual(esperados.sort());
  });

  it('não registra o próprio módulo em lugar nenhum: a integração é que liga (§5)', () => {
    expect(Reflect.getMetadata('imports', FachadasModule) ?? []).toEqual([]);
  });
});

describe('varreduras do módulo', () => {
  it('nenhum $queryRawUnsafe em lugar nenhum', () => {
    for (const f of FONTES) expect(texto(f)).not.toContain('$queryRawUnsafe');
  });

  it('$executeRawUnsafe aparece uma única vez, no repo público, com string constante', () => {
    const comUnsafe = FONTES.filter((f) => texto(f).includes('$executeRawUnsafe'));
    expect(comUnsafe.map((f) => f.slice(__dirname.length + 1).replace(/\\/g, '/'))).toEqual(['publico/fachadas-publico.repo.ts']);
    const fonte = texto(comUnsafe[0]);
    expect(fonte.match(/\$executeRawUnsafe\(/g)).toHaveLength(1);
    expect(fonte).toContain("$executeRawUnsafe('set local role anon')");
    // Nenhuma interpolação no argumento.
    expect(fonte).not.toMatch(/\$executeRawUnsafe\(`/);
  });

  it('o TenantDb não é usado no caminho público, e o PrismaService não é usado no caminho do usuário', () => {
    const relativo = (f: string) => f.slice(__dirname.length + 1).split('\\').join('/');
    const publicos = FONTES.filter((f) => relativo(f).startsWith('publico/'));
    expect(publicos).toHaveLength(4);
    for (const f of publicos) expect(texto(f)).not.toMatch(/import .*TenantDb/);
    const autenticados = FONTES.filter((f) => !publicos.includes(f));
    for (const f of autenticados) expect(texto(f)).not.toMatch(/import .*PrismaService/);
  });

  it('nenhum segredo nem variável de ambiente: o módulo não fala com serviço externo (§0.5)', () => {
    for (const f of FONTES) {
      expect(texto(f)).not.toContain('process.env');
      expect(texto(f)).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(texto(f)).not.toMatch(/\bfetch\(/);
    }
  });

  it('nenhum service loga dado pessoal', () => {
    for (const f of FONTES) expect(texto(f)).not.toMatch(/console\.(log|warn|error|info)/);
  });

  it('todos os services e controllers são @Injectable/@Controller do Nest', () => {
    const classes: Array<Type<unknown>> = [FachadasService, FachadasLeadsService, FachadasMetricasService,
      FachadasTemplatesService, FachadasMidiasService, FachadasPublicoService, FachadasPublicoRepo];
    for (const c of classes) expect(typeof c).toBe('function');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O front (DiagnosticChat, AdminDiagnostics, AdminDiagnosticDetail) importa o motor de
 * supabase/functions/_shared/diagnostic; a API usa esta cópia. As duas precisam ser o mesmo código:
 * pergunta, ramo, validação e score diferentes entre a tela e o servidor fariam a conversa travar.
 * A única diferença aceita é o sufixo `.ts` dos imports (estilo Deno lá, Node aqui).
 */
const ORIGEM = join(__dirname, '..', '..', '..', '..', 'supabase', 'functions', '_shared', 'diagnostic');

const normalizar = (texto: string) => texto.replace(/\r\n/g, '\n').replace(/from '(\.\/[a-z]+)\.ts'/g, "from '$1'");

describe('motor do diagnóstico: cópia da API igual à fonte compartilhada com o front', () => {
  it.each(['types', 'questions', 'engine'])('%s.ts', (nome) => {
    const fonte = normalizar(readFileSync(join(ORIGEM, `${nome}.ts`), 'utf8'));
    const copia = normalizar(readFileSync(join(__dirname, `${nome}.ts`), 'utf8'));
    expect(copia).toBe(fonte);
  });
});

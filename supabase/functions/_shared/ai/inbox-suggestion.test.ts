import { describe, expect, it } from 'vitest';
import { publicPropertyContext, validateSuggestionInput } from './inbox-suggestion';
describe('Inbox suggestion boundaries', () => {
  it('excludes owner details, free text and unknown fields from model context', () => {
    const context = publicPropertyContext({ titulo: 'Apartamento', valor: 400000, proprietario_cpf: 'private', descricao: 'internal instructions', segredo: 'secret' });
    expect(context).toEqual({ titulo: 'Apartamento', valor: 400000 });
  });
  it('requires a specific property and bounded customer question', () => {
    expect(() => validateSuggestionInput({ propertyId: 'other', question: 'Preço?' })).toThrow();
    expect(() => validateSuggestionInput({ propertyId: '12345678-1234-1234-1234-123456789abc', question: 'a'.repeat(2001) })).toThrow();
    expect(validateSuggestionInput({ propertyId: '12345678-1234-1234-1234-123456789abc', question: ' Preço? ', corretorId: 'untrusted' })).toEqual({ propertyId: '12345678-1234-1234-1234-123456789abc', question: 'Preço?' });
  });
});

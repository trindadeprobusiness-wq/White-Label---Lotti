// Deliberately excludes owner data, exact address, documents and free-text notes.
export const PROPERTY_FIELDS = 'id,titulo,tipo,finalidade,valor,area_m2,dormitorios,garagem,suites,bairro,cidade,ativo';
export function publicPropertyContext(row: Record<string, unknown>) {
  return Object.fromEntries(PROPERTY_FIELDS.split(',').filter(key => key in row).map(key => [key, row[key]]));
}
export function validateSuggestionInput(body: Record<string, unknown>) {
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propertyId) || !question || question.length > 2000) throw new Error('Selecione um imóvel e escreva uma pergunta de até 2.000 caracteres.');
  return { propertyId, question };
}

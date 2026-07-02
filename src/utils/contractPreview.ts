// Utilitário leve de preview de contrato.
// Mantido separado de contractDocxService para que a página Jurídico não
// carregue a lib "docx" (~600 kB) junto com o preview — os geradores de
// arquivo são importados dinamicamente apenas no clique de download.
export function formatContractForPreview(text: string): string {
  // Remove any markdown-like formatting
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/`/g, "")
    .trim();
}

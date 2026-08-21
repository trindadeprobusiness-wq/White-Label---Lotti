export type FormatoImportacao = 'csv' | 'xlsx';
export type CampoClienteImportacao = 'nome' | 'telefone' | 'email' | 'origem' | 'interesse' | 'regiao';

export interface LinhaClienteImportacao {
  nome: string;
  telefone?: string;
  email?: string;
  origem?: string;
  interesse?: string;
  regiao?: string;
}

export interface PreviaImportacaoClientes {
  validas: LinhaClienteImportacao[];
  erros: Array<{ linha: number; motivo: string }>;
  permiteImportacaoParcial: boolean;
}

export function detectarFormato(nome: string): FormatoImportacao | null {
  const extensao = nome.trim().toLowerCase().split('.').pop();
  return extensao === 'csv' || extensao === 'xlsx' ? extensao : null;
}

function normalizarCabecalho(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SINONIMOS: Record<string, CampoClienteImportacao> = {
  nome: 'nome', nomecompleto: 'nome', cliente: 'nome',
  telefone: 'telefone', celular: 'telefone', whatsapp: 'telefone', fone: 'telefone',
  email: 'email', correioeletronico: 'email',
  origem: 'origem', fonte: 'origem', canal: 'origem',
  interesse: 'interesse', tipodeinteresse: 'interesse',
  regiao: 'regiao', cidade: 'regiao', localizacao: 'regiao',
};

export function mapearColunasClientes(cabecalhos: string[]): Record<string, CampoClienteImportacao> {
  const resultado: Record<string, CampoClienteImportacao> = {};
  for (const cabecalho of cabecalhos) {
    const destino = SINONIMOS[normalizarCabecalho(cabecalho)];
    if (destino) resultado[cabecalho] = destino;
  }
  return resultado;
}

function chaveContato(linha: LinhaClienteImportacao): string | null {
  const telefone = linha.telefone?.replace(/\D/g, '') ?? '';
  if (telefone) return `tel:${telefone}`;
  const email = linha.email?.trim().toLowerCase() ?? '';
  return email ? `email:${email}` : null;
}

export function validarPreviaClientes(linhas: LinhaClienteImportacao[]): PreviaImportacaoClientes {
  const validas: LinhaClienteImportacao[] = [];
  const erros: Array<{ linha: number; motivo: string }> = [];
  const contatos = new Set<string>();

  linhas.forEach((linha, indice) => {
    const numeroLinha = indice + 1;
    if (!linha.nome?.trim()) {
      erros.push({ linha: numeroLinha, motivo: 'Nome é obrigatório.' });
      return;
    }
    const contato = chaveContato(linha);
    if (!contato) {
      erros.push({ linha: numeroLinha, motivo: 'Telefone ou e-mail é obrigatório.' });
      return;
    }
    if (contatos.has(contato)) {
      erros.push({ linha: numeroLinha, motivo: 'Contato duplicado na planilha.' });
      return;
    }
    contatos.add(contato);
    validas.push({ ...linha, nome: linha.nome.trim() });
  });

  return { validas, erros, permiteImportacaoParcial: validas.length > 0 && erros.length > 0 };
}

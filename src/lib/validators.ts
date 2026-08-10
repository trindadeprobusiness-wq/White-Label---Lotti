import { z } from 'zod';

// Validação de CPF
export const validarCPF = (cpf: string): boolean => {
  const cleaned = cpf.replace(/\D/g, '');
  
  if (cleaned.length !== 11) return false;
  if (/^(\d)\1+$/.test(cleaned)) return false;
  
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned[9])) return false;
  
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned[10])) return false;
  
  return true;
};

// Validação de CNPJ
export const validarCNPJ = (cnpj: string): boolean => {
  const cleaned = cnpj.replace(/\D/g, '');
  
  if (cleaned.length !== 14) return false;
  if (/^(\d)\1+$/.test(cleaned)) return false;
  
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleaned[i]) * weights1[i];
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (digit1 !== parseInt(cleaned[12])) return false;
  
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cleaned[i]) * weights2[i];
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  if (digit2 !== parseInt(cleaned[13])) return false;
  
  return true;
};

// Formatação de CPF
export const formatarCPF = (value: string): string => {
  const cleaned = value.replace(/\D/g, '').slice(0, 11);
  return cleaned
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
};

// Formatação de CNPJ
export const formatarCNPJ = (value: string): string => {
  const cleaned = value.replace(/\D/g, '').slice(0, 14);
  return cleaned
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

// Formatação de CPF ou CNPJ
export const formatarCpfCnpj = (value: string): string => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 11) {
    return formatarCPF(cleaned);
  }
  return formatarCNPJ(cleaned);
};

// Formatação de telefone
export const formatarTelefone = (value: string): string => {
  let digitos = value.replace(/\D/g, '');
  // Número colado com código do país ("5562999998888"): tira o 55 ANTES de cortar.
  // Sem isso o slice(0, 11) preservava o prefixo e descartava o final do número,
  // gravando "(55) 62999-9988" — um telefone que não existe.
  if (digitos.length > 11 && digitos.startsWith('55')) digitos = digitos.slice(2);
  const cleaned = digitos.slice(0, 11);
  if (cleaned.length <= 10) {
    return cleaned
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }
  return cleaned
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
};

// Schema de validação do corretor
export const corretorSchema = z.object({
  nome: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  email: z.string().email('Email inválido'),
  telefone: z.string()
    .min(14, 'Telefone incompleto')
    .regex(/^\(\d{2}\) \d{4,5}-\d{4}$/, 'Formato: (00) 00000-0000'),
  creci: z.string()
    .min(4, 'CRECI deve ter pelo menos 4 caracteres')
    .regex(/^\d{4,6}(-?[A-Za-z])?$/, 'Formato: 123456 ou 123456-F'),
  creci_estado: z.string().length(2, 'Use a sigla do estado (ex: SP)'),
  endereco: z.string().optional(),
  website: z.string().url('URL inválida').optional().or(z.literal('')),
  razao_social: z.string().optional(),
  cnpj_cpf: z.string()
    .optional()
    .refine(
      (val) => {
        if (!val || val === '') return true;
        const cleaned = val.replace(/\D/g, '');
        if (cleaned.length === 11) return validarCPF(cleaned);
        if (cleaned.length === 14) return validarCNPJ(cleaned);
        return false;
      },
      { message: 'CPF ou CNPJ inválido' }
    ),
  endereco_completo: z.string().optional(),
});

export type CorretorFormData = z.infer<typeof corretorSchema>;

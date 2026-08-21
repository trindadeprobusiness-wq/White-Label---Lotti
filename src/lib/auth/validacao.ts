import { z } from 'zod';
import { validarCNPJ } from '@/lib/validators';

export const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
});

export const cadastroSchema = z.object({
  nome: z.string().trim().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  email: z.string().trim().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  cnpj: z.string().refine(validarCNPJ, 'CNPJ inválido'),
  telefone: z.string().refine(
    (valor) => {
      const quantidadeDeDigitos = valor.replace(/\D/g, '').length;
      return quantidadeDeDigitos === 10 || quantidadeDeDigitos === 11;
    },
    'Telefone inválido',
  ),
});

export const emailRecuperacaoSchema = z.string().trim().email('Informe um e-mail válido.');

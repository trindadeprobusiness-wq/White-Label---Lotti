import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { BuscaImoveisDto } from './busca-imoveis.dto';

export interface ImovelResumo {
  id: string;
  titulo: string;
  tipo: string;
  finalidade: string;
  valor: number;
  cidade: string;
  bairro: string | null;
  dormitorios: number | null;
  suites: number | null;
  garagem: number | null;
  areaM2: number | null;
}

// Projeção explícita: nada do proprietário nem endereço exato sai daqui.
const PROJECAO = {
  id: true, titulo: true, tipo: true, finalidade: true, valor: true, cidade: true,
  bairro: true, dormitorios: true, suites: true, garagem: true, areaM2: true,
} satisfies Prisma.ImovelSelect;

export function buildWhere(f: BuscaImoveisDto): Prisma.ImovelWhereInput {
  const where: Prisma.ImovelWhereInput = { ativo: true };
  if (f.cidade) where.cidade = { contains: f.cidade, mode: 'insensitive' };
  if (f.bairro) where.bairro = { contains: f.bairro, mode: 'insensitive' };
  if (f.tipo) where.tipo = f.tipo;
  // Quem procura venda também quer o imóvel anunciado para venda e locação.
  if (f.finalidade && f.finalidade !== 'AMBOS') where.finalidade = { in: [f.finalidade, 'AMBOS'] };
  if (f.valorMin !== undefined || f.valorMax !== undefined) {
    where.valor = {
      ...(f.valorMin !== undefined ? { gte: f.valorMin } : {}),
      ...(f.valorMax !== undefined ? { lte: f.valorMax } : {}),
    };
  }
  if (f.dormitoriosMin !== undefined) where.dormitorios = { gte: f.dormitoriosMin };
  return where;
}

@Injectable()
export class ImoveisService {
  constructor(private readonly db: TenantDb) {}

  async buscar(claims: SupabaseClaims, filtros: BuscaImoveisDto): Promise<ImovelResumo[]> {
    const rows = await this.db.run(claims, (tx) =>
      tx.imovel.findMany({ where: buildWhere(filtros), select: PROJECAO, orderBy: { valor: 'asc' }, take: filtros.limit ?? 20 }),
    );
    return rows.map((r) => ({
      ...r,
      valor: Number(r.valor),
      areaM2: r.areaM2 === null ? null : Number(r.areaM2),
    }));
  }
}

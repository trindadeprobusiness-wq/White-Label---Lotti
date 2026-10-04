import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AbrirPainelUsuario({ corretorId, ativo = true }: { corretorId: string; ativo?: boolean }) {
  if (!ativo) return null;
  return <Button variant="outline" size="sm" asChild>
    <a href={`/suporte/${corretorId}`} target="_blank" rel="noopener noreferrer">
      <ExternalLink className="mr-2 h-4 w-4" />Visualizar painel
    </a>
  </Button>;
}

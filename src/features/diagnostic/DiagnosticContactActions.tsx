import { Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { diagnosticContactLinks } from './contact-links';

export function DiagnosticContactActions({ lead, compact = false }: { lead: { name?: string | null; phone?: string | null; email?: string | null } | null; compact?: boolean }) {
  const links = diagnosticContactLinks(lead || {});
  if (!links.whatsapp && !links.email) return <span className="text-xs text-muted-foreground">Sem contato disponível</span>;
  return <div className="flex flex-wrap gap-2">
    {links.whatsapp && <Button asChild size="sm" variant={compact ? 'outline' : 'default'}><a href={links.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></Button>}
    {links.email && <Button asChild size="sm" variant="outline"><a href={links.email}><Mail className="mr-2 h-4 w-4" />E-mail</a></Button>}
  </div>;
}

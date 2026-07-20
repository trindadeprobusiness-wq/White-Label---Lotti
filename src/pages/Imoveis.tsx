import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Bed, Car, Ruler, Image, Megaphone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCRMStore } from '@/stores/crmStore';
import { TipoImovel, Imovel } from '@/types/crm';
import { NovoImovelDialog } from '@/components/imoveis/NovoImovelDialog';
import { supabase } from '@/integrations/supabase/client';

const tipoLabels: Record<TipoImovel, string> = {
  APARTAMENTO: 'Apartamento',
  CASA: 'Casa',
  COMERCIAL: 'Comercial',
  TERRENO: 'Terreno',
};

export default function Imoveis() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { imoveis } = useCRMStore();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [tipoFilter, setTipoFilter] = useState<string>('TODOS');
  const [statusAnuncioFilter, setStatusAnuncioFilter] = useState<string>('TODOS');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [imovelToEdit, setImovelToEdit] = useState<Imovel | null>(null);
  const [fotosPrincipais, setFotosPrincipais] = useState<Record<string, string>>({});

  // Fetch main photos for all properties
  useEffect(() => {
    const fetchFotosPrincipais = async () => {
      if (imoveis.length === 0) return;

      const { data } = await supabase
        .from('imovel_fotos')
        .select('imovel_id, arquivo_url')
        .in('imovel_id', imoveis.map(i => i.id))
        .eq('principal', true);

      if (data) {
        const fotosMap: Record<string, string> = {};
        data.forEach(f => { fotosMap[f.imovel_id] = f.arquivo_url; });
        setFotosPrincipais(fotosMap);
      }
    };
    fetchFotosPrincipais();
  }, [imoveis]);

  const filteredImoveis = imoveis.filter((imovel) => {
    const matchesSearch =
      imovel.titulo.toLowerCase().includes(search.toLowerCase()) ||
      imovel.bairro.toLowerCase().includes(search.toLowerCase()) ||
      imovel.endereco.toLowerCase().includes(search.toLowerCase());

    const matchesTipo = tipoFilter === 'TODOS' || imovel.tipo === tipoFilter;

    const matchesAnuncio = statusAnuncioFilter === 'TODOS' || 
                           (statusAnuncioFilter === 'ANUNCIADOS' && imovel.anunciado) ||
                           (statusAnuncioFilter === 'NAO_ANUNCIADOS' && !imovel.anunciado);

    return matchesSearch && matchesTipo && matchesAnuncio;
  });

  const formatPrice = (valor: number) => {
    if (valor > 10000) {
      return `R$ ${valor.toLocaleString('pt-BR')}`;
    }
    return `R$ ${valor.toLocaleString('pt-BR')}/mês`;
  };

  const isExclusividadeProxima = (date?: string) => {
    if (!date) return false;
    const diff = new Date(date).getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days <= 7 && days > 0;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Imóveis</h1>
          <p className="text-muted-foreground">
            {imoveis.length} imóveis cadastrados
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Novo Imóvel
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título, bairro ou endereço..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={tipoFilter} onValueChange={setTipoFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Tipo de imóvel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos os tipos</SelectItem>
            {Object.entries(tipoLabels).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusAnuncioFilter} onValueChange={setStatusAnuncioFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Status Anúncio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos (Ads)</SelectItem>
            <SelectItem value="ANUNCIADOS">Em Campanha (Ativos)</SelectItem>
            <SelectItem value="NAO_ANUNCIADOS">Não Anunciados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Property Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredImoveis.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-12 flex flex-col items-center gap-4 text-center text-muted-foreground">
              <p>
                {search || tipoFilter !== 'TODOS'
                  ? 'Nenhum imóvel encontrado com os filtros aplicados.'
                  : 'Nenhum imóvel cadastrado ainda.'}
              </p>
              {!search && tipoFilter === 'TODOS' && statusAnuncioFilter === 'TODOS' && (
                <Button onClick={() => setDialogOpen(true)} variant="outline">
                  <Plus className="w-4 h-4 mr-2" />
                  Cadastrar primeiro imóvel
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredImoveis.map((imovel) => (
            <Card
              key={imovel.id}
              className="hover:shadow-md transition-shadow overflow-hidden cursor-pointer"
              onClick={() => navigate(`/imoveis/${imovel.id}`)}
            >
              <div className="h-32 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center relative overflow-hidden">
                {fotosPrincipais[imovel.id] ? (
                  <img
                    src={fotosPrincipais[imovel.id]}
                    alt={imovel.titulo}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground/50">
                    <Image className="w-8 h-8" />
                    <span className="text-xs mb-1">Sem foto</span>
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      className="h-6 text-[10px] px-2 bg-background/50 hover:bg-background/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        setImovelToEdit(imovel);
                        setDialogOpen(true);
                      }}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Adicionar
                    </Button>
                  </div>
                )}
              </div>
              <CardContent className="p-4 space-y-3">
                <div>
                  <h3 className="font-semibold line-clamp-1">{imovel.titulo}</h3>
                  <p className="text-primary font-bold text-lg">
                    {formatPrice(imovel.valor)}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Ruler className="w-4 h-4" />
                    {imovel.area_m2}m²
                  </span>
                  <span className="flex items-center gap-1">
                    <Bed className="w-4 h-4" />
                    {imovel.dormitorios}
                  </span>
                  <span className="flex items-center gap-1">
                    <Car className="w-4 h-4" />
                    {imovel.garagem}
                  </span>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-1">
                  {imovel.endereco} - {imovel.bairro}
                </p>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex gap-2">
                    {imovel.exclusividade_ate && (
                      <Badge
                        variant={isExclusividadeProxima(imovel.exclusividade_ate) ? 'destructive' : 'outline'}
                        className="text-xs"
                      >
                        Exclusiva
                        {isExclusividadeProxima(imovel.exclusividade_ate) && ' ⚠️'}
                      </Badge>
                    )}
                    {imovel.anunciado && (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100/80 border-green-200 text-xs flex items-center gap-1">
                        <Megaphone className="w-3 h-3" /> Ads
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {imovel.clientes_interessados.length} interessados
                  </span>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImovelToEdit(imovel);
                    setDialogOpen(true);
                  }}
                >
                  Editar
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <NovoImovelDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setImovelToEdit(null);
        }}
        imovelToEdit={imovelToEdit}
      />
    </div>
  );
}

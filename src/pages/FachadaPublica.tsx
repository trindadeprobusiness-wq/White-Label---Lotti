import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle,
  Calendar,
  FileText,
  MapPin,
  Bed,
  Car,
  Ruler,
  Bath,
  Phone,
  Mail,
  ChevronLeft,
  ChevronRight,
  Loader2,
  User,
  Home,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFachadaPublica } from '@/hooks/useFachadaPublica';
import { CTA_LABELS, TIPO_NEGOCIO_LABELS } from '@/types/fachada';

export default function FachadaPublica() {
  const { fachadaId } = useParams<{ fachadaId: string }>();
  const {
    fachada,
    fotos,
    loading,
    leadCapturado,
    fetchFachadaPublica,
    registrarEscaneamento,
    enviarLead,
  } = useFachadaPublica();

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fotoAtual, setFotoAtual] = useState(0);

  useEffect(() => {
    if (fachadaId) {
      fetchFachadaPublica(fachadaId);
      registrarEscaneamento(fachadaId);
    }
  }, [fachadaId, fetchFachadaPublica, registrarEscaneamento]);

  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fachadaId || !nome.trim() || !telefone.trim()) return;

    setEnviando(true);
    const ok = await enviarLead(fachadaId, {
      nome: nome.trim(),
      telefone: telefone.trim(),
      email: email.trim() || undefined,
    });
    setEnviando(false);

    if (ok && fachada?.modo_conversao && fachada.corretor?.telefone) {
      const tel = fachada.corretor.telefone.replace(/\D/g, '');
      const msg =
        fachada.mensagem_whatsapp ||
        `Olá, tenho interesse no imóvel "${fachada.imovel?.titulo}".`;
      window.open(
        `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`,
        '_blank',
      );
    }
  };

  const formatPrice = (valor: number) => `R$ ${valor.toLocaleString('pt-BR')}`;

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  // Not found
  if (!fachada) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 text-center">
        <Home className="h-16 w-16 mb-4 opacity-30" />
        <h1 className="text-2xl font-bold mb-2">Imóvel não encontrado</h1>
        <p className="text-white/60">
          Este link pode ter expirado ou o imóvel foi removido.
        </p>
      </div>
    );
  }

  const imovel = fachada.imovel;
  const corretor = fachada.corretor;

  // ─── ETAPA 1: Captura de Lead ────────────────────────────
  if (!leadCapturado) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-primary/20 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header visual */}
            <div className="bg-gradient-to-r from-primary to-primary/80 p-6 text-white text-center">
              <div className="bg-white/20 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center backdrop-blur-sm">
                <Home className="h-8 w-8" />
              </div>
              <h1 className="text-xl font-bold mb-1">
                {imovel?.titulo ?? 'Imóvel Exclusivo'}
              </h1>
              {imovel?.valor && (
                <p className="text-2xl font-extrabold mt-1">
                  {formatPrice(imovel.valor)}
                </p>
              )}
              <span className="inline-block mt-2 text-xs bg-white/20 rounded-full px-3 py-1 backdrop-blur-sm">
                {TIPO_NEGOCIO_LABELS[fachada.tipo_negocio]}
              </span>
            </div>

            {/* Formulário */}
            <form onSubmit={handleSubmitLead} className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                Preencha seus dados para visualizar todas as informações do
                imóvel.
              </p>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="lead-nome" className="flex items-center gap-1.5 mb-1.5">
                    <User className="h-3.5 w-3.5" /> Nome *
                  </Label>
                  <Input
                    id="lead-nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Seu nome completo"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <Label htmlFor="lead-tel" className="flex items-center gap-1.5 mb-1.5">
                    <Phone className="h-3.5 w-3.5" /> Telefone *
                  </Label>
                  <Input
                    id="lead-tel"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="(62) 99999-0000"
                    type="tel"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="lead-email" className="flex items-center gap-1.5 mb-1.5">
                    <Mail className="h-3.5 w-3.5" /> E-mail{' '}
                    <span className="text-muted-foreground text-xs">(opcional)</span>
                  </Label>
                  <Input
                    id="lead-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    type="email"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold"
                disabled={enviando || !nome.trim() || !telefone.trim()}
              >
                {enviando ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  '🏠 Ver Imóvel'
                )}
              </Button>

              <p className="text-[10px] text-muted-foreground text-center flex items-center justify-center gap-1">
                <Shield className="h-3 w-3" /> Seus dados estão protegidos e
                não serão compartilhados.
              </p>
            </form>
          </div>

          {/* Corretor info */}
          {corretor && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-center mt-4 text-white/50 text-xs"
            >
              <p>{corretor.razao_social ?? corretor.nome}</p>
              <p>CRECI {corretor.creci}</p>
            </motion.div>
          )}
        </motion.div>
      </div>
    );
  }

  // ─── ETAPA 2: Página do Imóvel ──────────────────────────
  const allFotos = fotos.length > 0 ? fotos : [];
  const whatsappLink = corretor?.telefone
    ? `https://wa.me/55${corretor.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Olá, tenho interesse no imóvel "${imovel?.titulo}".`,
      )}`
    : '#';

  return (
    <div className="min-h-screen bg-background">
      {/* Hero / Gallery */}
      <div className="relative h-72 sm:h-96 bg-gradient-to-br from-slate-900 to-slate-700 overflow-hidden">
        <AnimatePresence mode="wait">
          {allFotos.length > 0 ? (
            <motion.img
              key={fotoAtual}
              src={allFotos[fotoAtual].arquivo_url}
              alt=""
              className="w-full h-full object-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Home className="h-20 w-20 text-white/20" />
            </div>
          )}
        </AnimatePresence>

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />

        {/* Nav arrows */}
        {allFotos.length > 1 && (
          <>
            <button
              onClick={() => setFotoAtual((p) => (p === 0 ? allFotos.length - 1 : p - 1))}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 backdrop-blur-sm text-white rounded-full p-2 hover:bg-black/60 transition"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => setFotoAtual((p) => (p === allFotos.length - 1 ? 0 : p + 1))}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 backdrop-blur-sm text-white rounded-full p-2 hover:bg-black/60 transition"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {allFotos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setFotoAtual(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === fotoAtual
                      ? 'w-6 bg-white'
                      : 'w-1.5 bg-white/40'
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {/* Badge tipo */}
        <div className="absolute top-4 left-4">
          <span className="bg-primary text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg">
            {TIPO_NEGOCIO_LABELS[fachada.tipo_negocio]}
          </span>
        </div>

        {/* Preço sobre a foto */}
        <div className="absolute bottom-4 left-4">
          <h1 className="text-white text-xl sm:text-2xl font-bold drop-shadow-lg">
            {imovel?.titulo}
          </h1>
          {imovel?.valor && (
            <p className="text-white text-2xl sm:text-3xl font-extrabold mt-1 drop-shadow-lg">
              {formatPrice(imovel.valor)}
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Specs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-4 gap-3"
        >
          {[
            { icon: Ruler, value: imovel?.area_m2, suffix: 'm²' },
            { icon: Bed, value: imovel?.dormitorios, suffix: 'quartos' },
            { icon: Bath, value: null, suffix: 'banh.' },
            { icon: Car, value: imovel?.garagem, suffix: 'vagas' },
          ].map((item, i) => (
            <div
              key={i}
              className="bg-muted/50 rounded-xl p-3 text-center space-y-1"
            >
              <item.icon className="h-5 w-5 mx-auto text-primary" />
              <p className="text-lg font-bold">{item.value ?? '—'}</p>
              <p className="text-[10px] text-muted-foreground">{item.suffix}</p>
            </div>
          ))}
        </motion.div>

        {/* Descrição */}
        {imovel?.descricao && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h2 className="text-lg font-semibold mb-2">Sobre o Imóvel</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {imovel.descricao}
            </p>
          </motion.div>
        )}

        {/* Localização */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-muted/30 rounded-xl p-4"
        >
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" /> Localização
          </h2>
          <p className="text-sm text-muted-foreground">
            {imovel?.endereco}
            {imovel?.bairro ? ` — ${imovel.bairro}` : ''}
            {imovel?.cidade ? `, ${imovel.cidade}` : ''}
          </p>
        </motion.div>

        {/* CTAs Fixos */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-3"
        >
          <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
            <Button className="w-full h-14 text-base font-semibold gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white">
              <MessageCircle className="h-5 w-5" />
              Falar no WhatsApp
            </Button>
          </a>

          <div className="grid grid-cols-2 gap-3">
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full h-12 gap-2">
                <Calendar className="h-4 w-4" />
                Agendar Visita
              </Button>
            </a>
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full h-12 gap-2">
                <FileText className="h-4 w-4" />
                Fazer Proposta
              </Button>
            </a>
          </div>
        </motion.div>

        {/* Corretor */}
        {corretor && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-muted/30 rounded-xl p-4 flex items-center gap-4"
          >
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              {corretor.foto_url ? (
                <img
                  src={corretor.foto_url}
                  alt=""
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : (
                <User className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{corretor.nome}</p>
              <p className="text-xs text-muted-foreground">
                {corretor.razao_social ?? 'Corretor de Imóveis'}
              </p>
              <p className="text-xs text-muted-foreground">
                CRECI {corretor.creci}
              </p>
            </div>
            <a
              href={`tel:${corretor.telefone}`}
              className="p-3 rounded-full bg-primary/10 hover:bg-primary/20 transition"
            >
              <Phone className="h-5 w-5 text-primary" />
            </a>
          </motion.div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground pb-6">
          © {new Date().getFullYear()}{' '}
          {corretor?.razao_social ?? 'Oliver Negócios Inteligentes'}. Todos os
          direitos reservados.
        </p>
      </div>
    </div>
  );
}

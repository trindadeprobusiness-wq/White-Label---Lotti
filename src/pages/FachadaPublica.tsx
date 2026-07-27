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
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFachadaPublica } from '@/hooks/useFachadaPublica';
import { CTA_LABELS, TIPO_NEGOCIO_LABELS } from '@/types/fachada';

/* ───── Stagger variants ───── */
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.3 },
  },
};
const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

/* ───── Minimal underline input ───── */
function UnderlineInput({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  const hasValue = typeof props.value === 'string' && props.value.length > 0;

  return (
    <motion.div variants={itemVariants} className="relative pt-5">
      {/* Floating label */}
      <label
        className={`
          absolute left-0 transition-all duration-300 pointer-events-none
          ${focused || hasValue
            ? 'top-0 text-[11px] text-white/60'
            : 'top-6 text-sm text-white/40'
          }
        `}
      >
        {label}
      </label>
      <input
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        className="
          w-full bg-transparent border-0 border-b border-white/20 
          text-white text-sm pb-2.5 pt-1 outline-none
          placeholder-transparent
          focus:border-amber-400/70
          transition-colors duration-300
        "
      />
      {/* Animated bottom line */}
      <motion.div
        className="absolute bottom-0 left-0 h-[1.5px] bg-amber-400"
        initial={false}
        animate={{ width: focused ? '100%' : '0%' }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      />
    </motion.div>
  );
}

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
  const [bgLoaded, setBgLoaded] = useState(false);

  useEffect(() => {
    if (fachadaId) {
      fetchFachadaPublica(fachadaId);
      registrarEscaneamento(fachadaId);
    }
  }, [fachadaId, fetchFachadaPublica, registrarEscaneamento]);

  // Pré-carregar imagem de fundo
  useEffect(() => {
    const url = fachada?.foto_principal_url || fotos?.[0]?.arquivo_url;
    if (url) {
      const img = new Image();
      img.onload = () => setBgLoaded(true);
      img.src = url;
    }
  }, [fachada?.foto_principal_url, fotos]);

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

  // ─── Loading ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0c0f0e]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          <p className="text-white/30 text-sm">Carregando imóvel...</p>
        </motion.div>
      </div>
    );
  }

  // ─── Not found ───────────────────────────────────────────
  if (!fachada) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0c0f0e] text-white p-6 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Home className="h-16 w-16 mx-auto mb-4 text-white/15" />
          <h1 className="text-2xl font-bold mb-2">Imóvel não encontrado</h1>
          <p className="text-white/40">Este link pode ter expirado ou o imóvel foi removido.</p>
        </motion.div>
      </div>
    );
  }

  const imovel = fachada.imovel;
  const corretor = fachada.corretor;
  const bgUrl = fachada.foto_principal_url || fotos?.[0]?.arquivo_url || '';

  // ═══════════════════════════════════════════════════════════
  // ETAPA 1 — Captura de Lead (Design Premium Glassmorphism)
  // ═══════════════════════════════════════════════════════════
  if (!leadCapturado) {
    const subtitulo = [
      imovel?.titulo,
      imovel?.valor ? formatPrice(imovel.valor) : null,
    ]
      .filter(Boolean)
      .join(' – ');

    return (
      <div className="relative min-h-screen min-h-[100dvh] overflow-hidden flex flex-col">
        {/* ── Background: foto do imóvel com blur ── */}
        <div className="fixed inset-0 z-0">
          {bgUrl ? (
            <>
              <motion.img
                src={bgUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                initial={{ scale: 1.1, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
              {/* Dark + blur overlay */}
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#1a1e1d] to-[#0c0f0e]" />
          )}
        </div>

        {/* ── Card centralizado ── */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-5 py-8 sm:py-12">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="w-full max-w-[420px]"
          >
            <motion.div
              variants={itemVariants}
              className="rounded-[28px] overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.08)',
                backdropFilter: 'blur(24px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
              }}
            >
              {/* ── Content ── */}
              <div className="px-7 pt-10 pb-3 sm:px-9 sm:pt-12">
                {/* Main headline */}
                <motion.h1
                  variants={itemVariants}
                  className="text-[26px] sm:text-[32px] leading-[1.15] font-bold text-white tracking-[-0.02em] text-center"
                >
                  Acesse todos os{'\n'}detalhes deste{'\n'}imóvel exclusivo
                </motion.h1>

                {/* Subtitle: imovel name + price */}
                {subtitulo && (
                  <motion.p
                    variants={itemVariants}
                    className="text-white/50 text-sm sm:text-[15px] text-center mt-4 leading-relaxed"
                  >
                    {subtitulo}
                  </motion.p>
                )}
              </div>

              {/* ── Form ── */}
              <form onSubmit={handleSubmitLead} className="px-7 pb-8 pt-4 sm:px-9 sm:pb-10">
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="show"
                  className="space-y-6"
                >
                  <UnderlineInput
                    label="Nome Completo"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    required
                    autoFocus
                    autoComplete="name"
                  />
                  <UnderlineInput
                    label="Telefone (WhatsApp)"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    type="tel"
                    required
                    autoComplete="tel"
                  />
                  <UnderlineInput
                    label="E-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    autoComplete="email"
                  />
                </motion.div>

                {/* ── CTA Button ── */}
                <motion.div variants={itemVariants} className="mt-8">
                  <button
                    type="submit"
                    disabled={enviando || !nome.trim() || !telefone.trim()}
                    className="
                      group relative w-full h-[52px] rounded-full
                      flex items-center justify-center gap-2.5
                      text-[15px] font-semibold text-white
                      overflow-hidden
                      transition-all duration-300
                      disabled:opacity-40 disabled:cursor-not-allowed
                      active:scale-[0.97]
                    "
                    style={{
                      background: 'linear-gradient(135deg, #b8860b 0%, #d4a017 40%, #c5941a 100%)',
                      boxShadow: '0 4px 20px rgba(180,130,20,0.3)',
                    }}
                  >
                    {/* Hover shimmer */}
                    <span
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                        animation: 'shimmer-slide 1.8s ease-in-out infinite',
                      }}
                    />
                    {enviando ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                        Desbloquear Detalhes
                      </>
                    )}
                  </button>
                </motion.div>

                {/* ── Privacy ── */}
                <motion.p
                  variants={itemVariants}
                  className="flex items-center justify-center gap-1.5 text-[11px] text-white/30 mt-5 text-center"
                >
                  <Shield className="h-3 w-3 flex-shrink-0" />
                  Seus dados estão protegidos e não serão compartilhados.
                </motion.p>
              </form>
            </motion.div>
          </motion.div>
        </div>

        {/* ── Footer: Corretor ── */}
        {corretor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="relative z-10 text-center pb-8 pt-2"
          >
            <p className="text-white/30 text-xs">
              {corretor.razao_social ?? corretor.nome}
              {corretor.creci ? ` – CRECI ${corretor.creci}` : ''}
            </p>
          </motion.div>
        )}

        {/* Keyframes */}
        <style>{`
          @keyframes shimmer-slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ETAPA 2 — Página do Imóvel
  // ═══════════════════════════════════════════════════════════
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
                    i === fotoAtual ? 'w-6 bg-white' : 'w-1.5 bg-white/40'
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
            <div key={i} className="bg-muted/50 rounded-xl p-3 text-center space-y-1">
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
            <p className="text-sm text-muted-foreground leading-relaxed">{imovel.descricao}</p>
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

        {/* CTAs */}
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
                <img src={corretor.foto_url} alt="" className="h-14 w-14 rounded-full object-cover" />
              ) : (
                <User className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{corretor.nome}</p>
              <p className="text-xs text-muted-foreground">{corretor.razao_social ?? 'Corretor de Imóveis'}</p>
              <p className="text-xs text-muted-foreground">CRECI {corretor.creci}</p>
            </div>
            <a href={`tel:${corretor.telefone}`} className="p-3 rounded-full bg-primary/10 hover:bg-primary/20 transition">
              <Phone className="h-5 w-5 text-primary" />
            </a>
          </motion.div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground pb-6">
          © {new Date().getFullYear()}{' '}
          {corretor?.razao_social ?? 'Oliver Negócios Inteligentes'}. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}

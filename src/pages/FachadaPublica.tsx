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
  Share2,
  Heart,
  Check,
  Maximize2,
  ExternalLink,
  X,
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
  const [galeriaAberta, setGaleriaAberta] = useState(false);
  const [favorito, setFavorito] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (fachadaId) {
      fetchFachadaPublica(fachadaId);
      registrarEscaneamento(fachadaId);
    }
  }, [fachadaId, fetchFachadaPublica, registrarEscaneamento]);

  // Pré-carregar imagem de fundo
  useEffect(() => {
    const url = fotos?.find((f) => f.principal)?.arquivo_url || fotos?.[0]?.arquivo_url || fachada?.foto_principal_url;
    if (url) {
      const img = new Image();
      img.onload = () => setBgLoaded(true);
      img.src = url;
    }
  }, [fachada?.foto_principal_url, fotos]);

  // Favorito — só local, por dispositivo (delícia client-side, sem backend)
  useEffect(() => {
    if (fachadaId) {
      setFavorito(localStorage.getItem(`fav-imovel-${fachadaId}`) === '1');
    }
  }, [fachadaId]);

  // Autoplay do carrossel: avança a cada 3s. Pausa no hover/toque, com a galeria
  // aberta, ou se o usuário prefere menos movimento (WCAG 2.2.2). fotoAtual nas deps
  // faz a navegação manual reiniciar o timer de 3s.
  useEffect(() => {
    const total = fotos.length;
    if (!leadCapturado || total <= 1 || pausado || galeriaAberta) return;
    const prefereMenosMovimento =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefereMenosMovimento) return;
    const id = window.setInterval(() => {
      setFotoAtual((p) => (p + 1) % total);
    }, 3000);
    return () => window.clearInterval(id);
  }, [leadCapturado, fotos.length, pausado, galeriaAberta, fotoAtual]);

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
  const bgUrl = fotos?.find((f) => f.principal)?.arquivo_url || fotos?.[0]?.arquivo_url || fachada.foto_principal_url || '';

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

  const enderecoCompleto = [imovel?.endereco, imovel?.bairro, imovel?.cidade]
    .filter(Boolean)
    .join(', ');

  const proximaFoto = () =>
    setFotoAtual((p) => (allFotos.length ? (p + 1) % allFotos.length : 0));
  const fotoAnterior = () =>
    setFotoAtual((p) => (allFotos.length ? (p - 1 + allFotos.length) % allFotos.length : 0));

  const abrirMapa = () => {
    if (!enderecoCompleto) return;
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoCompleto)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  const handleShare = async () => {
    const url = window.location.href;
    const dados = {
      title: imovel?.titulo || 'Imóvel',
      text: imovel?.titulo || 'Confira este imóvel',
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(dados);
        return;
      }
    } catch {
      return; // usuário cancelou o compartilhamento nativo
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard indisponível */
    }
  };

  const toggleFavorito = () => {
    const novo = !favorito;
    setFavorito(novo);
    if (fachadaId) {
      if (novo) localStorage.setItem(`fav-imovel-${fachadaId}`, '1');
      else localStorage.removeItem(`fav-imovel-${fachadaId}`);
    }
  };

  const fotoAmbient = allFotos[fotoAtual]?.arquivo_url || bgUrl;

  return (
    <div className="relative min-h-screen min-h-[100dvh] bg-[#0c0f0e] text-white overflow-x-hidden">
      {/* ── Ambient: foto ativa borrada (a página se acende com a casa) ── */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden>
        <AnimatePresence mode="wait">
          {fotoAmbient && (
            <motion.img
              key={`amb-${fotoAtual}`}
              src={fotoAmbient}
              alt=""
              className="absolute inset-0 w-full h-full object-cover scale-125 blur-[70px] opacity-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9 }}
            />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-[#0c0f0e]/70" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c0f0e] via-transparent to-[#0c0f0e]" />
      </div>

      {/* ── Conteúdo ── */}
      <div className="relative z-10 mx-auto w-full max-w-xl px-4 pb-12">
        {/* Top bar */}
        <div className="flex items-center justify-between py-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200/70">
            Oliver
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              aria-label="Compartilhar"
              className="fp-glass-btn h-10 w-10 rounded-full flex items-center justify-center text-white/80 hover:bg-white/15 transition"
            >
              {copiado ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
            </button>
            <button
              onClick={toggleFavorito}
              aria-label="Favoritar imóvel"
              className="fp-glass-btn h-10 w-10 rounded-full flex items-center justify-center hover:bg-white/15 transition"
            >
              <Heart className={`h-4 w-4 transition ${favorito ? 'fill-rose-500 text-rose-500' : 'text-white/80'}`} />
            </button>
          </div>
        </div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="fp-glass rounded-[26px] p-1.5"
        >
          <div
            className="group relative overflow-hidden rounded-[20px] aspect-[4/3] bg-black/40 ring-1 ring-amber-300/15"
            onMouseEnter={() => setPausado(true)}
            onMouseLeave={() => setPausado(false)}
            onTouchStart={() => setPausado(true)}
            onTouchEnd={() => setPausado(false)}
            onClick={() => allFotos.length && setGaleriaAberta(true)}
            role={allFotos.length ? 'button' : undefined}
          >
            <AnimatePresence mode="wait">
              {allFotos.length > 0 ? (
                <motion.img
                  key={fotoAtual}
                  src={allFotos[fotoAtual].arquivo_url}
                  alt=""
                  className="w-full h-full object-cover cursor-zoom-in"
                  initial={{ opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <Home className="h-20 w-20 text-white/15" />
                </div>
              )}
            </AnimatePresence>

            {/* Scrim */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/25 pointer-events-none" />

            {/* Badge tipo */}
            <div className="absolute top-3 left-3">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold text-amber-100"
                style={{ background: 'rgba(212,160,23,0.2)', border: '1px solid rgba(212,160,23,0.4)', backdropFilter: 'blur(10px)' }}
              >
                {TIPO_NEGOCIO_LABELS[fachada.tipo_negocio]}
              </span>
            </div>

            {/* Contador + ampliar */}
            {allFotos.length > 0 && (
              <div className="absolute top-3 right-3 fp-glass-btn h-8 px-2.5 rounded-full flex items-center gap-1.5 text-[11px] text-white/85">
                <Maximize2 className="h-3.5 w-3.5" />
                {allFotos.length > 1 && (
                  <span className="tabular-nums">{fotoAtual + 1}/{allFotos.length}</span>
                )}
              </div>
            )}

            {/* Setas */}
            {allFotos.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); fotoAnterior(); }}
                  aria-label="Foto anterior"
                  className="absolute left-2 top-1/2 -translate-y-1/2 fp-glass-btn h-9 w-9 rounded-full flex items-center justify-center text-white/85 hover:bg-white/20 transition"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); proximaFoto(); }}
                  aria-label="Próxima foto"
                  className="absolute right-2 top-1/2 -translate-y-1/2 fp-glass-btn h-9 w-9 rounded-full flex items-center justify-center text-white/85 hover:bg-white/20 transition"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}

            {/* Título + preço (painel de vidro) */}
            <div className="absolute inset-x-3 bottom-3">
              <div className="fp-glass rounded-2xl px-4 py-3">
                <h1 className="text-base sm:text-lg font-bold leading-snug tracking-[-0.01em] line-clamp-2">
                  {imovel?.titulo}
                </h1>
                {imovel?.valor && (
                  <p
                    className="mt-0.5 text-2xl sm:text-3xl font-extrabold tracking-[-0.02em] tabular-nums bg-clip-text text-transparent"
                    style={{ backgroundImage: 'linear-gradient(135deg,#e6b325,#d4a017 55%,#b8860b)' }}
                  >
                    {formatPrice(imovel.valor)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Cards */}
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="mt-4 space-y-4">
          {/* Ficha rápida */}
          <motion.section variants={itemVariants} className="fp-glass rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45 mb-3">Ficha rápida</p>
            <div className="grid grid-cols-4 gap-2.5">
              {[
                { icon: Ruler, value: imovel?.area_m2, suffix: 'm²' },
                { icon: Bed, value: imovel?.dormitorios, suffix: 'quartos' },
                { icon: Bath, value: null, suffix: 'banh.' },
                { icon: Car, value: imovel?.garagem, suffix: 'vagas' },
              ].map((item, i) => (
                <div key={i} className="fp-glass-tile rounded-xl p-3 text-center">
                  <item.icon className="h-5 w-5 mx-auto text-amber-300" />
                  <p className="mt-1.5 text-lg font-bold tabular-nums">{item.value ?? '—'}</p>
                  <p className="text-[10px] text-white/45">{item.suffix}</p>
                </div>
              ))}
            </div>
          </motion.section>

          {/* Sobre */}
          {imovel?.descricao && (
            <motion.section variants={itemVariants} className="fp-glass rounded-2xl p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45 mb-2">Sobre o imóvel</p>
              <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{imovel.descricao}</p>
            </motion.section>
          )}

          {/* Localização → Google Maps */}
          <motion.button
            variants={itemVariants}
            type="button"
            onClick={abrirMapa}
            disabled={!enderecoCompleto}
            className="fp-glass block w-full text-left rounded-2xl overflow-hidden group disabled:opacity-70"
          >
            <div className="relative h-24">
              <div
                className="absolute inset-0 opacity-25"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(212,160,23,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(212,160,23,0.35) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="relative">
                  <span className="absolute -inset-3 rounded-full bg-amber-400/20 blur-md" />
                  <span className="relative h-9 w-9 rounded-full bg-amber-500 flex items-center justify-center shadow-lg">
                    <MapPin className="h-5 w-5 text-black/80" />
                  </span>
                </span>
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c0f0e]/70 to-transparent" />
            </div>
            <div className="p-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Localização</p>
                <p className="text-sm text-white/75 truncate">{enderecoCompleto || '—'}</p>
              </div>
              {enderecoCompleto && (
                <span className="shrink-0 flex items-center gap-1 text-xs text-amber-300 group-hover:gap-1.5 transition-all">
                  Abrir <ExternalLink className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </motion.button>

          {/* CTAs */}
          <motion.div variants={itemVariants} className="space-y-3">
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
              <Button className="w-full h-14 text-base font-semibold gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-[0_8px_30px_rgba(37,211,102,0.25)]">
                <MessageCircle className="h-5 w-5" />
                Falar no WhatsApp
              </Button>
            </a>
            <div className="grid grid-cols-2 gap-3">
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="fp-glass-btn h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-medium text-white/85 hover:bg-white/15 transition"
              >
                <Calendar className="h-4 w-4" /> Agendar Visita
              </a>
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="fp-glass-btn h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-medium text-white/85 hover:bg-white/15 transition"
              >
                <FileText className="h-4 w-4" /> Fazer Proposta
              </a>
            </div>
          </motion.div>

          {/* Corretor */}
          {corretor && (
            <motion.div variants={itemVariants} className="fp-glass rounded-2xl p-4 flex items-center gap-4">
              <div className="h-14 w-14 rounded-full overflow-hidden fp-glass-tile flex items-center justify-center shrink-0">
                {corretor.foto_url ? (
                  <img src={corretor.foto_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-6 w-6 text-amber-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{corretor.nome}</p>
                <p className="text-xs text-white/55 truncate">{corretor.razao_social ?? 'Corretor de Imóveis'}</p>
                <p className="text-xs text-amber-300/90">CRECI {corretor.creci}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {corretor.telefone && (
                  <a
                    href={`tel:${corretor.telefone}`}
                    aria-label="Ligar"
                    className="fp-glass-btn h-10 w-10 rounded-full flex items-center justify-center text-white/85 hover:bg-white/15 transition"
                  >
                    <Phone className="h-4 w-4" />
                  </a>
                )}
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="WhatsApp"
                  className="fp-glass-btn h-10 w-10 rounded-full flex items-center justify-center text-emerald-400 hover:bg-white/15 transition"
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              </div>
            </motion.div>
          )}

          {/* Footer */}
          <motion.p variants={itemVariants} className="text-center text-[11px] text-white/30 pt-2">
            © {new Date().getFullYear()}{' '}
            {corretor?.razao_social ?? 'Oliver Negócios Inteligentes'}. Todos os direitos reservados.
          </motion.p>
        </motion.div>
      </div>

      {/* ── Galeria em tela cheia ── */}
      <AnimatePresence>
        {galeriaAberta && allFotos.length > 0 && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-white/70 tabular-nums">
                {fotoAtual + 1} / {allFotos.length}
              </span>
              <button
                onClick={() => setGaleriaAberta(false)}
                aria-label="Fechar galeria"
                className="fp-glass-btn h-10 w-10 rounded-full flex items-center justify-center text-white/85 hover:bg-white/15 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 relative flex items-center justify-center overflow-hidden select-none">
              <AnimatePresence mode="wait">
                <motion.img
                  key={fotoAtual}
                  src={allFotos[fotoAtual].arquivo_url}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.2}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -80) proximaFoto();
                    else if (info.offset.x > 80) fotoAnterior();
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                />
              </AnimatePresence>
              {allFotos.length > 1 && (
                <>
                  <button
                    onClick={fotoAnterior}
                    aria-label="Foto anterior"
                    className="absolute left-3 top-1/2 -translate-y-1/2 fp-glass-btn h-11 w-11 rounded-full flex items-center justify-center text-white/85 hover:bg-white/20 transition"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    onClick={proximaFoto}
                    aria-label="Próxima foto"
                    className="absolute right-3 top-1/2 -translate-y-1/2 fp-glass-btn h-11 w-11 rounded-full flex items-center justify-center text-white/85 hover:bg-white/20 transition"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

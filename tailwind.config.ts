import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Wordmark da marca Lotti + acentos serifados premium.
        serif: ['Lora', 'Georgia', 'serif'],
      },
      boxShadow: {
        /* Card quase sem sombra: a separação vem da borda de 1px e do
           contraste entre o branco do card e o cinza-esverdeado do fundo.
           Sombra pesada é o que faz um painel parecer landing page. */
        'card': '0 1px 3px rgba(15, 23, 20, 0.04)',
        'card-hover': '0 2px 8px rgba(15, 23, 20, 0.06)',
        /* Elevação real só onde há sobreposição de camada. */
        'overlay': '0 8px 28px -6px rgba(15, 23, 20, 0.16), 0 2px 6px rgba(15, 23, 20, 0.06)',
        'floating': '0 6px 20px -4px rgba(6, 67, 49, 0.28), 0 2px 6px rgba(15, 23, 20, 0.08)',
        'premium': '0 4px 24px -2px rgba(0, 0, 0, 0.04), 0 0 4px rgba(0,0,0,0.02)',
        'premium-hover': '0 8px 32px -4px rgba(0, 0, 0, 0.08), 0 0 4px rgba(0,0,0,0.02)',
        'premium-dark': '0 4px 24px -2px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0,0,0,0.1)',
        'premium-dark-hover': '0 8px 32px -4px rgba(0, 0, 0, 0.3), 0 0 4px rgba(0,0,0,0.1)',
      },
      colors: {
        border: {
          DEFAULT: "hsl(var(--border))",
          strong: "hsl(var(--border-strong))",
        },
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        /* Escala da marca, para quando o papel semântico não basta. */
        brand: {
          50: "hsl(var(--brand-50))",
          100: "hsl(var(--brand-100))",
          600: "hsl(var(--brand-600))",
          700: "hsl(var(--brand-700))",
          800: "hsl(var(--brand-800))",
          850: "hsl(var(--brand-850))",
          900: "hsl(var(--brand-900))",
          950: "hsl(var(--brand-950))",
        },
        surface: {
          DEFAULT: "hsl(var(--surface))",
          brand: "hsl(var(--surface-brand))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          surface: "hsl(var(--destructive-surface))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          surface: "hsl(var(--success-surface))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          surface: "hsl(var(--warning-surface))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          surface: "hsl(var(--info-surface))",
        },
        doc: {
          DEFAULT: "hsl(var(--doc))",
          foreground: "hsl(var(--doc-foreground))",
          surface: "hsl(var(--doc-surface))",
        },
        critical: {
          DEFAULT: "hsl(var(--critical))",
          foreground: "hsl(var(--critical-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
          strong: "hsl(var(--muted-strong))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        funnel: {
          qualification: "hsl(var(--funnel-qualification))",
          visit: "hsl(var(--funnel-visit))",
          documentation: "hsl(var(--funnel-documentation))",
          closing: "hsl(var(--funnel-closing))",
        },
        gold: "hsl(var(--gold))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        /* Card 12px contra 8px de input/botão: a diferença é sutil de
           propósito. Card muito arredondado descaracteriza ferramenta de
           trabalho e puxa para aparência de app de consumo. */
        card: "0.75rem",
      },
      fontSize: {
        /* Escala das referências. O segundo valor fixa o line-height junto,
           para o tamanho não depender de quem escreve a classe. */
        'title': ['1.75rem', { lineHeight: '1.15', fontWeight: '650' }],
        'section': ['1.1875rem', { lineHeight: '1.3', fontWeight: '600' }],
        'card-title': ['1rem', { lineHeight: '1.4', fontWeight: '600' }],
        'kpi': ['1.625rem', { lineHeight: '1.15', fontWeight: '650' }],
        'label': ['0.8125rem', { lineHeight: '1.4', fontWeight: '500' }],
        'group': ['0.6875rem', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '0.06em' }],
      },
      spacing: {
        /* Medidas estruturais que se repetem e não podem divergir entre telas. */
        'sidebar': '15rem',        /* 240px */
        'sidebar-sm': '13.5rem',   /* 216px — notebook */
        'control': '2.75rem',      /* 44px — altura de input, botão e busca */
        'nav-item': '2.5rem',      /* 40px */
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(15px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
        "fade-in-up": "fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in": "slide-in 0.3s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;

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
        serif: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        'premium': '0 4px 24px -2px rgba(0, 0, 0, 0.04), 0 0 4px rgba(0,0,0,0.02)',
        'premium-hover': '0 8px 32px -4px rgba(0, 0, 0, 0.08), 0 0 4px rgba(0,0,0,0.02)',
        'premium-dark': '0 4px 24px -2px rgba(0, 0, 0, 0.2), 0 0 4px rgba(0,0,0,0.1)',
        'premium-dark-hover': '0 8px 32px -4px rgba(0, 0, 0, 0.3), 0 0 4px rgba(0,0,0,0.1)',
        /* Escala de elevação tingida de grafite (refina todos os shadow-* do app) */
        'sm': '0 1px 2px hsl(var(--shadow-color) / 0.05), 0 1px 3px hsl(var(--shadow-color) / 0.05)',
        'DEFAULT': '0 1px 3px hsl(var(--shadow-color) / 0.07), 0 4px 12px hsl(var(--shadow-color) / 0.05)',
        'md': '0 2px 6px hsl(var(--shadow-color) / 0.06), 0 10px 24px hsl(var(--shadow-color) / 0.07)',
        'lg': '0 4px 12px hsl(var(--shadow-color) / 0.07), 0 18px 40px hsl(var(--shadow-color) / 0.09)',
        'xl': '0 8px 24px hsl(var(--shadow-color) / 0.09), 0 28px 60px hsl(var(--shadow-color) / 0.12)',
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
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
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        critical: {
          DEFAULT: "hsl(var(--critical))",
          foreground: "hsl(var(--critical-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
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
        gold: {
          DEFAULT: "hsl(var(--gold))",
          bright: "hsl(var(--gold-bright))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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

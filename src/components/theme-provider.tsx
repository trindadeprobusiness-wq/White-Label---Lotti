import { ThemeProvider as NextThemesProvider } from "next-themes";

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

/**
 * Tema claro por padrão.
 *
 * Era `dark`, herdado do template inicial. A identidade da Lotti é superfície
 * clara com verde institucional — o escuro invertia a marca e fazia o produto
 * parecer outra coisa. O escuro continua disponível pelo toggle da sidebar,
 * agora derivado da mesma paleta.
 *
 * `enableSystem` foi desligado: com ele, quem tem o sistema em escuro nunca via
 * a identidade real do produto sem ir mexer no toggle.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

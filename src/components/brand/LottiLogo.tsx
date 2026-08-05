import { cn } from "@/lib/utils";

/**
 * Símbolo da marca Lotti — três lâminas em ascensão + a pílula.
 *
 * Vetorial e monocromático: usa `fill="currentColor"`, então a cor vem do
 * contexto (`text-foreground`, `text-white`, `text-sidebar-foreground`…). O
 * MESMO símbolo serve para tema claro (grafite) e escuro (branco) — não há
 * versão raster separada.
 */
export function LottiMark({
    className,
    decorative = false,
}: {
    className?: string;
    decorative?: boolean;
}) {
    return (
        <svg
            viewBox="0 0 116 100"
            fill="currentColor"
            className={cn("h-8 w-auto", className)}
            {...(decorative
                ? { "aria-hidden": true }
                : { role: "img", "aria-label": "Lotti" })}
        >
            {/* lâmina 1 (mais alta) */}
            <path d="M6 82 L22 82 L42 12 L26 12 Z" />
            {/* lâmina 2 */}
            <path d="M28 82 L44 82 L64 29 L48 29 Z" />
            {/* lâmina 3 (curta) */}
            <path d="M50 82 L66 82 L86 46 L70 46 Z" />
            {/* pílula */}
            <rect x="92" y="40" width="18" height="42" rx="9" />
        </svg>
    );
}

/**
 * Lockup da marca: símbolo + wordmark "Lotti" (serifada). O tamanho vem da
 * `font-size` do container (ex.: `text-2xl`); o símbolo acompanha em `em`.
 * A cor herda de `text-*` — funciona em claro e escuro.
 */
export function LottiLogo({
    variant = "full",
    className,
}: {
    variant?: "full" | "mark";
    className?: string;
}) {
    if (variant === "mark") {
        return <LottiMark className={className} />;
    }

    return (
        <span
            className={cn(
                "inline-flex items-center gap-2 leading-none text-foreground",
                className,
            )}
            aria-label="Lotti"
        >
            <LottiMark className="h-[0.92em] w-auto shrink-0" decorative />
            <span className="font-serif font-semibold tracking-[-0.01em]">Lotti</span>
        </span>
    );
}

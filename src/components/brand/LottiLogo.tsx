import { cn } from "@/lib/utils";

/**
 * Símbolo da marca Lotti — três lâminas em ascensão + a pílula.
 *
 * Vetorial e monocromático: usa `fill="currentColor"`, então a cor vem do
 * contexto (`text-primary`, `text-foreground`…). O MESMO símbolo serve para
 * qualquer plano de fundo — a paleta é decidida pelo pai.
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
            viewBox="0 0 262 292"
            fill="currentColor"
            className={cn("h-8 w-auto", className)}
            {...(decorative
                ? { "aria-hidden": true }
                : { role: "img", "aria-label": "Lotti" })}
        >
            <path d="M124.5 74.5L0 187.5V101.918C0 93.4999 4.07524 85.6031 10.9361 80.7261L124.5 0V74.5Z" />
            <path d="M179.5 126.5L0 292V211L179.5 53.5V126.5Z" />
            <path d="M101 292H31.5L160.5 171V234.5L101 292Z" />
            <path d="M242 130H203.5L179.5 151.5V271.509C179.5 282.745 188.753 291.776 199.985 291.503L242.485 290.473C253.338 290.21 262 281.336 262 270.479V150C262 138.954 253.046 130 242 130Z" />
        </svg>
    );
}

/**
 * Wordmark oficial "Lotti" — vetor entregue pelo design; a mesma cor do símbolo
 * é herdada via `fill="currentColor"`. Nenhum texto renderizado: a tipografia
 * é a curva vetor exata da marca, não a fonte serifada de fallback antiga.
 */
export function LottiWordmark({
    className,
    decorative = true,
}: {
    className?: string;
    decorative?: boolean;
}) {
    return (
        <svg
            viewBox="0 0 579 206"
            fill="currentColor"
            className={cn("h-6 w-auto", className)}
            {...(decorative
                ? { "aria-hidden": true }
                : { role: "img", "aria-label": "Lotti" })}
        >
            <path d="M9.46013e-07 200.365V2.7076H26.5349V200.365H9.46013e-07ZM21.1196 200.365V176.538H111.555V200.365H21.1196ZM206.333 205.239C193.697 205.239 182.596 203.073 173.029 198.741C163.462 194.409 155.339 188.723 148.66 181.683C142.162 174.462 137.198 166.43 133.768 157.585C130.519 148.74 128.894 139.714 128.894 130.508V125.634C128.894 116.428 130.609 107.403 134.039 98.5581C137.468 89.5326 142.523 81.4999 149.202 74.4601C155.88 67.2397 164.003 61.5537 173.57 57.4019C183.137 53.0697 194.058 50.9036 206.333 50.9036C218.607 50.9036 229.528 53.0697 239.095 57.4019C248.662 61.5537 256.785 67.2397 263.464 74.4601C270.143 81.4999 275.197 89.5326 278.627 98.5581C282.056 107.403 283.771 116.428 283.771 125.634V130.508C283.771 139.714 282.056 148.74 278.627 157.585C275.378 166.43 270.414 174.462 263.735 181.683C257.236 188.723 249.204 194.409 239.637 198.741C230.07 203.073 218.968 205.239 206.333 205.239ZM206.333 181.953C217.163 181.953 226.369 179.607 233.951 174.914C241.713 170.04 247.579 163.541 251.55 155.419C255.702 147.296 257.778 138.18 257.778 128.071C257.778 117.782 255.702 108.576 251.55 100.453C247.399 92.3305 241.442 85.9224 233.68 81.2292C226.099 76.5359 216.983 74.1893 206.333 74.1893C195.863 74.1893 186.748 76.5359 178.986 81.2292C171.224 85.9224 165.267 92.3305 161.115 100.453C156.963 108.576 154.888 117.782 154.888 128.071C154.888 138.18 156.873 147.296 160.844 155.419C164.996 163.541 170.863 170.04 178.444 174.914C186.206 179.607 195.502 181.953 206.333 181.953ZM376.313 201.99C365.483 201.99 356.096 200.456 348.154 197.387C340.392 194.318 334.345 189.084 330.013 181.683C325.861 174.101 323.785 163.902 323.785 151.086V11.9136H348.695V154.335C348.695 162.097 350.771 168.144 354.923 172.477C359.255 176.628 365.302 178.704 373.064 178.704H398.516V201.99H376.313ZM298.875 75.2724V55.7773H398.516V75.2724H298.875ZM488.892 201.99C478.061 201.99 468.675 200.456 460.733 197.387C452.971 194.318 446.924 189.084 442.591 181.683C438.44 174.101 436.364 163.902 436.364 151.086V11.9136H461.274V154.335C461.274 162.097 463.35 168.144 467.502 172.477C471.834 176.628 477.881 178.704 485.643 178.704H511.095V201.99H488.892ZM411.453 75.2724V55.7773H511.095V75.2724H411.453ZM552.192 200.365V55.7773H578.185V200.365H552.192ZM529.989 76.3554V55.7773H578.185V76.3554H529.989ZM559.502 32.4917C553.726 32.4917 549.394 30.9573 546.506 27.8887C543.798 24.82 542.444 20.939 542.444 16.2458C542.444 11.5526 543.798 7.67161 546.506 4.60294C549.394 1.53429 553.726 -3.43205e-05 559.502 -3.43205e-05C565.278 -3.43205e-05 569.52 1.53429 572.228 4.60294C575.116 7.67161 576.56 11.5526 576.56 16.2458C576.56 20.939 575.116 24.82 572.228 27.8887C569.52 30.9573 565.278 32.4917 559.502 32.4917Z" />
        </svg>
    );
}

/**
 * Lockup da marca: símbolo + wordmark. Ambos em SVG puro, herdam a cor via
 * `text-primary`/`text-foreground` do container.
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
                "inline-flex items-end gap-1 leading-none text-primary",
                className,
            )}
            aria-label="Lotti"
        >
            {/* Geometria do Group 1.svg: wordmark alinhado pela base do símbolo
                e distância curta entre os dois elementos. */}
            <LottiMark className="h-8 w-auto shrink-0" decorative />
            <LottiWordmark className="h-[1.38rem] w-auto shrink-0" />
        </span>
    );
}

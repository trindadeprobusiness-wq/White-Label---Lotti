import { supabase } from "@/integrations/supabase/client";
import { apiDisponivel } from "@/lib/api";
import { ErroApi } from "@/lib/api/http";
import { analisarContratoIaApi } from "@/lib/api/contratos";
import { abrirAssistenteApi } from "@/lib/api/ia";

// Extração automática de dados de contratos de locação (PDF ou imagem).
//
// Caminho principal: Edge Function `analisar-contrato` (Gemini lê o arquivo
// direto, inclusive contratos escaneados). Se a função ainda não estiver
// deployada no Supabase, cai para o fallback: extrai o texto do PDF no
// navegador (pdf.js) e usa o assistente IA (`ai-assistant`), que já está
// no ar, para estruturar os dados.

export interface ExtractedContractData {
    inquilino: { nome: string | null; cpf: string | null; telefone: string | null; email: string | null };
    proprietario_nome: string | null;
    imovel: { endereco: string | null; bairro: string | null; cidade: string | null; tipo: string | null };
    valor_aluguel: number | null;
    data_inicio: string | null;
    prazo_meses: number | null;
    dia_vencimento: number | null;
    taxa_administracao: number | null;
    observacoes: string | null;
}

const TIPOS_IMOVEL = ["APARTAMENTO", "CASA", "COMERCIAL", "TERRENO"];

function asString(v: unknown, max = 300): string | null {
    return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function asNumber(v: unknown, min: number, max: number): number | null {
    const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : v;
    if (typeof n !== "number" || !isFinite(n)) return null;
    return n >= min && n <= max ? n : null;
}

function sanitizeExtraction(raw: Record<string, unknown>): ExtractedContractData {
    const inq = (raw.inquilino ?? {}) as Record<string, unknown>;
    const imo = (raw.imovel ?? {}) as Record<string, unknown>;
    const tipoImovel = asString(imo.tipo)?.toUpperCase() ?? null;
    const dataInicio = asString(raw.data_inicio);

    return {
        inquilino: {
            nome: asString(inq.nome),
            cpf: asString(inq.cpf, 20),
            telefone: asString(inq.telefone, 30),
            email: asString(inq.email, 120),
        },
        proprietario_nome: asString(raw.proprietario_nome),
        imovel: {
            endereco: asString(imo.endereco),
            bairro: asString(imo.bairro, 120),
            cidade: asString(imo.cidade, 120),
            tipo: tipoImovel && TIPOS_IMOVEL.includes(tipoImovel) ? tipoImovel : null,
        },
        valor_aluguel: asNumber(raw.valor_aluguel, 1, 10_000_000),
        data_inicio: dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(dataInicio) ? dataInicio : null,
        prazo_meses: asNumber(raw.prazo_meses, 1, 120),
        dia_vencimento: asNumber(raw.dia_vencimento, 1, 31),
        taxa_administracao: asNumber(raw.taxa_administracao, 0, 100),
        observacoes: asString(raw.observacoes, 500),
    };
}

async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1] || "");
        };
        reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
        reader.readAsDataURL(file);
    });
}

// --- Caminho principal: Edge Function analisar-contrato (Gemini) ---

class FunctionUnavailableError extends Error {
    constructor() {
        super("Função analisar-contrato indisponível");
    }
}

/** Com a API ligada: rede fora (TypeError) ou 404/413/503 caem no fallback; o resto vira erro com a mensagem. */
async function analyzeViaApi(file: File): Promise<ExtractedContractData> {
    const fileBase64 = await fileToBase64(file);
    let dados: unknown;
    try {
        dados = await analisarContratoIaApi({ fileBase64, mimeType: file.type });
    } catch (e) {
        if (e instanceof TypeError) throw new FunctionUnavailableError();
        if (e instanceof ErroApi) {
            if (e.status === 404 || e.status === 413 || e.status === 503) throw new FunctionUnavailableError();
            throw new Error(e.message);
        }
        throw e;
    }
    if (!dados) throw new Error("A IA não retornou dados do contrato");
    return sanitizeExtraction(dados as Record<string, unknown>);
}

async function analyzeViaEdgeFunction(file: File): Promise<ExtractedContractData> {
    if (apiDisponivel()) return analyzeViaApi(file);
    const fileBase64 = await fileToBase64(file);

    // Token da sessão explícito: o invoke sozinho não anexa o JWT do corretor de
    // forma confiável — era isso que derrubava a leitura por IA e fazia cair no
    // fallback do navegador (que não lê contrato escaneado).
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sua sessão expirou. Entre novamente.");

    const { data, error } = await supabase.functions.invoke("analisar-contrato", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { fileBase64, mimeType: file.type },
    });

    if (error) {
        // 404 = função ainda não deployada neste projeto Supabase → fallback.
        const status: number | undefined = (error as { context?: { status?: number } }).context?.status;
        if (status === 404 || error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError") {
            throw new FunctionUnavailableError();
        }
        let serverMessage = "";
        try {
            const body = await (error as { context?: Response }).context?.json();
            serverMessage = body?.error || "";
        } catch { /* corpo não-JSON */ }
        throw new Error(serverMessage || "Erro ao analisar o contrato");
    }

    if (!data?.dados) throw new Error("A IA não retornou dados do contrato");
    return sanitizeExtraction(data.dados as Record<string, unknown>);
}

// --- Fallback: texto do PDF no navegador + assistente IA já deployado ---

async function extractPdfText(file: File): Promise<string> {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const parts: string[] = [];
    const maxPages = Math.min(doc.numPages, 30);

    for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
        parts.push(pageText);
    }

    return parts.join("\n").replace(/\s{3,}/g, " ").trim().slice(0, 45000);
}

const ASSISTANT_INSTRUCTION = `Extraia os dados do contrato de locação enviado no contexto de arquivo e responda APENAS com um objeto JSON válido (sem markdown, sem texto antes ou depois), exatamente neste formato:
{"inquilino":{"nome":null,"cpf":null,"telefone":null,"email":null},"proprietario_nome":null,"imovel":{"endereco":null,"bairro":null,"cidade":null,"tipo":null},"valor_aluguel":null,"data_inicio":null,"prazo_meses":null,"dia_vencimento":null,"taxa_administracao":null,"observacoes":null}
Regras: use null quando não tiver certeza e NUNCA invente dados; "inquilino" é o locatário e "proprietario_nome" é o locador; valor_aluguel é o aluguel mensal como número puro; data_inicio no formato YYYY-MM-DD; imovel.tipo deve ser APARTAMENTO, CASA, COMERCIAL ou TERRENO; dia_vencimento é um inteiro de 1 a 31. NÃO use tools nem sugira ações — apenas responda o JSON.`;

async function analyzeViaAssistant(contractText: string): Promise<ExtractedContractData> {
    // Modo estruturado: a API responde só o JSON, sem ferramentas e sem as regras de formato do chat.
    const pedido = {
        module: "contracts",
        intent: "contracts.extraction",
        output_mode: "structured",
        message: ASSISTANT_INSTRUCTION,
        file_context: `Contrato de locação (texto extraído do PDF):\n\n${contractText}`,
    };
    let response: Response;
    if (apiDisponivel()) {
        // Mesmo stream SSE do assistente, pela API Lotti (sem sessão do Supabase).
        try {
            response = await abrirAssistenteApi(pedido);
        } catch {
            throw new Error("O assistente IA não respondeu. Tente novamente.");
        }
    } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Não autenticado");

        response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${session.access_token}`,
                    "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(pedido),
            },
        );
    }

    if (!response.ok || !response.body) {
        throw new Error("O assistente IA não respondeu. Tente novamente.");
    }

    // A resposta é um stream SSE; acumula os deltas de texto até o fim.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let evt: { type?: string; content?: string; error?: string };
            try {
                evt = JSON.parse(line.slice(6));
            } catch {
                continue; // chunk SSE malformado
            }
            if (evt.type === "text" && evt.content) fullText += evt.content;
            if (evt.type === "error") throw new Error(evt.error || "Erro na IA");
        }
    }

    const start = fullText.indexOf("{");
    const end = fullText.lastIndexOf("}");
    if (start === -1 || end <= start) {
        throw new Error("A IA não conseguiu estruturar os dados do contrato");
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(fullText.slice(start, end + 1));
    } catch {
        throw new Error("A IA retornou dados em formato inválido. Tente novamente.");
    }

    return sanitizeExtraction(parsed);
}

// --- Central de Contratos: análise de venda / exclusividade (modo "central") ---

/** Uma das partes do contrato, como a IA a leu. */
export interface ParteContrato {
    nome: string | null;
    cpf_cnpj: string | null;
    telefone: string | null;
    email: string | null;
}

export interface ExtractedCentralContract {
    tipo: string | null;
    partes: {
        vendedor_proprietario: ParteContrato;
        comprador_cliente: ParteContrato;
        corretor: string | null;
    };
    imovel: {
        endereco: string | null;
        bairro: string | null;
        cidade: string | null;
        tipo: string | null;
    };
    valor: number | null;
    comissao_percentual: number | null;
    data_inicio: string | null;
    data_fim: string | null;
    prazo_dias: number | null;
    observacoes: string | null;
}

/**
 * Analisa um contrato (PDF/imagem) no modo "central": detecta o tipo
 * (compra e venda / exclusividade), as partes e — o mais importante — o
 * VENCIMENTO (data_fim). Reusa a Edge Function `analisar-contrato` (já
 * sanitiza no servidor). Sem fallback de navegador: o modo central exige a
 * função (que já está deployada).
 */
export async function analisarContratoCentral(file: File): Promise<ExtractedCentralContract> {
    const fileBase64 = await fileToBase64(file);
    if (apiDisponivel()) {
        let dados: unknown;
        try {
            dados = await analisarContratoIaApi({ fileBase64, mimeType: file.type, modo: "central" });
        } catch (e) {
            throw new Error(e instanceof Error ? e.message : "Erro ao analisar o contrato");
        }
        if (!dados) throw new Error("A IA não retornou dados do contrato");
        return dados as ExtractedCentralContract;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sua sessão expirou. Entre novamente.");

    const { data, error } = await supabase.functions.invoke("analisar-contrato", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { fileBase64, mimeType: file.type, modo: "central" },
    });

    if (error) {
        let serverMessage = "";
        try {
            const body = await (error as { context?: Response }).context?.json();
            serverMessage = body?.error || "";
        } catch { /* corpo não-JSON */ }
        throw new Error(serverMessage || "Erro ao analisar o contrato");
    }
    if (!data?.dados) throw new Error("A IA não retornou dados do contrato");
    return data.dados as ExtractedCentralContract;
}

// --- Orquestrador ---

export async function extractContractData(file: File): Promise<ExtractedContractData> {
    try {
        return await analyzeViaEdgeFunction(file);
    } catch (err) {
        if (!(err instanceof FunctionUnavailableError)) throw err;

        if (file.type !== "application/pdf") {
            throw new Error(
                "A análise de fotos de contrato requer a Edge Function 'analisar-contrato' (deploy pendente). Envie o contrato em PDF.",
            );
        }

        const text = await extractPdfText(file);
        if (text.length < 100) {
            throw new Error(
                "Não foi possível ler o texto deste PDF (pode ser um documento escaneado). Faça o deploy da função 'analisar-contrato' para analisar contratos escaneados.",
            );
        }
        return analyzeViaAssistant(text);
    }
}

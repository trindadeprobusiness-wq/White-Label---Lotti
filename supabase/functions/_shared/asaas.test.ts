import { describe, expect, it } from "vitest";
import {
    AsaasError,
    AsaasNaoConectado,
    clienteComCredencial,
    resolverCredencial,
    type ConexaoLinha,
    type FontesCredencial,
} from "./asaas";

const CHAVE_GLOBAL = "$aact_chave_DA_CONTA_MAE";

/** Monta fontes falsas. Por padrão: a chave global EXISTE no ambiente — é o
 *  cenário perigoso, e é nele que os testes precisam rodar. */
function fontes(over: Partial<FontesCredencial> & { conexao?: ConexaoLinha | null; ciphertext?: string | null } = {}): FontesCredencial {
    return {
        buscarConexao: async () => (over.conexao === undefined ? null : over.conexao),
        buscarCiphertext: async () => (over.ciphertext === undefined ? null : over.ciphertext),
        decifrar: async (c) => c.replace(/^cifrado:/, ""),
        chaveDoAmbiente: () => CHAVE_GLOBAL,
        ...(over.permitirChaveGlobal ? { permitirChaveGlobal: over.permitirChaveGlobal } : {}),
    };
}

const conectada = (id: string, extra: Partial<ConexaoLinha> = {}): ConexaoLinha => ({
    id,
    ambiente: "producao",
    status: "conectada",
    conta_nome: "Imobiliária Teste",
    herdada_do_ambiente: false,
    ...extra,
});

describe("resolverCredencial — isolamento entre inquilinos", () => {
    it("NÃO entrega a chave global para quem não tem conexão", async () => {
        // O bug original: qualquer corretor autenticado caía na conta-mãe.
        await expect(resolverCredencial(fontes({ conexao: null }), "corretor-novo"))
            .rejects.toBeInstanceOf(AsaasNaoConectado);
    });

    it("usa a chave do próprio inquilino quando ela existe", async () => {
        const cred = await resolverCredencial(
            fontes({ conexao: conectada("cx-1"), ciphertext: "cifrado:$aact_do_corretor_A" }),
            "corretor-A",
        );
        expect(cred.apiKey).toBe("$aact_do_corretor_A");
        expect(cred.apiKey).not.toBe(CHAVE_GLOBAL);
        expect(cred.herdada).toBe(false);
    });

    it("dois inquilinos conectados usam chaves diferentes", async () => {
        const a = await resolverCredencial(
            fontes({ conexao: conectada("cx-a"), ciphertext: "cifrado:$aact_A" }), "corretor-A",
        );
        const b = await resolverCredencial(
            fontes({ conexao: conectada("cx-b"), ciphertext: "cifrado:$aact_B" }), "corretor-B",
        );
        expect(a.apiKey).not.toBe(b.apiKey);
    });

    it("recusa quando a sessão não identifica o corretor", async () => {
        await expect(resolverCredencial(fontes(), "")).rejects.toBeInstanceOf(AsaasNaoConectado);
    });

    it("não tenta usar chave que a Asaas já recusou", async () => {
        // Sem isto a chamada voltaria 401 e a tela diria "erro no gateway",
        // quando o que a pessoa precisa é o convite a reconectar.
        await expect(resolverCredencial(
            fontes({
                conexao: conectada("cx-i", { status: "invalida" }),
                ciphertext: "cifrado:$aact_revogada",
            }),
            "corretor-I",
        )).rejects.toBeInstanceOf(AsaasNaoConectado);
    });

    it("sem_permissao continua operando: a chave é boa, só falta um escopo", async () => {
        const cred = await resolverCredencial(
            fontes({
                conexao: conectada("cx-sp", { status: "sem_permissao" }),
                ciphertext: "cifrado:$aact_sem_saldo",
            }),
            "corretor-SP",
        );
        expect(cred.apiKey).toBe("$aact_sem_saldo");
    });

    it("recusa conexão sem chave própria que não seja a herdada", async () => {
        await expect(resolverCredencial(
            fontes({ conexao: conectada("cx-x", { herdada_do_ambiente: false }), ciphertext: null }),
            "corretor-X",
        )).rejects.toBeInstanceOf(AsaasNaoConectado);
    });
});

describe("resolverCredencial — ponte da conta herdada", () => {
    it("a conexão herdada continua usando a chave do ambiente", async () => {
        const cred = await resolverCredencial(
            fontes({ conexao: conectada("cx-oliver", { herdada_do_ambiente: true }), ciphertext: null }),
            "corretor-oliver",
        );
        expect(cred.apiKey).toBe(CHAVE_GLOBAL);
        expect(cred.herdada).toBe(true);
    });

    it("a chave própria vence a herança assim que é gravada", async () => {
        const cred = await resolverCredencial(
            fontes({
                conexao: conectada("cx-oliver", { herdada_do_ambiente: true }),
                ciphertext: "cifrado:$aact_nova_rotacionada",
            }),
            "corretor-oliver",
        );
        expect(cred.apiKey).toBe("$aact_nova_rotacionada");
        expect(cred.herdada).toBe(false);
    });

    it("falha explicitamente se a herança perdeu a chave do ambiente", async () => {
        const f = fontes({ conexao: conectada("cx-oliver", { herdada_do_ambiente: true }), ciphertext: null });
        f.chaveDoAmbiente = () => undefined;
        await expect(resolverCredencial(f, "corretor-oliver")).rejects.toThrow(/não está mais configurada/);
    });
});

describe("resolverCredencial — válvula de emergência", () => {
    it("nasce desligada: sem a flag, ninguém sem conexão alcança o ambiente", async () => {
        await expect(resolverCredencial(fontes({ conexao: null }), "qualquer"))
            .rejects.toBeInstanceOf(AsaasNaoConectado);
    });

    it("ligada, religa o comportamento antigo para reverter sem redeploy", async () => {
        const cred = await resolverCredencial(
            fontes({ conexao: null, permitirChaveGlobal: () => true }), "qualquer",
        );
        expect(cred.apiKey).toBe(CHAVE_GLOBAL);
    });
});

describe("resolverCredencial — ambiente", () => {
    it("sandbox aponta para o endereço de sandbox", async () => {
        const cred = await resolverCredencial(
            fontes({ conexao: conectada("cx-s", { ambiente: "sandbox" }), ciphertext: "cifrado:$aact_s" }),
            "corretor-S",
        );
        expect(cred.ambiente).toBe("sandbox");
        expect(cred.baseUrl).toBe("https://api-sandbox.asaas.com/v3");
    });

    it("produção é o padrão quando o ambiente vem vazio", async () => {
        const cred = await resolverCredencial(
            fontes({ conexao: conectada("cx-p", { ambiente: null }), ciphertext: "cifrado:$aact_p" }),
            "corretor-P",
        );
        expect(cred.ambiente).toBe("producao");
        expect(cred.baseUrl).toBe("https://api.asaas.com/v3");
    });
});

describe("clienteComCredencial", () => {
    const cred = {
        apiKey: "$aact_teste",
        ambiente: "producao" as const,
        baseUrl: "https://api.asaas.com/v3",
        contaNome: "Teste",
        herdada: false,
    };

    it("envia a chave do inquilino no header access_token", async () => {
        let visto: any = null;
        const cli = clienteComCredencial(cred, (async (url: any, init: any) => {
            visto = { url, init };
            return { ok: true, status: 200, text: async () => JSON.stringify({ balance: 10 }) } as any;
        }) as any);

        const r = await cli.get("/finance/balance");
        expect(r.balance).toBe(10);
        expect(visto.url).toBe("https://api.asaas.com/v3/finance/balance");
        expect(visto.init.headers.access_token).toBe("$aact_teste");
    });

    it("transforma resposta de erro em AsaasError preservando o status", async () => {
        const cli = clienteComCredencial(cred, (async () => ({
            ok: false, status: 401, text: async () => JSON.stringify({ errors: [{ description: "chave inválida" }] }),
        })) as any);

        await expect(cli.get("/finance/balance")).rejects.toBeInstanceOf(AsaasError);
        await expect(cli.get("/finance/balance")).rejects.toMatchObject({ status: 401 });
    });
});

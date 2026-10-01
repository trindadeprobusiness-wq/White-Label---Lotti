# Oliver CRM — Negócios Inteligentes

CRM imobiliário inteligente para corretores de imóveis, com geração de contratos e mensagens de WhatsApp assistidas por IA.

## Tecnologias

- **Vite** + **React 18** + **TypeScript**
- **shadcn/ui** + **Tailwind CSS**
- **Supabase** (banco de dados, autenticação e Edge Functions)
- **Hospedagem:** Vercel

## Desenvolvimento local

Pré-requisito: Node.js & npm instalados ([instalar com nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
# 1. Clone o repositório
git clone <SEU_GIT_URL>

# 2. Entre no diretório
cd casa-mente-contrato-1

# 3. Instale as dependências
npm install

# 4. Inicie o servidor de desenvolvimento (http://localhost:8080)
npm run dev
```

### Variáveis de ambiente

Copie `.env.example` para `.env` e preencha as chaves do Supabase. Os segredos das Edge Functions
(ex.: chaves de IA) são configurados no painel do Supabase, não no `.env` do frontend.

## Deploy na Vercel

O projeto já está configurado para a Vercel via [`vercel.json`](./vercel.json) — framework `vite`,
build `npm run build`, saída `dist`, com rewrite de SPA para o React Router.

Nota operacional: deploy de produção reacionado em 2026-10-01.

**Opção A — Git (recomendado):** conecte o repositório na Vercel. Cada push para a branch principal
gera um deploy de produção e cada PR gera uma preview automática.

**Opção B — CLI:**

```sh
npm i -g vercel      # instala a CLI (uma vez)
vercel               # deploy de preview
vercel --prod        # deploy de produção
```

Lembre-se de cadastrar as variáveis de ambiente do frontend no painel da Vercel
(Project → Settings → Environment Variables).

### Domínio personalizado

Na Vercel: Project → Settings → Domains → **Add Domain**.

## Estrutura

- `src/` — código do frontend (React)
- `supabase/` — migrações e Edge Functions (`gerar-contrato`, `generate-whatsapp-message`, etc.)
- `vercel.json` — configuração de build e hospedagem

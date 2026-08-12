# Deploy manual pelo Dashboard do Supabase

Para quando não dá para usar o CLI (`supabase functions deploy` exige `supabase login`,
que é interativo). Aqui os arquivos saem prontos para **copiar e colar no navegador**.

Os `.ts` desta pasta são **build, não fonte** — por isso ficam fora do git. A fonte
continua em `supabase/functions/`. Editar aqui não tem efeito: regenere.

## Regenerar

```bash
npx esbuild supabase/functions/asaas-sync/index.ts \
  --bundle --format=esm --platform=neutral --external:https://* \
  --outfile=deploy-manual/asaas-sync.ts
```

Trocando o nome para `asaas-webhook`, `analisar-contrato`, etc.

O `--bundle` inlina os imports locais (`../_shared/asaas.ts`, `../_shared/telefone.ts`)
num arquivo só, porque o editor do Dashboard trabalha melhor com arquivo único.
O `--external:https://*` preserva os imports remotos do Deno — sem isso o esbuild
tentaria baixar `deno.land` e `esm.sh` e o bundle quebraria.

## Ordem de colar

A ordem importa: o SQL primeiro, senão o `Salvar Contrato` continua batendo no CHECK.

### 1. SQL — `contratos-status-vigente.sql`

Dashboard → **SQL Editor** → New query → colar o conteúdo → **Run**.

Amplia o CHECK `chk_contratos_status` para aceitar `VIGENTE` (mais `ARQUIVADO` e
`RESCINDIDO`, que o gerador de alertas já espera). Sem isso o insert da Central de
Contratos falha com erro 23514.

### 2. `asaas-sync.ts`

Dashboard → **Edge Functions** → `asaas-sync` → editar → substituir TODO o conteúdo → **Deploy**.

Destrava duas coisas:
- **Emissão de cobrança**: o telefone deixa de derrubar a criação do pagador. Celular
  válido vai em `mobilePhone`, fixo em `phone`, e o que não dá para salvar simplesmente
  não é enviado. Se o Asaas recusar só por telefone, refaz sem ele. Telefone nunca
  barra; só CPF.
- **Baixa manual**: as ações `receber_em_dinheiro` e `desfazer_recebimento` passam a
  existir, então clicar em "Baixar" marca recebimento em dinheiro no Asaas em vez de
  deixar o boleto aberto.

### 3. `asaas-webhook.ts`

Mesmo caminho, função `asaas-webhook`.

Passa a tratar `PAYMENT_RECEIVED_IN_CASH`, cobrindo a baixa feita direto no painel
do Asaas.

### 4. `analisar-contrato.ts`

Mesmo caminho, função `analisar-contrato`.

A análise passa a devolver as partes como objeto (nome, CPF/CNPJ, telefone, e-mail),
bairro e tipo do imóvel, e entende data por extenso ("21 de agosto de 2026") e valor
em formato brasileiro ("R$ 350.000,00"). É o que faz cliente, valor e data de início
pararem de vir vazios na Central de Contratos.

### 5. `crm-module.sql` — módulo CRM

SQL Editor → colar → **Run**.

Cria `crm_etapas` (pipeline configurável), `crm_oportunidades` (o negócio,
separado do contato) e `crm_tarefas`, com RLS por `corretor_id`. Semeia as 9
etapas para cada corretor e converte cada cliente existente numa oportunidade
preservando a etapa do funil — ninguém perde o lugar. Também adiciona a policy
de UPDATE que faltava em `fachada_leads`, sem a qual converter um lead marcaria
zero linhas em silêncio.

Idempotente: rodar duas vezes não duplica seed nem backfill.

**Depois de aplicar**, ligue a aba na Vercel: `VITE_CRM_ENABLED=true` e redeploy.
Antes disso a aba fica escondida de propósito.

### 6. `crm-upsert-lead.ts` — correção de segurança

Edge Functions → `crm-upsert-lead` → substituir → **Deploy**.

O dedupe por telefone não filtrava `corretor_id` e a função roda com
`service_role` — um lead com telefone repetido em outra imobiliária era lido e
sobrescrito. Corrige também 4 valores que não existem no schema
(`status_funil:'PROPOSTA'`, `tipo_interesse:'ALUGUEL'`, coluna `classificacao`,
`alertas.tipo:'LEAD_QUENTE'`) e que faziam a função falhar.

## Conferir que deu certo

1. **SQL** — Central de Contratos → analisar um contrato → **Salvar Contrato**. Tem que salvar.
2. **asaas-sync** — Aluguéis → emitir a cobrança de um inquilino cujo telefone esteja
   torto. **Tem que sair o boleto.** Um inquilino **sem CPF** tem que continuar bloqueado.
3. **asaas-sync** — "Baixar" numa fatura → conferir no painel do Asaas que ela aparece
   como **recebimento em dinheiro**, não mais como pendente.
4. **analisar-contrato** — reanalisar um contrato e conferir que cliente e data de
   início vêm preenchidos.

## Variáveis que as funções esperam

Já devem estar configuradas (as funções rodam hoje), mas para referência —
Dashboard → Edge Functions → Secrets:

- `ASAAS_API_KEY`, `ASAAS_BASE_URL` (opcional, default produção)
- `GEMINI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

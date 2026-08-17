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

### 7. Back office administrativo

Ordem: SQL primeiro, funções depois. As funções escrevem em tabelas que só
existem depois do SQL.

#### 7.1 `backoffice-TUDO.sql`

SQL Editor → colar o arquivo inteiro → **Run**. Reúne as 5 migrations
`20260814*` na ordem certa. Idempotente.

Depois, promova o primeiro administrador (**uma vez**):

```sql
SELECT public.promover_primeiro_super_admin('seu@email.com');
```

Confira com `backoffice-VERIFICAR.sql`: todas as 11 linhas devem dar `OK`.

> Atenção: esta migration altera `get_corretor_id()` para exigir
> `status = 'ativo'`. É a função da qual dependem as ~30 policies do produto —
> é o que faz suspender conta valer no backend. Ela faz o backfill antes e
> aborta se sobrar corretor sem status, mas prefira horário de baixo movimento.

#### 7.2 `parceiro-clique.ts` (função NOVA)

Edge Functions → **Create a new function** → nome exato `parceiro-clique` →
colar → **Deploy**.

Depois, em **Settings** da função, **desmarque "Verify JWT"**. Ela roda antes de
existir conta — é o primeiro contato do visitante com a Lotti. A validação é o
slug: só link ativo de parceiro ativo registra clique.

#### 7.3 `parceiro-atribuir.ts` (função NOVA)

Mesmo caminho, nome exato `parceiro-atribuir`. **Mantenha "Verify JWT" ligado** —
só um usuário autenticado pode reivindicar a própria origem.

#### 7.4 Secrets recomendados

Edge Functions → Secrets:

- `PARCEIRO_ORIGENS_PERMITIDAS` — origens aceitas no CORS, separadas por
  vírgula (ex.: `https://seu-dominio.com.br`). Vazio aceita qualquer origem.
- `IP_HASH_SALT` — salt do hash de IP nos cliques. Sem ela, usa a service role
  key como salt.

E na Vercel: `VITE_PUBLIC_BASE_URL` com o domínio de produção, senão os links de
parceiro saem com o domínio de fallback.

### 8. Notificações do Asaas e baixa automática de repasse

Ordem: SQL primeiro, função depois — a função chama RPCs que o SQL cria.

#### 8.1 `notificacoes-asaas.sql`

SQL Editor → colar → **Run**. Cria os tipos de alerta `PAGAMENTO` e
`TRANSFERENCIA`, adiciona `origem`/`entidade_tipo`/`entidade_id`/`metadata` a
`alertas`, o rastro da transferência em `repasses_proprietario`, e as funções
`conciliar_transferencia_repasse()` e `registrar_alerta_financeiro()`.

#### 8.2 `asaas-webhook.ts`

Edge Functions → `asaas-webhook` → substituir TODO o conteúdo → **Deploy**.

Passa a tratar `TRANSFER_*`, que antes caía no descarte de "eventos sem
payment". Agora: transferência concluída dá baixa no repasse
(`status = 'CONFIRMADO'`) e notifica com o nome do proprietário; transferência
falhada devolve o repasse para `ERRO` com prioridade alta.

#### 8.3 Ativar os eventos de transferência no Asaas

Painel do Asaas → **Integrações → Webhooks** → editar o webhook existente →
marcar os eventos **TRANSFER_CREATED, TRANSFER_PENDING,
TRANSFER_IN_BANK_PROCESSING, TRANSFER_DONE, TRANSFER_FAILED,
TRANSFER_CANCELLED**.

Sem esse passo o resto não acontece: o Asaas simplesmente não envia
transferência se o evento não estiver marcado.

#### Como a conciliação encontra o repasse

`repasses_proprietario.external_id` existe desde 20260122130000 mas nunca foi
preenchido — nada no código cria transferência pelo Asaas, o PIX é feito por
fora. Então a função tenta, em ordem:

1. `external_id` — transferência criada pelo sistema (prova direta);
2. `externalReference` — o id do repasse colado à mão no Asaas (prova direta);
3. **valor exato + chave PIX do proprietário**, entre repasses em aberto.

O caso 3 é o real hoje. E ele só dá baixa se houver **exatamente um**
candidato: dois repasses de mesmo valor para a mesma chave são
indistinguíveis, e escolher um seria adivinhar com dinheiro de terceiro. Nesse
caso o repasse fica intocado e a pendência é registrada.

**Para tornar a conciliação exata**, preencha o campo "Referência externa" com
o id do repasse ao criar a transferência no painel do Asaas — aí cai no caso 2.

## Conferir que deu certo

1. **SQL** — Central de Contratos → analisar um contrato → **Salvar Contrato**. Tem que salvar.
2. **asaas-sync** — Aluguéis → emitir a cobrança de um inquilino cujo telefone esteja
   torto. **Tem que sair o boleto.** Um inquilino **sem CPF** tem que continuar bloqueado.
3. **asaas-sync** — "Baixar" numa fatura → conferir no painel do Asaas que ela aparece
   como **recebimento em dinheiro**, não mais como pendente.
4. **analisar-contrato** — reanalisar um contrato e conferir que cliente e data de
   início vêm preenchidos.
5. **Back office** — entrar em `/admin`. Se aparecer a tela "Back office ainda não
   instalado", o SQL não rodou. Se voltar para o dashboard, falta a promoção.
6. **Link de parceiro** — no painel, criar um parceiro, definir percentual e gerar
   o link. Abrir `/r/<slug>` em **aba anônima**: deve redirecionar para `/auth` com
   a faixa "Você chegou pela indicação de ...". Se a faixa não aparecer, a função
   `parceiro-clique` não está publicada ou está com "Verify JWT" ligado.
   Conferir no SQL Editor: `SELECT count(*) FROM parceiro_cliques;` deve ter subido.

## Variáveis que as funções esperam

Já devem estar configuradas (as funções rodam hoje), mas para referência —
Dashboard → Edge Functions → Secrets:

- `ASAAS_API_KEY`, `ASAAS_BASE_URL` (opcional, default produção)
- `GEMINI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

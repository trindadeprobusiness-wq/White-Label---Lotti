# Central de Rotina e Google Agenda

Este documento cobre a ativação operacional da Central de Rotina. O login social
descrito em `infra/OAUTH.md` e a conexão da agenda são dois clientes OAuth
separados: a sessão continua sendo da Lotti; conectar uma agenda apenas autoriza
o acesso ao Google Calendar daquela pessoa.

## Arquitetura entregue

- `routine_events` e `routine_tasks` são a fonte operacional da Lotti. Datas são
  armazenadas como `TIMESTAMPTZ` em UTC e apresentadas no fuso da organização.
- `routine_memberships` e as políticas RLS isolam organizações. Compromissos
  privados só são legíveis pelo responsável/criador; colegas recebem apenas o
  resultado `Horário ocupado` ao consultar conflito.
- Tokens, PKCE, sync tokens, mappings e canais de watch não são acessíveis pela
  Data API autenticada. Access/refresh tokens e sync tokens usam AES-256-GCM;
  state OAuth e channel tokens são persistidos somente como hash SHA-256.
- `google-calendar-auth` cuida de iniciar, concluir e revogar OAuth.
- `google-calendar-sync` faz importação/exportação incremental, trata `410 Gone`
  com full sync, renova access token, usa `etag` para detectar concorrência e
  mantém canais `events.watch`.
- `google-calendar-webhook` valida canal, resource ID, token e expiração, grava
  recibo idempotente e dispara sync incremental.
- Eventos criados na Lotti recebem um ID determinístico no Google e
  `extendedProperties.private`, evitando duplicatas em retries.

## 1. Aplicar o banco

A migration é `supabase/migrations/20260821004218_rotina_operacional.sql`.

Em um projeto ligado pelo CLI:

```bash
npx supabase db push
```

Sem vínculo local, abra o SQL Editor do projeto, execute a migration e depois o
teste manual `supabase/tests/routine_rls.sql` em um ambiente de staging. O teste
usa transação e encerra com `ROLLBACK`.

## 2. Configurar o Google Cloud

1. Crie ou selecione um projeto no Google Cloud Console.
2. Ative a **Google Calendar API**.
3. Configure a tela de consentimento OAuth. Durante o modo de teste, cadastre os
   e-mails autorizados. Para uso público, finalize a publicação/verificação que o
   Google solicitar para os escopos escolhidos.
4. Crie credenciais **OAuth client ID → Web application**.
5. Cadastre exatamente esta URI de redirecionamento:

   ```text
   https://SEU-PROJETO.supabase.co/functions/v1/google-calendar-auth/callback
   ```

O fluxo solicita `calendar.events`, `calendar.calendarlist.readonly`,
`userinfo.email` e `openid`, com acesso offline e consentimento incremental.

Referências oficiais: [OAuth 2.0 para aplicações web](https://developers.google.com/identity/protocols/oauth2/web-server),
[sincronização incremental](https://developers.google.com/workspace/calendar/api/guides/sync) e
[push notifications](https://developers.google.com/workspace/calendar/api/guides/push).

## 3. Cadastrar secrets no Supabase

Gere duas chaves independentes. Exemplo com OpenSSL:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Cadastre os valores reais no Supabase; nunca em `.env` do Vite:

```bash
npx supabase secrets set \
  GOOGLE_CALENDAR_CLIENT_ID="...apps.googleusercontent.com" \
  GOOGLE_CALENDAR_CLIENT_SECRET="..." \
  GOOGLE_TOKEN_ENCRYPTION_KEY="BASE64_DE_32_BYTES" \
  GOOGLE_CALENDAR_REDIRECT_URI="https://SEU-PROJETO.supabase.co/functions/v1/google-calendar-auth/callback" \
  GOOGLE_CALENDAR_WEBHOOK_URL="https://SEU-PROJETO.supabase.co/functions/v1/google-calendar-webhook" \
  GOOGLE_CALENDAR_APP_REDIRECT_URL="https://SEU-DOMINIO/configuracoes?tab=agenda" \
  ROUTINE_INTERNAL_SECRET="HEX_ALEATORIO_INDEPENDENTE"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas
automaticamente às Edge Functions hospedadas pelo Supabase.

## 4. Publicar as funções

```bash
npx supabase functions deploy google-calendar-auth --no-verify-jwt
npx supabase functions deploy google-calendar-sync --no-verify-jwt
npx supabase functions deploy google-calendar-webhook --no-verify-jwt
npx supabase functions deploy routine-command --no-verify-jwt
```

O `--no-verify-jwt` é necessário para callback e webhook, mas não deixa as rotas
abertas: as funções validam a sessão Lotti, state OAuth ou
`x-routine-internal-secret` de acordo com a operação.

## 5. Manutenção programada

Agende uma chamada a cada 30 minutos para renovar watches próximos da expiração
e sincronizar conexões ativas. No Supabase Cron, mantenha o segredo no Vault e
envie:

```http
POST /functions/v1/google-calendar-sync
Content-Type: application/json
x-routine-internal-secret: <valor no Vault>

{"action":"maintain"}
```

Não salve o segredo diretamente no SQL do cron. Use o Vault/Secrets recomendado
pela documentação do Supabase: [Cron](https://supabase.com/docs/guides/cron) e
[Vault](https://supabase.com/docs/guides/database/vault).

## 6. Checklist de homologação real

1. Entrar na Lotti e abrir **Configurações → Agenda**.
2. Conectar uma conta Google de teste e selecionar calendários/direções.
3. Criar, mover, redimensionar, concluir e excluir um compromisso Lotti; confirmar
   o mesmo resultado no Google sem duplicata.
4. Criar, alterar e cancelar um evento no Google; confirmar a importação após o
   webhook/sync manual.
5. Repetir a notificação com o mesmo message number e confirmar resposta
   idempotente.
6. Revogar o app na conta Google e confirmar estado `expired` com reconexão clara.
7. Validar dois usuários/duas organizações, incluindo colisão com compromisso
   privado exibida apenas como `Horário ocupado`.

Sem Client ID/Secret e acesso ao projeto Supabase de destino, o código pode ser
validado localmente, mas OAuth, webhook público e sincronização real só podem ser
homologados depois destes passos.

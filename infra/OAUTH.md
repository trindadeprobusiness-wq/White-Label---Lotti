# Login com Google e Microsoft

O botão Google faz parte fixa da tela de login. Microsoft é opcional e só
aparece quando listado em `VITE_OAUTH_PROVIDERS`.

Para o Google aceitar contas novas, além de configurar o provedor, o projeto
precisa permitir novos cadastros em **Authentication → Settings**. Com
`disable_signup` ativo, nem o cadastro por e-mail nem o primeiro acesso Google
conseguem criar uma conta.

## Onde o Supabase precisa receber a volta

O provedor precisa aceitar esta URL de retorno (a mesma nos dois):

```
https://dqlolypbmsjgqrvdesev.supabase.co/auth/v1/callback
```

E o Supabase precisa saber para onde mandar o usuário depois — Dashboard →
**Authentication → URL Configuration → Redirect URLs**, incluindo:

```
https://olivercrm.vercel.app/**
http://localhost:8085/**
```

Sem o `localhost` você não consegue testar antes de publicar.

## Google

1. Google Cloud Console → **APIs e Serviços → Tela de consentimento OAuth**.
   Tipo **Externo**, preencha nome do app, e-mail de suporte e domínio.
2. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**.
   - *URIs de redirecionamento autorizados*: a URL de callback acima.
3. Copie **Client ID** e **Client Secret**.
4. Supabase → **Authentication → Providers → Google** → habilite e cole os dois.

Enquanto a tela de consentimento estiver em "Teste", só os e-mails que você
listar como testadores conseguem entrar. Publique antes de abrir para clientes.

## Microsoft (Azure)

1. Portal do Azure → **Microsoft Entra ID → Registros de aplicativo → Novo registro**.
   - *Tipos de conta*: "Contas em qualquer diretório organizacional e contas
     Microsoft pessoais" — senão quem usa Outlook/Hotmail pessoal fica de fora.
   - *URI de Redirecionamento*: tipo **Web**, com a URL de callback acima.
2. **Certificados e segredos → Novo segredo do cliente**. Copie o *Valor* na
   hora: ele não é exibido de novo.
3. Anote o **ID do aplicativo (cliente)**.
4. Supabase → **Authentication → Providers → Azure** → habilite, cole ID e
   segredo. Em *Azure Tenant URL* use `https://login.microsoftonline.com/common`
   para aceitar qualquer conta.

O segredo do cliente **expira** (6, 12 ou 24 meses). Anote a data: quando vencer,
o login para de funcionar sem aviso nenhum.

## Ligar Microsoft na aplicação (opcional)

Depois de configurado, na Vercel (e no `.env` local):

```
VITE_OAUTH_PROVIDERS=microsoft
```

## O que ainda precisa de atenção

**Usuário social entra sem CNPJ e sem telefone.** O trigger `handle_new_user`
cria o corretor para qualquer usuário novo do auth, mas o Google não envia esses
campos. O cadastro manual grava o CNPJ; uma conta criada diretamente pelo Google
continua com esses dados pendentes para um onboarding futuro.

**Mesmo e-mail em métodos diferentes.** Por padrão o Supabase vincula contas com
e-mail verificado igual, então quem criou conta com senha e depois entra pelo
Google cai no mesmo usuário. Confirme em **Authentication → Providers → Allow
account linking** se esse é o comportamento que você quer.

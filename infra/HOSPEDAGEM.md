# Onde hospedar a Evolution API

A Evolution é um servidor que fica ligado 24/7 com Postgres e Redis ao lado.
**Vercel e Supabase não servem** — a Vercel roda função sem estado e a Supabase
não hospeda container arbitrário. Precisa de um lugar próprio.

Se a Evolution cair, o WhatsApp do corretor desconecta e ele descobre pelo
cliente reclamando. É por isso que "o mais barato" nem sempre é o certo aqui.

## Comparação

| | Esforço | Custo/mês | Quem cuida de update, backup e TLS |
|---|---|---|---|
| **Railway** | Baixo | ~US$ 5–20 | A plataforma faz TLS, deploy e restart. Backup do volume é configuração sua. |
| **Fly.io** | Médio | ~US$ 5–15 | TLS automático. Volume e Postgres exigem mais configuração manual. |
| **Hetzner / VPS** | Alto | ~€ 4–8 | **Tudo é você**: TLS, firewall, updates de SO, backup, monitoramento. |
| **Render** | Baixo | ~US$ 7–25 | Parecido com Railway; disco persistente é pago à parte. |

### Recomendação: **Railway**

Não por ser o mais barato — é porque o gargalo aqui é operação, não dinheiro.
A diferença entre Hetzner e Railway é de uns 10 dólares por mês; a diferença de
trabalho é enorme. TLS, reinício automático e deploy saem de graça, e a Evolution
precisa exatamente disso: ficar de pé sozinha.

VPS só compensa quando já existe alguém cuidando de servidor no dia a dia.
Deixar um Postgres com WhatsApp de clientes sem backup e sem monitoramento é
assumir um risco que não aparece até o dia em que aparece.

## Passo a passo (Railway)

1. Criar projeto e apontar para este repositório, pasta `infra/`.
2. Serviços: **Postgres** e **Redis** pelo catálogo do Railway (ele já cuida de
   backup e credenciais) — mais barato de operar que subir os containers à mão.
3. Serviço da API a partir da imagem `evoapicloud/evolution-api:v2.3.7`.
   **Fixe a versão.** `:latest` já derrubou muita gente numa atualização silenciosa.
4. Variáveis: copiar de `.env.example`, com
   - `AUTHENTICATION_API_KEY` = **chave NOVA** (ver aviso abaixo)
   - `SERVER_URL` = a URL pública que o Railway gerar
   - `DATABASE_*` / `REDIS_URI` = apontando para os serviços do passo 2
5. Anotar a URL pública. **É ela que eu preciso** para escrever a integração.

Rodando em VPS, use `docker-compose.prod.yml` com um proxy TLS na frente
(Caddy resolve certificado sozinho). O compose já deixa a API só no loopback
justamente para o proxy ser a única porta de entrada.

## Antes de expor à internet

**Gere uma chave nova.** A `AUTHENTICATION_API_KEY` atual esteve em texto puro em
`infra/README.md` e `scripts/automation/README.md`, ambos versionados — ela
**continua no histórico do git** e não sai de lá sem reescrever o histórico. É a
chave de administrador de toda a Evolution: quem a tem cria, lê e apaga qualquer
instância, de qualquer cliente.

Confira também:
- Postgres e Redis **sem porta pública** (o `prod` já faz isso)
- `evolution-manager` **fora do ar** no dia a dia (`--profile manager` só quando precisar)
- Backup do volume `evolution_instances` — é onde vivem as sessões pareadas;
  perder o volume significa todo mundo escaneando QR de novo
- `CORS_ORIGIN` restrito ao domínio do Lotti, não `*`

## Licença — obrigação que vale para o Lotti

A Evolution é Apache 2.0 **com condições adicionais**. A 1.b diz que projetos
proprietários que a utilizam precisam **exibir aviso visível no sistema** de que
a Evolution API está em uso, acessível em Configurações ou na documentação —
sob pena de exigir licença comercial.

Isso será construído junto com a integração (um aviso em Configurações). Não é
detalhe estético: é condição de uso. Para dúvidas de interpretação,
`contato@evolution-api.com`. *Leitura técnica, não parecer jurídico.*

## O que ainda depende do Supabase

Mesmo com a Evolution no ar, a integração precisa de:
- **1 migration** — tabela de instâncias por corretor (nome, token, status,
  último pareamento) com RLS, para o WhatsApp de uma imobiliária não enxergar o
  de outra;
- **4 Edge Functions** — criar instância, buscar QR, consultar status e receber
  o webhook das mensagens.

As duas coisas entram na mesma fila de `deploy-manual/`. Sem elas publicadas, a
tela de conexão existe e não conecta.

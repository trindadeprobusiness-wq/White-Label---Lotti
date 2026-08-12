# Infra — Evolution API + Automação Imobiliária

> ⚠️ **SEGREDO EXPOSTO — ação necessária.** A chave de API global da Evolution
> estava em texto puro neste arquivo e em `scripts/automation/README.md`, os dois
> versionados no git. Substituí por `$EVOLUTION_API_KEY`, mas **ela continua no
> histórico do repositório** e não há como apagar de lá sem reescrever o
> histórico. É a chave de **administrador de toda a Evolution API**: gere uma
> nova em `infra/.env` (`AUTHENTICATION_API_KEY`) **antes** de expor esta
> instância à internet. Exporte a nova no shell antes dos comandos abaixo:
> `export EVOLUTION_API_KEY=...`

> **Estado real:** esta stack roda só em `localhost` (Docker Desktop) e **não
> está conectada ao produto**. Nenhuma linha em `src/` fala com a Evolution, não
> existe tabela de instância/sessão no Supabase, e os workflows do n8n são JSONs
> que precisam ser importados à mão. O WhatsApp que o usuário alcança hoje no
> sistema é link `wa.me` com número e texto prontos — não envio automático.

Stack local para WhatsApp Business via Evolution API v2, orquestrada por n8n e integrada ao CRM Supabase.

## Componentes
| Serviço | Porta | Descrição |
|---------|-------|-----------|
| `evolution-api`     | 8080 | Gateway WhatsApp (Baileys) |
| `evolution-manager` | 3030 | UI para gerenciar instâncias/QR |
| `evolution-postgres`| -    | DB interno da Evolution (sessões, chats) |
| `evolution-redis`   | -    | Cache de sessão |

> n8n (separado) deve estar em `http://localhost:5678`. O webhook global da Evolution já aponta para `http://host.docker.internal:5678/webhook/evolution`.

## Subir a stack

```bash
cd infra
docker compose up -d
docker compose ps
docker compose logs -f evolution-api
```

## Criar a instância WhatsApp

```bash
# 1) Criar instância
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceName": "imobiliaria",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'

# 2) Obter QR Code (abrir no manager: http://localhost:3030)
curl http://localhost:8080/instance/connect/imobiliaria \
  -H "apikey: $EVOLUTION_API_KEY"

# 3) Verificar status
curl http://localhost:8080/instance/fetchInstances \
  -H "apikey: $EVOLUTION_API_KEY"
```

Escaneie o QR no WhatsApp do corretor: **WhatsApp → Aparelhos conectados → Conectar aparelho**.

## Encerrar
```bash
docker compose down          # mantém volumes
docker compose down -v       # apaga sessões (precisará reescanear QR)
```

## Observações
- `AUTHENTICATION_API_KEY` no `.env` — **mude em produção**.
- `WEBHOOK_GLOBAL_URL` usa `host.docker.internal`, que funciona em Docker Desktop (Windows/Mac). Em Linux, troque por IP da bridge `172.17.0.1` ou rede compartilhada com o n8n.
- Volumes persistentes: `evolution_instances`, `evolution_postgres`, `evolution_redis`.

## Troubleshooting
- **Instância cai sozinha** → verifique `evolution-postgres` saudável (`docker compose ps`).
- **Webhook não chega no n8n** → confirme que o workflow está publicado e o path do webhook é `/evolution`.
- **QR não aparece** → acesse o manager `http://localhost:3030` com a mesma API key.

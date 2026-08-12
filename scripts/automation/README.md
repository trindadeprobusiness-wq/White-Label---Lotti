# scripts/automation

Jobs Python para manutenção do ecossistema Evolution API + n8n + Supabase.

## Instalação
```bash
python -m venv .venv
source .venv/bin/activate  # ou .venv\Scripts\activate no Windows
pip install -r requirements.txt
```

Configure `.env` (na raiz do projeto ou em `scripts/automation/.env`):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
EVOLUTION_BASE_URL=http://localhost:8080
EVOLUTION_API_KEY=$EVOLUTION_API_KEY
EVOLUTION_INSTANCE=imobiliaria
ADMIN_PHONE=5511999999999
```

## Jobs

- `evolution_health_check.py` — probe `/instance/fetchInstances`; se a instância não estiver `open`, tenta reconectar via `/instance/connect/{name}` e alerta admin.
- `sync_leads_whatsapp.py` — reconcilia `clientes` com `historico_contatos` (WHATSAPP): marca `ultimo_contato` corretamente, detecta leads sem follow-up há > 48h.

Rodar via cron (Linux) ou Task Scheduler (Windows). Exemplo:

```
*/5 * * * * /usr/bin/python /opt/casa-mente/scripts/automation/evolution_health_check.py
0  * * * * /usr/bin/python /opt/casa-mente/scripts/automation/sync_leads_whatsapp.py
```

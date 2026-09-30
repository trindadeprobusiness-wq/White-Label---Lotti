#!/usr/bin/env bash
# ============================================================
# Evolution API — instalação em VPS (Ubuntu/Debian).
#
# Sobe a stack de `docker-compose.prod.yml` com HTTPS automático:
# Docker, segredos gerados na hora, Caddy como única porta de entrada
# e firewall fechado em tudo que não seja 22/80/443.
#
# Uso, como root, dentro da pasta `infra/`:
#   bash vps-setup.sh
#
# Pede o domínio e o webhook do n8n; o resto é automático.
# Rodar de novo é seguro: preserva o .env.prod já existente.
# ============================================================
set -euo pipefail

msg() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
erro() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || erro "Rode como root (use: sudo bash vps-setup.sh)"
[ -f docker-compose.prod.yml ] || erro "Rode de dentro da pasta infra/ (não achei docker-compose.prod.yml)"

# --- 1. Dados que só você sabe ---------------------------------
read -rp "Domínio para a Evolution (ex: evolution.plataformalotti.com.br): " DOMINIO
[ -n "$DOMINIO" ] || erro "O domínio é obrigatório — o HTTPS depende dele."

read -rp "URL do webhook do n8n [deixe vazio se ainda não tem]: " N8N_WEBHOOK
N8N_WEBHOOK="${N8N_WEBHOOK:-}"

read -rp "Origem permitida no CORS (domínio do Lotti) [https://app.plataformalotti.com.br]: " CORS
CORS="${CORS:-https://app.plataformalotti.com.br}"

# --- 2. Docker --------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  msg "Instalando Docker"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg ufw
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
else
  msg "Docker já instalado — seguindo"
fi

# --- 3. Segredos ------------------------------------------------
# Chave NOVA de propósito: a antiga vazou no histórico do git.
if [ -f .env.prod ]; then
  msg "Reaproveitando .env.prod existente (não sobrescrevo segredos em uso)"
else
  msg "Gerando .env.prod com segredos novos"
  API_KEY="$(openssl rand -hex 32)"
  PG_PASS="$(openssl rand -hex 24)"

  sed \
    -e "s|^AUTHENTICATION_API_KEY=.*|AUTHENTICATION_API_KEY=${API_KEY}|" \
    -e "s|REPLACE_PG_PASSWORD|${PG_PASS}|g" \
    -e "s|^SERVER_URL=.*|SERVER_URL=https://${DOMINIO}|" \
    -e "s|^CORS_ORIGIN=.*|CORS_ORIGIN=${CORS}|" \
    -e "s|^CACHE_REDIS_URI=.*|CACHE_REDIS_URI=redis://evolution-redis:6379/0|" \
    .env.example > .env.prod

  if [ -n "$N8N_WEBHOOK" ]; then
    sed -i -e "s|^WEBHOOK_GLOBAL_URL=.*|WEBHOOK_GLOBAL_URL=${N8N_WEBHOOK}|" .env.prod
  else
    # Sem n8n ainda: webhook desligado em vez de apontar para um host inexistente.
    sed -i -e "s|^WEBHOOK_GLOBAL_ENABLED=.*|WEBHOOK_GLOBAL_ENABLED=false|" .env.prod
  fi

  chmod 600 .env.prod
fi

# --- 4. Caddy: TLS automático, única porta de entrada -----------
msg "Configurando Caddy (HTTPS automático)"
mkdir -p /etc/caddy
cat > /etc/caddy/Caddyfile <<CADDY
${DOMINIO} {
	reverse_proxy 127.0.0.1:8080
	encode gzip
	log {
		output file /var/log/caddy/access.log
		format json
	}
}
CADDY

if ! docker ps -a --format '{{.Names}}' | grep -qx caddy; then
  docker run -d --name caddy --restart always --network host \
    -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
    -v caddy_data:/data -v caddy_config:/config \
    -v /var/log/caddy:/var/log/caddy \
    caddy:2-alpine
else
  docker restart caddy >/dev/null
fi

# --- 5. Firewall ------------------------------------------------
msg "Fechando o firewall (libera só 22, 80 e 443)"
ufw allow 22/tcp  >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# --- 6. Subir a stack -------------------------------------------
msg "Subindo Evolution API + Postgres + Redis"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

msg "Aguardando a API responder"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/ >/dev/null 2>&1; then
    echo "API no ar."
    break
  fi
  [ "$i" -eq 30 ] && erro "A API não respondeu em 60s. Veja: docker compose -f docker-compose.prod.yml logs evolution-api"
  sleep 2
done

# --- 7. Resumo --------------------------------------------------
CHAVE="$(grep '^AUTHENTICATION_API_KEY=' .env.prod | cut -d= -f2-)"
cat <<FIM

============================================================
 Pronto.

 URL pública:  https://${DOMINIO}
 API key:      ${CHAVE}

 A chave acima é de ADMINISTRADOR de toda a Evolution.
 Guarde no gerenciador de senhas e não cole em chat nem no git.
 Ela também está em infra/.env.prod (permissão 600).

 Teste, já com TLS:
   curl https://${DOMINIO}/instance/fetchInstances -H "apikey: \$EVOLUTION_API_KEY"

 Backup obrigatório: volume evolution_instances
 (é onde vivem as sessões pareadas; sem ele, todo mundo reescaneia o QR)
============================================================
FIM

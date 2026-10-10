# Build do front (Vite) e entrega estática pelo Caddy, para o Railway.
# Reproduz no Caddyfile o que o vercel.json faz na Vercel.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Variáveis VITE_* entram no bundle em tempo de build; o Railway as passa como build args.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_PUBLIC_BASE_URL
ARG VITE_CRM_ENABLED
ARG VITE_OAUTH_PROVIDERS
ARG VITE_UTMIFY_WEBHOOK_URL
# Sem ela o front segue inteiro no Supabase; com ela, passa a usar a API do Railway.
ARG VITE_API_URL
RUN npm run build

FROM caddy:2.10.2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

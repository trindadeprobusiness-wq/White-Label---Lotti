# Plano: tudo dentro do Railway (2026-10-06)

Meta: o **app** fala só com a **api**; a api usa **Postgres**, **Redis** e **garage**. Nenhuma tela,
função, cron ou arquivo depende do Supabase. Depois disso, **uma** virada (etapas C e D de
`docs/virada-amanha.md`, com os mesmos scripts) e o Supabase vira cópia parada.

Regra que causou a volta de hoje: com o login da API, o front **não tem sessão do Supabase**.
Qualquer `supabase.from/rpc/storage/functions.invoke` que sobrar no front quebra. Por isso nada
vira antes de **zero** chamadas diretas sobrarem (B9 confere).

| Bloco | Quem | O quê |
|---|---|---|
| B0 Base | Claude | `chamarApi` com o token do login próprio; CORS com cookie entre app e api; perfil do corretor na API (`crmStore.fetchCorretor/updateCorretor`); fim do `rpc('get_corretor_id')` no front; cadastro de conta na API; pós-login (registrar atividade, atribuição de parceiro); histórico sem cliente; leads pendentes das fachadas |
| B1 Mídias e documentos | Claude | linhas de `imovel_fotos` e `videos` pela API; Storage `documentos` no rental (AutoContract, NewContract, BillsList, ContractUpload, ContractsList); `contratos.arquivo_url` e CPF do cliente; `asaas-sync` do NewContractDialog; `webhook_logs` da venda; diagnóstico comercial e URL do lead-capture |
| B2 IA | Claude | módulo `ia`: ai-assistant (SSE + ferramentas), ai-action, ai-process-file (Garage), analisar-foto, analisar-fotos-imovel, generate-whatsapp-message, inbox-suggest; `ai_conversations`/`ai_messages`; front (`useAIChat`, `AIConversationList`, `OrganizarFotosIA`, `FotosIA`, `GenerateMessageDialog`, `WhatsAppDialog`, `ReplySuggestion`, fallback do `contractExtractionService`) |
| B3 WhatsApp | **Codex** | módulo `whatsapp`: ações do `lotti-whatsapp` (status/connect/disconnect/start/send/prepare_upload), tabelas e RPCs do Inbox, upload pelo Garage, broadcasts, configurações do agente, conversas esperando; front do Inbox; o runtime/ponte passa a usar Postgres/API do Railway |
| B4 Público e n8n | Claude | public-imoveis, imovel-detalhe, lead-capture (rotas públicas); crm-upsert-lead / crm-buscar-imoveis / crm-anexar-historico com segredo |
| B5 Agendamentos | Claude | BullMQ: gerar-faturas-mensais, marcar-faturas-atrasadas, gerar-alertas-vencimento, sweeper de PROCESSING; maintain do Google já existe |
| B6 Suporte admin | Claude | impersonação pela API (token de suporte curto, auditado), no lugar da Edge `admin-suporte` |
| B7 E-mail | Você + Claude | Reply-To e DNS do Resend (sua autorização) → recuperação de senha e confirmação de cadastro |
| B8 Google callback | Claude | `GOOGLE_CALENDAR_REDIRECT_URI` e Caddyfile na virada |
| B9 Ensaio de verdade | Você + Claude | serviço **app-teste** no Railway com `VITE_API_URL`, apontando para a cópia; você usa o app inteiro com login real; grep confirma zero chamadas diretas ao Supabase |
| Virada final | Todos | etapas C e D, recopiando tudo (nada se perde: o Supabase segue sendo a fonte até lá) |

Regras: segredos só por nome; nada de escrita na produção sem OK; ≤3 frentes simultâneas na máquina.

# WL-G2 F0 — matriz estática dos Prisma models

## Escopo, base e limites

- Artefato documental de manutenção derivado fielmente da matriz produzida no transcript WL-G2 F0.
- Cobertura esperada e verificada ao final: 122 models do `api/prisma/schema.prisma` do clone candidato observado no inventário.
- Cada linha registra model, tabela SQL/`@@map` e linha inicial no schema (`S`), ownership atual e chave, evidência lexical de RLS/policy/grant, FKs/pais relevantes, classificação inicial e pendência.
- Este é um **inventário lexical/estático**. Não foi validado contra catálogo remoto, dados, roles efetivos, migrations aplicadas ou comportamento dinâmico de RLS.
- Ownership e chaves atuais são fatos reportados; qualquer direção de adaptação é somente hipótese condicionada ao contrato de Produto/Arquitetura, ao gate aplicável e, quando material, a checkpoint humano. A matriz não cria requisito de produto.
- Nenhum SQL, migration ou teste foi executado para produzir ou persistir este documento. Nenhum segredo ou dado real foi lido.

Base registrada no transcript de origem:

- Clone candidato: branch `docs/wl-g0-g1-handoff`, HEAD `ec4c928a15143de71df8beb29654d37d5acffdd0`.
- `api/prisma/schema.prisma`: SHA-256 `397E7E75145B2DEA50AAB8BEE1851D39F0F0FE081A877E2200E0690EBF323396`.
- `sistema/lotti-white-label/g1-database.md`: SHA-256 `CA20FB944CD058C1DE6E6174F5F505BA62945CC91E54FCC9BFFD1086510611DD`.

Legenda da coluna RLS:

- `P+G+`: policy e grant/revoke específicos encontrados lexicalmente.
- `P−G+`: RLS e grants encontrados, mas nenhuma policy própria; normalmente backend/owner/service.
- `P−G−`: RLS encontrado, sem grant/policy explícito para papéis de aplicação.
- `dyn`: configuração feita por SQL dinâmico.
- Os códigos registram presença textual, não efetividade, cobertura semântica ou segurança validada.

## Matriz completa — 122 models

| # | Model → tabela/fonte | Ownership atual | RLS | FKs/pais relevantes | Classificação inicial / pendência |
|---:|---|---|---|---|---|
| 1 | `AdminAuditoria` → `admin_auditoria` S163 | global; ator `ator_user_id` | P+G+ | referência lógica a `auth.users` | Reutilizar como auditoria do operador; separar ações globais e do tenant. |
| 2 | `AdminConfig` → `admin_config` S185 | global | P+G+ | `atualizado_por → auth.users` lógico | Reutilizar; impedir configuração global de virar configuração de marca implicitamente. |
| 3 | `AdminSessaoSuporte` → `admin_sessoes_suporte` S197 | identity + legacy `corretor_id` | P+G+ | `corretor_id → corretores`, NoAction | Adaptar suporte para tenant explícito; não inferir organização apenas pelo corretor. |
| 4 | `AiAttachment` → `ai_attachments` S216 | herdado da mensagem | P+G+ | `message_id → ai_messages`, Cascade | Adaptar; provar cadeia attachment→message→conversation→tenant. |
| 5 | `AiConversation` → `ai_conversations` S235 | legacy `corretor_id` | P+G+ | `corretor_id → corretores`, Cascade | Adaptar para organização; manter histórico durante backfill. |
| 6 | `AiMessage` → `ai_messages` S255 | herdado da conversa | P+G+ | `conversation_id → ai_conversations`, Cascade | Adaptar; policy deve autorizar pela conversa, não por ID isolado. |
| 7 | `AiRateLimit` → `ai_rate_limits` S274 | legacy `corretor_id` | P+G+ | `corretor_id → corretores`, Cascade | Preservar rate limit por corretor e semântica atuais. Mudança ligada a plano, limite ou tenant somente sob Gate 6 ou decisão explícita aplicável de Gabriel; não prescrever quota por tenant. |
| 8 | `Alerta` → `alertas` S288 | legacy `corretor_id` | P+G+ | `cliente_id → clientes`; `corretor_id → corretores`, Cascade | Adaptar; validar cliente e corretor no mesmo tenant. |
| 9 | `AsaasCheckoutEvent` → `asaas_checkout_events` S314 | public/global, sem tenant direto | P−G+ | nenhuma FK Prisma | Parcial; resolver ownership pelo identificador de checkout antes de qualquer exposição. |
| 10 | `AsaasConexao` → `asaas_conexoes` S332 | legacy `corretor_id` | P+G+ | `corretor_id → corretores`, Cascade | Adaptar com cuidado financeiro; tenant não pode vir do payload externo. |
| 11 | `AsaasConexaoSegredo` → `asaas_conexao_segredos` S361 | herdado da conexão | P−G+ | `conexao_id → asaas_conexoes`, Cascade | Reutilizar backend-only; provar acesso somente via conexão escopada. |
| 12 | `AsaasWebhookEvent` → `asaas_webhook_events` S376 | legacy opcional `corretor_id` | P+G+ | `corretor_id → corretores`, SetNull | Parcial; eventos não resolvidos exigem fila global controlada. |
| 13 | `AtividadeEvento` → `atividade_eventos` S398 | misto identity `user_id` + legacy `corretor_id` | P+G+ | FK de corretor, Cascade | Adaptar; distinguir ator, tenant afetado e backoffice. |
| 14 | `AuditoriaFinanceira` → `auditoria_financeira` S418 | legacy `corretor_id` | P+G+ | sem FK Prisma para corretor | Adaptar; falta integridade referencial Prisma e tenant canônico. |
| 15 | `AuthPasswordTokem` → `auth_password_tokens` S438 | identity `user_id` | P−G− | `user_id → usuarios`, Cascade | Reutilizar backend-only; typo do nome Prisma é legado, não tabela nova. |
| 16 | `AuthRefreshTokem` → `auth_refresh_tokens` S455 | identity `user_id` | P−G− | `user_id → usuarios`, Cascade | Reutilizar backend-only; não subordinar token a tenant único. |
| 17 | `BillingLegacyAccount` → `billing_legacy_accounts` S475 | legacy `corretor_id` | P−G+ | `corretor_id → corretores`, NoAction | Preservar ownership por corretor e regra de conta legada atuais. Qualquer mudança de plano, assinatura ou tenant depende de Gate 6 ou decisão explícita aplicável de Gabriel. |
| 18 | `CalendarConnection` → `calendar_connections` S487 | organization `organization_id`; identity `user_id` | P−G+ | organização Cascade | Reutilizar; distinguir credencial pessoal e ownership organizacional. |
| 19 | `CalendarEventMapping` → `calendar_event_mappings` S520 | organization `organization_id` | P−G+ | conexão, calendário, organização e evento, Cascade | Reutilizar; exigir todos os pais na mesma organização. |
| 20 | `CalendarSyncState` → `calendar_sync_states` S547 | herdado de `external_calendar` | P−G+ | calendário externo Cascade | Reutilizar backend-only; sempre resolver tenant pelo calendário pai. |
| 21 | `CalendarWatchChannel` → `calendar_watch_channels` S568 | herdado de `external_calendar` | P−G+ | calendário externo Cascade | Reutilizar backend-only; segredo/channel ID não é prova de tenant sozinho. |
| 22 | `CalendarWebhookReceipt` → `calendar_webhook_receipts` S587 | global/unknown | P−G+ | nenhuma FK Prisma | Parcial; vincular deterministicamente a watch channel/tenant ou documentar retenção global. |
| 23 | `CancelamentoFeedback` → `cancelamento_feedback` S603 | legacy opcional `corretor_id` | P+G+ | corretor SetNull | Adaptar; decidir se feedback pertence ao tenant ou operador SaaS. |
| 24 | `CentralComercialDespesa` → `central_comercial_despesas` S628 | user `owner_id` | P+G+ | venda SetNull | Preservar escopo pessoal atual; validar integridade de `owner_id` com a venda não migra ownership. Compartilhamento organizacional exige contrato específico de Produto/Arquitetura e checkpoint humano. |
| 25 | `CentralComercialInteracao` → `central_comercial_interacoes` S648 | user `owner_id` | P+G+ | lead Cascade; roteiro SetNull | Preservar escopo pessoal atual; validar o mesmo `owner_id` entre lead, roteiro e interação. Compartilhamento organizacional é condicional a contrato específico e checkpoint humano. |
| 26 | `CentralComercialLead` → `central_comercial_leads` S674 | user `owner_id` | P+G+ | pai de interação/venda | Preservar isolamento pessoal atual. Qualquer compartilhamento organizacional depende de contrato específico de Produto/Arquitetura e checkpoint humano. |
| 27 | `CentralComercialProjecaoConfig` → `central_comercial_projecao_config` S712 | user `owner_id` | P+G+ | nenhuma FK Prisma | Preservar configuração pessoal atual. Mudança de escopo exige contrato específico de Produto/Arquitetura e checkpoint humano. |
| 28 | `CentralComercialRecebimento` → `central_comercial_recebimentos` S734 | user `owner_id` | P+G+ | venda Cascade | Preservar escopo pessoal; validar `owner_id` igual ao da venda não implica migração para tenant. Compartilhamento depende de contrato e checkpoint humano. |
| 29 | `CentralComercialRoteiro` → `central_comercial_roteiros` S753 | user `owner_id` | P+G+ | pai de interações | Preservar roteiro pessoal atual. Sem contrato específico, não inferir ownership organizacional. |
| 30 | `CentralComercialVenda` → `central_comercial_vendas` S771 | user `owner_id` | P+G+ | lead Restrict | Preservar escopo pessoal; a FK não garante por si só o mesmo `owner_id`. Eventual compartilhamento organizacional exige contrato e checkpoint humano. |
| 31 | `CheckoutOrder` → `checkout_orders` S800 | public/identity em provisionamento | P−G+ | pai de pagamentos; usuário provisionado sem relação Prisma | Preservar mapping atual. Qualquer associação a marca ou tenant depende do contrato de onboarding/entrada e da decisão de marca no gate aplicável; não inferir preço, quota ou canal. |
| 32 | `CheckoutPayment` → `checkout_payments` S830 | herdado do pedido | P−G+ | `order_id → checkout_orders`, NoAction | Reutilizar; autorização somente via pedido. |
| 33 | `CheckoutRateLimit` → `checkout_rate_limits` S845 | public | P−G+ | sem FK | Reutilizar como controle público; confirmar hashing, expiração e cleanup. |
| 34 | `Cliente` → `clientes` S858 | legacy `corretor_id` | P+G+ | corretor Cascade | Adaptar; futura chave organizacional e compatibilidade com Rotina. |
| 35 | `ClienteImovel` → `cliente_imovel` S900 | herdado de cliente + imóvel | P+G+ | ambos Cascade | Adaptar; falta constraint que prove cliente e imóvel do mesmo tenant. |
| 36 | `CommercialDiagnostic` → `commercial_diagnostics` S917 | public por `session_id` | P+G+ | sem FK Prisma | Reutilizar fora do tenant operacional; controlar sessão/token. |
| 37 | `CommercialDiagnosticEvent` → `commercial_diagnostic_events` S946 | public por `session_id` | P+G+ | sem FK Prisma | Reutilizar como telemetria pública; retenção e associação precisam contrato. |
| 38 | `ContractQuotaReservation` → `contract_quota_reservations` S961 | legacy `corretor_id` | P−G+ | corretor NoAction | Preservar reserva e ownership por corretor atuais. Alteração de plano, limite, concorrência ou tenant somente sob Gate 6 ou decisão explícita aplicável de Gabriel; não prescrever quota por tenant. |
| 39 | `Contrato` → `contratos` S977 | legacy `corretor_id` | P+G+ | cliente/imóvel Restrict; corretor Cascade | Adaptar com alto cuidado; garantir cliente, imóvel e corretor no mesmo tenant. |
| 40 | `ContratoRenegociacao` → `contratos_renegociacoes` S1025 | legacy `corretor_id` | P+G+ | contrato e corretor Cascade | Adaptar; validar corretor igual ao tenant do contrato. |
| 41 | `Corretor` → `corretores` S1048 | legacy raiz; identity `user_id` único | P+G+ | ponte para quase todo domínio legado | Adaptar: conta-raiz atual não pode permanecer tenant final implícito. |
| 42 | `CrmEtapa` → `crm_etapas` S1129 | legacy `corretor_id` | P+G+ | corretor Cascade | Adaptar para catálogo por organização. |
| 43 | `CrmOportunidade` → `crm_oportunidades` S1150 | legacy `corretor_id` | P+G+ | cliente Cascade; etapa Restrict; imóvel SetNull | Adaptar; validar todos os pais no mesmo tenant. |
| 44 | `CrmTarefa` → `crm_tarefas` S1186 | legacy `corretor_id` | P+G+ | cliente/oportunidade/corretor Cascade | Adaptar; same-tenant entre três pais. |
| 45 | `DiagnosticAiBudget` → `diagnostic_ai_budgets` S1208 | global/public por dia | dyn P−G+ | sem FK | Preservar orçamento global/public por dia e semântica atuais. Orçamento por marca é tema comercial não adotado, não requisito; só pode surgir sob Gate 5/6 ou decisão explícita aplicável de Gabriel. |
| 46 | `DiagnosticAiUsage` → `diagnostic_ai_usage` S1216 | public herdado da sessão | dyn P−G+ | sessão Cascade | Reutilizar backend-only; não expor custos por sessão publicamente. |
| 47 | `DiagnosticAnswer` → `diagnostic_answers` S1228 | public herdado da sessão | dyn P+G+ | sessão Cascade | Reutilizar; acesso administrativo via `is_admin()`. |
| 48 | `DiagnosticEvent` → `diagnostic_events` S1245 | public herdado da sessão | dyn P+G+ | sessão Cascade | Reutilizar; confirmar retenção e dados coletados. |
| 49 | `DiagnosticLead` → `diagnostic_leads` S1260 | public | dyn P+G+ | pai de sessões | Reutilizar fora do tenant; definir eventual transferência para organização. |
| 50 | `DiagnosticNotification` → `diagnostic_notifications` S1283 | public herdado da sessão | dyn P+G+ | sessão Cascade | Reutilizar; envio deve permanecer backend-only. |
| 51 | `DiagnosticRateLimit` → `diagnostic_rate_limits` S1306 | public | dyn P−G+ | sem FK | Reutilizar; validar escopo/hash/expiração. |
| 52 | `DiagnosticSession` → `diagnostic_sessions` S1318 | public por token/sessão | dyn P+G+ | lead SetNull | Reutilizar; token não equivale a autenticação organizacional. |
| 53 | `DiagnosticSummary` → `diagnostic_summaries` S1355 | public herdado da sessão | dyn P+G+ | sessão Cascade | Reutilizar; acesso administrativo somente. |
| 54 | `Documento` → `documentos` S1373 | legacy `corretor_id` | P+G+ | cliente/imóvel SetNull; corretor Cascade | Adaptar; metadado, path e pais devem resolver o mesmo tenant. |
| 55 | `ExternalCalendar` → `external_calendars` S1399 | organization `organization_id`; identity `user_id` | P+G+ | conexão e organização Cascade | Reutilizar; validar conexão, usuário e organização coerentes. |
| 56 | `Fachada` → `fachadas` S1429 | legacy `corretor_id` | P+G+ | imóvel e corretor Cascade | Preservar escopo legacy atual e validar coerência entre fachada, imóvel e corretor. Branding está fora de F0 e depende do gate comercial/arquitetural aplicável. |
| 57 | `FachadaEscaneamento` → `fachada_escaneamentos` S1458 | public, herdado da fachada | P+G+ | fachada Cascade | Reutilizar superfície pública; preservar rate limit e validação da fachada. |
| 58 | `FachadaLead` → `fachada_leads` S1474 | public, herdado da fachada | P+G+ | fachada Cascade; cliente SetNull | Adaptar; única escrita `anon` intencional junto ao escaneamento. |
| 59 | `FachadaTemplate` → `fachada_templates` S1495 | legacy `corretor_id` | P+G+ | corretor Cascade | Preservar escopo legacy atual. Não presumir organização = marca; branding e eventual separação global dependem do gate apropriado e de decisão humana. |
| 60 | `FaturaAluguel` → `faturas_aluguel` S1513 | legacy `corretor_id` | P+G+ | contrato/cliente/imóvel/corretor Cascade | Alto risco: quatro chaves devem pertencer ao mesmo tenant; cascades materiais. |
| 61 | `HistoricoContato` → `historico_contatos` S1562 | herdado do cliente | P+G+ | cliente Cascade | Adaptar; policy deve resolver ownership pelo cliente. |
| 62 | `Imovel` → `imoveis` S1583 | legacy `corretor_id` | P+G+ | corretor Cascade; proprietário SetNull | Adaptar; validar proprietário do mesmo tenant; há leitura pública condicionada. |
| 63 | `ImovelFoto` → `imovel_fotos` S1637 | herdado do imóvel | P+G+ | imóvel Cascade | Adaptar; objeto de storage e metadado precisam compartilhar tenant. |
| 64 | `JobQueue` → `job_queue` S1657 | legacy `corretor_id` | P+G+ | corretor Cascade | BI v2 §8 (linha 609): nenhum produtor localizado no escopo pesquisado; `claim_jobs` existe, sem chamador na API/Edge. Localizar produtor/consumidor externo ou declarar obsoleta com decisão explícita antes de qualquer adaptação. Ownership atual não resolve o consumo desconhecido. |
| 65 | `LancamentoFinanceiro` → `lancamentos_financeiros` S1680 | legacy `corretor_id` | P+G+ | contrato/fatura/imóvel SetNull; corretor Cascade | Alto risco; validar same-tenant antes de aceitar IDs relacionados. |
| 66 | `LeadSemDestino` → `leads_sem_destino` S1705 | unknown/global até atribuição | P−G+ | `atribuido_a → corretores`, SetNull | Parcial; fila global requer transição atômica para tenant. |
| 67 | `LottiAgentBridgeEndpoint` → `lotti_agent_bridge_endpoint` S1725 | global | P+G+ | sem FK | Parcial; endpoint/token global não pode autorizar tenant automaticamente. |
| 68 | `LottiAgentChannel` → `lotti_agent_channels` S1736 | legacy `corretor_id` | P+G+ | corretor Cascade | Adaptar; canal deve ser exclusivo do tenant canônico. |
| 69 | `LottiAgentConversation` → `lotti_agent_conversations` S1759 | legacy `corretor_id` | P+G+ | channel Cascade; cliente SetNull; corretor Cascade | Adaptar; validar channel, cliente e corretor no mesmo tenant. |
| 70 | `LottiAgentMessage` → `lotti_agent_messages` S1810 | herdado da conversa | P+G+ | conversa Cascade | Adaptar; nenhum acesso por `conversation_id` sem escopo do pai. |
| 71 | `LottiAgentOutbox` → `lotti_agent_outbox` S1833 | herdado da conversa | P−G+ | conversa Cascade | Reutilizar backend-only; claims/lease não substituem filtro do tenant. |
| 72 | `LottiAgentSetting` → `lotti_agent_settings` S1850 | legacy `corretor_id` | P+G+ | corretor Cascade | Preservar configuração por corretor. Não presumir organização = marca; eventual mudança é fora de F0 e condicionada ao contrato/gate aplicável. |
| 73 | `LottiAgentUsage` → `lotti_agent_usage` S1863 | legacy `corretor_id` | P−G+ | corretor Cascade | Preservar usage por corretor e semântica atuais. Mudança ligada a plano, limite ou tenant somente sob Gate 6 ou decisão explícita aplicável de Gabriel; não prescrever quota ou assinatura por tenant. |
| 74 | `LottiAutomationHeartbeat` → `lotti_automation_heartbeat` S1879 | global | P+G+ | sem FK | Reutilizar operacionalmente; não expor como estado de tenant. |
| 75 | `LottiBroadcastCampaign` → `lotti_broadcast_campaigns` S1890 | legacy `corretor_id` | P+G+ | corretor Cascade | Adaptar; campanha pertence ao tenant. |
| 76 | `LottiBroadcastDelivery` → `lotti_broadcast_deliveries` S1920 | legacy `corretor_id` | P+G+ | campanha, conversa e corretor Cascade | Adaptar; constraint same-tenant entre os três pais. |
| 77 | `LottiBroadcastEvent` → `lotti_broadcast_events` S1948 | herdado da campanha | P+G+ | campanha Cascade | Adaptar; autorizar sempre pela campanha. |
| 78 | `LottiInboxEvent` → `lotti_inbox_events` S1965 | herdado da conversa | P+G+ | conversa Cascade | Adaptar; acesso pela conversa escopada. |
| 79 | `LottiManualSend` → `lotti_manual_sends` S1984 | legacy `corretor_id` | P−G+ | conversa e corretor NoAction | Adaptar; garantir conversa e corretor do mesmo tenant. |
| 80 | `OnboardingChecklist` → `onboarding_checklist` S2004 | herdado do perfil | P+G+ | perfil Cascade | Reutilizar; ownership sempre pelo perfil. |
| 81 | `OnboardingEvent` → `onboarding_events` S2020 | organization `organization_id`; identity `user_id` | P+G+ | organização e perfil Cascade | Reutilizar; perfil deve pertencer à mesma organização/usuário. |
| 82 | `OnboardingPreference` → `onboarding_preferences` S2042 | herdado do perfil | P+G+ | perfil Cascade | Reutilizar; decidir preferência pessoal versus organizacional. |
| 83 | `OnboardingProfile` → `onboarding_profiles` S2059 | organization `organization_id`; identity `user_id` | P+G+ | organização Cascade | Adaptar seleção: hoje participa da resolução implícita de corretor. |
| 84 | `OnboardingProgress` → `onboarding_progress` S2085 | herdado do perfil | P+G+ | perfil Cascade | Reutilizar; não usar progresso como prova de tenant ativo. |
| 85 | `OnboardingSampleData` → `onboarding_sample_data` S2107 | organization `organization_id`; identity `user_id` | P+G+ | organização Cascade | Reutilizar; cleanup e geração precisam tenant explícito. |
| 86 | `OnboardingStep` → `onboarding_steps` S2126 | herdado do perfil | P+G+ | perfil Cascade | Reutilizar. |
| 87 | `OnboardingTour` → `onboarding_tours` S2143 | herdado do perfil | P+G+ | perfil Cascade | Reutilizar. |
| 88 | `OrganizacaoConvite` → `organizacao_convites` S2162 | organization `organization_id` | P+G+ | organização Cascade | Reutilizar; convite deve casar e-mail autenticado e organização explícita. |
| 89 | `Parceiro` → `parceiros` S2186 | user/identity `user_id`; domínio global | P+G+ | sem FK Prisma para usuário | Preservar ownership e semântica atuais. Parceiro por marca é tema comercial não adotado, não requisito; qualquer mudança depende de Gate 5 ou decisão explícita aplicável de Gabriel. |
| 90 | `ParceiroAtribuicao` → `parceiro_atribuicoes` S2230 | misto parceiro/user/legacy `corretor_id` | P+G+ | parceiro Cascade; corretor/link SetNull | Adaptar; separar attribution global de tenant beneficiário. |
| 91 | `ParceiroClique` → `parceiro_cliques` S2258 | público, herdado do parceiro/link | P+G+ | parceiro e link Cascade | Reutilizar como telemetria pública; validar link pertence ao parceiro. |
| 92 | `ParceiroComissao` → `parceiro_comissoes` S2281 | parceiro + legacy opcional `corretor_id` | P+G+ | atribuição/receita/parceiro Restrict; pagamento/percentual SetNull | Adaptar com trilha financeira; coerência transversal não é garantida pela FK. |
| 93 | `ParceiroLink` → `parceiro_links` S2323 | herdado do parceiro | P+G+ | parceiro Cascade | Preservar escopo atual. Domínio por marca não foi decidido e só pode mudar sob gate comercial/arquitetural e checkpoint humano. |
| 94 | `ParceiroLote` → `parceiro_lotes` S2346 | global/backoffice | P+G+ | pai de itens | Reutilizar no operador; documentar fronteira com tenant. |
| 95 | `ParceiroLoteItem` → `parceiro_lote_itens` S2374 | herdado de lote/parceiro/comissão | P+G+ | lote Cascade; parceiro/comissão Restrict | Reutilizar; validar a mesma cadeia de parceiro. |
| 96 | `ParceiroPagamento` → `parceiro_pagamentos` S2398 | herdado do parceiro | P+G+ | parceiro Restrict | Reutilizar como financeiro do operador; não confundir com tenant. |
| 97 | `ParceiroPercentual` → `parceiro_percentuais` S2424 | herdado do parceiro | P+G+ | parceiro Cascade | Preservar percentual e escopo atuais. Mudança comercial somente sob Gate 5/6 ou decisão aplicável de Gabriel; não inferir nova regra. |
| 98 | `Plan` → `plans` S2447 | global | P+G+ | pai de entitlement/subscription | Preservar catálogo global atual. Preço, branding ou outra semântica comercial só mudam sob Gate 5/6 ou decisão aplicável de Gabriel. Nenhuma entidade ou semântica de revendedor foi adotada. |
| 99 | `PlanEntitlement` → `plan_entitlements` S2469 | global, herdado do plano | P+G+ | plano Cascade | Preservar capabilities atuais do plano. Mudanças por tenant ou marca dependem de Gate 5/6 ou decisão comercial aplicável; não inferir quota. |
| 100 | `PricingCampaign` → `pricing_campaigns` S2490 | global | P+G+ | sem FK | Preservar campanha e escopo atuais. Alteração de preço, canal ou escopo por marca depende de Gate 5/6 ou decisão aplicável de Gabriel. |
| 101 | `Proprietario` → `proprietarios` S2510 | legacy `corretor_id` | P+G+ | corretor Cascade | Adaptar; imóveis e repasses devem compartilhar tenant. |
| 102 | `PublicRequestLimit` → `public_request_limits` S2533 | public | P−G+ | sem FK | Reutilizar; confirmar escopo/hash/expiração. |
| 103 | `ReceitaEvento` → `receita_eventos` S2548 | global + legacy opcional `corretor_id` | P+G+ | corretor SetNull | Adaptar; distinguir receita do operador e evento do tenant. |
| 104 | `RepasseProprietario` → `repasses_proprietario` S2580 | legacy `corretor_id` | P+G+ | contrato Cascade; fatura SetNull; proprietário NoAction | Alto risco; validar todos os pais no mesmo tenant. |
| 105 | `RoutineActivityLog` → `routine_activity_log` S2615 | organization `organization_id`; ator identity | P+G+ | organização Cascade | Reutilizar; manter log imutável e tenant explícito. |
| 106 | `RoutineAutomation` → `routine_automations` S2636 | organization `organization_id` | P+G+ | organização Cascade | Reutilizar; `created_by` é autoria, não ownership. |
| 107 | `RoutineAutomationRun` → `routine_automation_runs` S2662 | organization `organization_id` | P+G+ | automação e organização Cascade | Reutilizar; exigir automação da mesma organização. |
| 108 | `RoutineEntityLink` → `routine_entity_links` S2685 | organization `organization_id` | P+G+ | evento/tarefa/organização Cascade | Reutilizar; parent e link devem compartilhar organização. |
| 109 | `RoutineEvent` → `routine_events` S2707 | organization `organization_id` | P+G+ | cliente, contrato, negócio, imóvel e aluguel SetNull | Reutilizar com adaptação: FKs legadas precisam corresponder ao `legacy_corretor_id` da organização. |
| 110 | `RoutineInbox` → `routine_inbox` S2757 | organization `organization_id`; identity `user_id` | P+G+ | evento/tarefa SetNull; organização Cascade | Reutilizar; itens convertidos devem permanecer na mesma organização. |
| 111 | `RoutineMembership` → `routine_memberships` S2783 | organization + identity | P+G+ | organização Cascade; usuário em `auth.users` Cascade no SQL | Fundação reutilizável; remover unique ativa somente após contexto multi-org explícito. |
| 112 | `RoutineOrganization` → `routine_organizations` S2808 | organization `id`; ponte legacy `legacy_corretor_id` | P+G+ | corretor Cascade; `legacy_corretor_id` único | Fundação canônica proposta; ponte 1:1 não deve ser tenant final. |
| 113 | `RoutinePreference` → `routine_preferences` S2851 | organization + identity | P+G+ | organização Cascade | Reutilizar; chave composta organização/usuário. |
| 114 | `RoutineReminder` → `routine_reminders` S2878 | organization + identity | P+G+ | evento/tarefa/organização Cascade | Reutilizar; evento ou tarefa deve ser da mesma organização. |
| 115 | `RoutineTask` → `routine_tasks` S2903 | organization `organization_id` | P+G+ | cliente, contrato, negócio, imóvel e aluguel SetNull | Reutilizar com mesma adaptação de FKs legadas de `RoutineEvent`. |
| 116 | `RoutineTaskChecklist` → `routine_task_checklists` S2948 | herdado da tarefa | P+G+ | tarefa Cascade | Reutilizar; acesso somente pela tarefa pai. |
| 117 | `Subscription` → `subscriptions` S2965 | legacy `corretor_id` | P+G+ | corretor Cascade; plano NoAction | Preservar assinatura por corretor e plano global atuais. Mudança de escopo, preço ou canal somente sob Gate 5/6 ou decisão comercial aplicável de Gabriel. |
| 118 | `SubscriptionAddon` → `subscription_addons` S2992 | legacy `corretor_id` | P+G+ | subscription e corretor Cascade | Preservar addon por corretor/assinatura; validar coerência atual não migra ownership. Mudanças dependem de Gate 5/6 ou decisão comercial aplicável. |
| 119 | `UsageCounter` → `usage_counters` S3012 | legacy `corretor_id` | P+G+ | corretor Cascade | Preservar contador por corretor e capability atuais. Nova quota ou escopo depende de Gate 5/6 ou decisão comercial aplicável; não inferir regra. |
| 120 | `UserRole` → `user_roles` S3031 | identity `user_id`; global/admin | P+G+ | referência lógica a `auth.users` | Reutilizar como papel do operador; não usar como papel de membership. |
| 121 | `Usuario` → `usuarios` S3051 | identity `id` | P−G− | pai de tokens | Reutilizar; identidade deve poder pertencer a vários tenants. |
| 122 | `WebhookLog` → `webhook_logs` S3068 | global/unknown | P−G+ | sem FK | Parcial; log não pode servir como autorização; revisar payload/retenção. |

## Objetos SQL fora dos 122 models

| Objeto | Situação | Evidência / pendência |
|---|---|---|
| `auth.users` | Tabela de compatibilidade/identidade fora do Prisma | Continua alvo de diversas FKs e de `claims.sub`; não remover antes do mapa completo de dependências. |
| `suporte_privado.credenciais` | Tabela privada backend-only | Criada em `0_init/migration.sql:1599`, FK para sessão de suporte e grant somente a `service_role`. |
| `_backfill_comissoes_20260727` | Histórica, sem PK/FK, RLS sem policy | `20261006180000_tabelas_historicas/migration.sql:5`; tratar como arquivo read-only. |
| `_backup_lancamentos_dup_20260727` | Histórica, sem PK/FK, RLS sem policy | `20261006180000_tabelas_historicas/migration.sql:11`; não usar como domínio. |
| `v_leads_whatsapp` | View `security_invoker` | `0_init/migration.sql:10628`; `authenticated` conserva grants DML excessivos, embora a view tenda a não ser atualizável. |
| `lotti_agent_latest_messages` | View `security_invoker` | `20261009180000_ultima_mensagem_da_conversa/migration.sql:6`; `SELECT` para `authenticated/service_role`. |
| `storage.buckets/objects` | Apenas trilha histórica Supabase | Não fazem parte das migrations Prisma vigentes; não constituem controle atual do Garage. |
| `videos` | Ausente como tabela/model atual | Bucket/rotas existem, mas falta metadado relacional canônico. |
| `ai_runs`, `ai_tool_calls`, `ai_action_proposals` | Ausentes das migrations Prisma atuais | Existem apenas no histórico Supabase conforme G1; decidir portar ou remover conscientemente. |

## Funções, views e triggers relevantes ao isolamento

O G1 contabilizou lexicalmente 236 funções, 81 triggers, 150 policies e 148 índices distintos. Não houve revisão semântica individual de todos.

- `get_corretor_id()` (`0_init/migration.sql:5488`) resolve `auth.uid()` por onboarding + membership ativa e devolve `legacy_corretor_id`; torna-se ambígua com multi-org sem contexto explícito.
- `aceitar_convite_organizacao()` (`0_init/migration.sql:1752`) revoga outras memberships ativas antes de ativar a nova.
- Helpers `private.routine_is_member`, `routine_member_has_role`, `routine_user_is_member`, `routine_can_view_item` e `routine_can_write_item`: reutilizáveis, mas precisam receber/respeitar o tenant selecionado.
- `routine_detect_conflicts` (`0_init/migration.sql:8804`).
- `routine_register_completion` (`0_init/migration.sql:8899`) grava no domínio legado via ponte.
- `tr_ensure_routine_organization` (`0_init/migration.sql:10744`) mantém o espelho corretor→organização.
- `tr_seed_routine_automations` (`0_init/migration.sql:10970`).
- `auditar_suporte`, triggers de timestamp, versionamento/log e validação de links aparecem transversalmente; precisam continuar recebendo contexto correto após a conversão de ownership.
- Funções `SECURITY DEFINER` não foram todas verificadas quanto a `search_path`, `REVOKE PUBLIC` e validação do ator/tenant.

## Unknowns e lacunas transversais

1. Ownership definitivo de `calendar_webhook_receipts`, `leads_sem_destino`, `lotti_agent_bridge_endpoint` e `webhook_logs`. **Evidência reconciliada:** `g2-backend-surface-inventory.md` v2 §8, linhas 599–609, SHA-256 `81CBE3DAAEE8D7559C0BB7D8283DA748D0A4ABA02280DB7E53213E1235B7981C`, identifica escritores/leitores e condições específicas: recibos de calendário técnicos sem tenant direto; leads sem leitor encontrado; endpoint global com chamador de registro não localizado; log de webhook sem consumidor encontrado. A mesma seção reconcilia `JobQueue` (#64), sem produtor localizado. Estes fatos não resolvem ownership definitivo por inferência. **Dono da classificação:** Backend+Segurança para receipts/bridge/webhooks; Produto+Arquitetura/Gabriel para a regra comercial de leads sem destino; Banco+Backend para localizar ou decidir a obsolescência de `JobQueue`. **Saída/gate:** cumprir a condição específica de cada recurso em BI v2 §8 sob brief/checkpoint aplicável; contrato explícito e checkpoint humano antes de alterar ownership. Nenhum desconhecido ou gate é decidido por esta reconciliação.
2. Fronteira operador/tenant nos objetos globais e públicos, incluindo checkout, parceiros, campanhas de preço, auditoria e diagnósticos. **Dono da classificação:** Produto+Arquitetura/Gabriel. **Saída/gate:** decisão comercial/arquitetural explícita no gate aplicável; manter escopo atual até lá.
3. Não existe `tenant_id`/`brand_id` universal. **Dono da classificação:** Produto+Arquitetura/Gabriel, com Banco+Segurança validando viabilidade. **Saída/gate:** checkpoint humano arquitetural antes de qualquer adaptação; F0 não adota nova entidade por si só.
4. Membership ativa única e seleção implícita por `LIMIT 1` continuam incompatíveis com multi-org simultânea. **Dono da classificação:** Produto+Arquitetura define contrato; Backend+Segurança valida contexto. **Saída/gate:** aceite humano do contrato de seleção e ameaça antes de implementação/migration.
5. FKs relacionais provam existência, mas frequentemente não provam mesmo tenant. **Dono da classificação:** Banco+Segurança. **Saída/gate:** manifesto FK/policy por tabela e revisão de migration em ambiente isolado, após autorização própria.
6. Filhos sem chave própria dependem de autorização transitiva pelo pai; isso precisa constar no manifesto de queries/policies. **Dono da classificação:** Banco+Segurança, com Backend nos consumidores. **Saída/gate:** policy e query path classificados por tabela antes do gate de implementação.
7. Central Comercial permanece isolada por pessoa (`owner_id`). **Dono da classificação:** Produto+Arquitetura/Gabriel. **Saída/gate:** preservar escopo pessoal até contrato específico e checkpoint humano; integridade atual não autoriza compartilhamento organizacional.
8. Não há `FORCE ROW LEVEL SECURITY`; conexões owner-level podem contornar policies. **Dono da classificação:** Banco+Segurança. **Saída/gate:** threat model e inventário dos caminhos owner/service aceitos no checkpoint de Segurança; nenhuma mudança automática de RLS.
9. Grants, policies e roles efetivos no catálogo remoto não foram conferidos. **Dono da classificação:** DevOps para acesso/roles remotos; Banco+Segurança para avaliação. **Saída/gate:** permanecem sem inspeção até autorização específica de acesso e escopo.
10. As tabelas históricas têm RLS sem policy e não devem entrar em novos fluxos. **Dono da classificação:** Banco+Segurança. **Saída/gate:** decisão explícita de retenção/arquivo/remoção e checkpoint humano antes de qualquer operação destrutiva.
11. `v_leads_whatsapp` conserva grant DML desnecessário para `authenticated`. **Dono da classificação:** Banco+Segurança. **Saída/gate:** revisão semântica e migration dedicada aprovada; F0 apenas registra o achado.
12. Storage, vídeos e telemetria/propostas de IA permanecem parciais. **Dono da classificação:** Backend+Segurança para Storage/runtime; Produto+Arquitetura/Gabriel para eventual escopo de produto/comercial. **Saída/gate:** inventário de produtores/consumidores e decisão explícita no gate aplicável.
13. `auth.users` continua estruturalmente acoplado ao schema próprio de login. **Dono da classificação:** Backend+Segurança e Banco. **Saída/gate:** mapa completo de FKs/triggers e checkpoint de arquitetura de autenticação antes de desacoplar.
14. Não houve revisão semântica individual das 236 funções, 81 triggers e 150 policies contabilizadas lexicalmente. **Dono da classificação:** Banco+Segurança. **Saída/gate:** revisão dirigida objeto a objeto antes do gate de migration/RLS; contagem lexical não equivale a aceite.
15. Permanecem desconhecidos dados, órfãos, cardinalidade, migrations aplicadas, locks, papel real das conexões owner/service e comportamento dinâmico de RLS. **Dono da classificação:** DevOps para acesso/roles remotos; Banco+Segurança para catálogo, dados, locks e RLS. **Saída/gate:** sem inspeção até autorização específica; depois, registro de estado e ensaio isolado antes de qualquer migration.

## Condição de uso

Esta matriz é uma base de classificação inicial para F0. Completude nominal de 122 models não equivale a isolamento validado nem a autorização para migration, backfill, alteração de policy, deploy ou operação em banco. Branding, preço, quota, canal, compartilhamento organizacional da Central e demais semânticas comerciais ficam fora de F0 e dependem dos gates e checkpoints humanos aplicáveis.

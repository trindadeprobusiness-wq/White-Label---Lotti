-- Ajustes de banco que os contratos dos módulos deixaram propostos (§7.2).
-- Só entra o que é seguro e tem efeito hoje; o resto ficou de fora de propósito:
--   * 'OUTRO' em tipo_contrato: muda o que o front e a IA aceitam; é decisão de produto.
--   * modelo_ia / tempo_geracao_ms / versao em contratos: a API descarta esses campos;
--     a coluna sem código que a escreva seria só peso.
--   * policy única de equipe em documentos: muda quem vê o quê; vai junto com o front.
--   * grants de reserve/finish_contract_quota: a API chama como dona do banco, não precisa.
--   * revoke de anon em contratos: a escrita já saiu em 20261005140000_anon_sem_escrita.

-- 1) documentos.updated_at. O caminho do front pelo Supabase envia a coluna ao editar e
--    validar um documento, e o UPDATE falha porque ela não existe (D2 do contrato).
alter table public.documentos
  add column if not exists updated_at timestamptz not null default now();

-- 2) updated_at mantido pelo banco em contratos e documentos, com a função que as outras
--    tabelas já usam. A API continua escrevendo now() em contratos; o gatilho só garante
--    o mesmo valor para quem não escreve.
drop trigger if exists tr_contratos_updated_at on public.contratos;
create trigger tr_contratos_updated_at before update on public.contratos
  for each row execute function public.update_updated_at_column();

drop trigger if exists tr_documentos_updated_at on public.documentos;
create trigger tr_documentos_updated_at before update on public.documentos
  for each row execute function public.update_updated_at_column();

-- 3) Rotina/Google: um calendário padrão por conexão (a tabela está vazia em produção)
--    e índice para a limpeza periódica dos recibos de webhook.
create unique index if not exists uq_external_calendars_default
  on public.external_calendars (connection_id) where is_default;

create index if not exists idx_calendar_webhook_receipts_received_at
  on public.calendar_webhook_receipts (received_at);

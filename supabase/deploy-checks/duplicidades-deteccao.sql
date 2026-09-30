-- =============================================================================
-- DETECÇÃO DE DUPLICIDADES (D0 a D10) — SOMENTE LEITURA
-- =============================================================================
--
-- NÃO é migration e NÃO altera nada. Não roda sozinho em deploy nenhum.
--
-- Para que serve: medir, antes e depois de publicar as migrations
-- 20260929100000..20260929130000, o que já existe duplicado (clientes com o
-- mesmo telefone, conversas da mesma linha, negócios abertos repetidos, alertas
-- repetidos...). A correção é manual e revisada, par a par (plano, Parte 3,
-- passo 2): nada aqui funde, apaga ou religa.
--
-- Pré-requisitos (rodar depois do passo 1 do deploy, com as migrations antigas
-- que faltam em produção já aplicadas):
--   - public.lotti_phone_key (20260928200000);
--   - lotti_agent_conversations.lid (20260926200000), usado em D2, D7 e D10;
--   - lotti_agent_conversations.opted_out_at (20260927120100), usado em D9b.
-- D1b repete por extenso a regra de public.lotti_phone_key_confiavel
-- (20260929140000) e D2 a de public.lotti_conversation_phone_key
-- (20260929120000), para rodar antes delas.
--
-- Como rodar: o arquivo inteiro fica dentro de uma transação somente leitura
-- terminada em ROLLBACK. As consultas devolvem só ids, contagens e indicadores,
-- sem nomes nem telefones.
-- =============================================================================

begin transaction read only;

-- D0. Tabelas que referenciam clientes (para a mesclagem revisada de clientes).
select c.conrelid::regclass as tabela, a.attname as coluna, c.confdeltype as ao_apagar
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
 where c.confrelid = 'public.clientes'::regclass and c.contype = 'f'
 order by 1, 2;

-- D1. Clientes com a mesma chave de telefone na mesma conta.
--     captura_auto: telefone só com dígitos e 55 (gravado pela captura do WhatsApp).
--     placeholder: nome 'Contato WhatsApp'. Candidato automático a ser o descartado
--     é o cadastro de captura automática; dois ou mais digitados vão para o corretor.
with k as (
  select id, corretor_id, created_at, public.lotti_phone_key(telefone) as chave,
         telefone ~ '^55[0-9]{10,11}$' as captura, nome = 'Contato WhatsApp' as placeholder
    from public.clientes
)
select corretor_id, chave, count(*) as qtd,
       array_agg(id order by created_at) as ids,
       array_agg(captura order by created_at) as captura_auto,
       array_agg(placeholder order by created_at) as placeholder
  from k
 where chave ~ '^[1-9][1-9][mf][0-9]{8}$'
 group by 1, 2
having count(*) > 1
 order by qtd desc;

-- D1b. Chaves que não são celular/fixo brasileiro. Depois de 20260929140000,
--      "estrangeiro" (10 a 15 dígitos, não um dígito repetido) continua bloqueando
--      duplicado; "nao_confiavel" (placeholder, curto, dígito repetido) deixa de
--      contar como telefone para a regra. Só contagens, sem as chaves.
with k as (
  select corretor_id, public.lotti_phone_key(telefone) as chave
    from public.clientes
   where public.lotti_phone_key(telefone) !~ '^[1-9][1-9][mf][0-9]{8}$'
), g as (
  select corretor_id, chave, count(*) as qtd,
         case when chave ~ '^[0-9]{10,15}$' and chave !~ '^([0-9])\1+$' then 'estrangeiro' else 'nao_confiavel' end as classe
    from k group by 1, 2 having count(*) > 1
)
select classe, count(*) as grupos, sum(qtd) as clientes, count(distinct corretor_id) as contas
  from g group by 1 order by 1;

-- D2. Conversas da mesma linha no mesmo canal ativo. Manter, na revisão, a que tem
--     LID ou mensagens recebidas (a grafia do JID). Ordem de cada array: com LID
--     primeiro, depois a mais recente.
select v.channel_id, public.lotti_phone_key(v.phone) as chave, count(*) as qtd,
       array_agg(v.id order by v.lid is null, v.updated_at desc) as ids,
       array_agg(length(v.phone) order by v.lid is null, v.updated_at desc) as digitos,
       array_agg(v.lid is not null order by v.lid is null, v.updated_at desc) as tem_lid,
       array_agg((select count(*) from public.lotti_agent_messages m
                   where m.conversation_id = v.id and m.direction = 'in')
                 order by v.lid is null, v.updated_at desc) as recebidas,
       array_agg(v.mode order by v.lid is null, v.updated_at desc) as modos,
       array_agg(v.opted_out_at is not null order by v.lid is null, v.updated_at desc) as optout
  from public.lotti_agent_conversations v
 where v.archived_at is null and v.phone ~ '^55[1-9][1-9][0-9]{8,9}$'
 group by 1, 2
having count(*) > 1;

-- D3. A mesma mensagem do WhatsApp em duas conversas do mesmo canal.
select c.channel_id, m.external_id, count(distinct m.conversation_id) as conversas,
       array_agg(m.conversation_id) as ids
  from public.lotti_agent_messages m
  join public.lotti_agent_conversations c on c.id = m.conversation_id
 group by 1, 2
having count(distinct m.conversation_id) > 1;

-- D4. Conversas ligadas a um cliente que não é o mais antigo da mesma chave
--     (duplicado da captura antiga).
select cv.id as conversa, cv.cliente_id as atual, canon.id as canonico
  from public.lotti_agent_conversations cv
  join public.clientes k on k.id = cv.cliente_id
  join lateral (
    select c2.id from public.clientes c2
     where c2.corretor_id = k.corretor_id
       and public.lotti_phone_key(c2.telefone) = public.lotti_phone_key(k.telefone)
     order by c2.created_at limit 1
  ) canon on canon.id <> cv.cliente_id
 where public.lotti_phone_key(k.telefone) ~ '^[1-9][1-9][mf][0-9]{8}$';

-- D5a. Negócios abertos repetidos do mesmo cliente (só informativo: um cliente pode
--      ter mais de um negócio de verdade; a decisão é do corretor).
select o.corretor_id, o.cliente_id, count(*) as qtd,
       array_agg(o.id order by o.updated_at desc) as ids, array_agg(o.origem) as origens
  from public.crm_oportunidades o
 where o.fechada_em is null
 group by 1, 2
having count(*) > 1;

-- D5b. Negócios abertos da mesma pessoa (mesma chave) em cadastros diferentes.
select o.corretor_id, public.lotti_phone_key(k.telefone) as chave, count(*) as qtd,
       array_agg(o.id) as ids, array_agg(o.cliente_id) as clientes
  from public.crm_oportunidades o
  join public.clientes k on k.id = o.cliente_id
 where o.fechada_em is null and public.lotti_phone_key(k.telefone) ~ '^[1-9][1-9][mf][0-9]{8}$'
 group by 1, 2
having count(distinct o.cliente_id) > 1;

-- D6. Leads da fachada: pendentes repetidos e convertidos em clientes diferentes
--     da mesma pessoa.
select f.corretor_id, public.lotti_phone_key(l.telefone) as chave, count(*) as leads,
       count(*) filter (where not l.convertido) as pendentes,
       count(distinct l.cliente_id) as clientes
  from public.fachada_leads l
  join public.fachadas f on f.id = l.fachada_id
 group by 1, 2
having count(*) > 1
   and (count(*) filter (where not l.convertido) > 1 or count(distinct l.cliente_id) > 1);

-- D7. Número que voltou ao canal (A -> B -> A) antes de 20260929130000: conversa
--     ativa com gêmea arquivada do mesmo número. optout_perdido tem prioridade.
select a.id as ativa, x.id as arquivada,
       (x.opted_out_at is not null and a.opted_out_at is null) as optout_perdido,
       x.mode as modo_arquivado, a.mode as modo_ativo
  from public.lotti_agent_conversations a
  join public.lotti_agent_channels ch on ch.id = a.channel_id and ch.archived_at is null
  join public.lotti_agent_channels xc on xc.corretor_id = ch.corretor_id and xc.archived_at is not null
                                     and xc.account_phone = ch.account_phone
  join public.lotti_agent_conversations x on x.channel_id = xc.id and (x.phone = a.phone or x.lid = a.lid);

-- D8. Heurística, só para revisão: conversas do canal ativo cujas mensagens são
--     todas anteriores à última troca de número. Podem ter vindo do número anterior,
--     mas também podem ser histórico legítimo do número novo.
select cv.id, max(m.created_at) as ultima, t.troca
  from public.lotti_agent_conversations cv
  join public.lotti_agent_channels ch on ch.id = cv.channel_id and ch.archived_at is null
  join lateral (
    select max(x.archived_at) as troca from public.lotti_agent_channels x
     where x.corretor_id = ch.corretor_id and x.archived_at is not null
       and x.account_phone is distinct from ch.account_phone
  ) t on t.troca is not null
  join public.lotti_agent_messages m on m.conversation_id = cv.id
 group by cv.id, t.troca
having max(m.created_at) < t.troca;

-- D9a. Alertas de mídia repetidos e ainda não lidos na mesma conversa.
select corretor_id, metadata->>'conversation_id' as conversa, count(*) as qtd
  from public.alertas
 where origem = 'ia' and lido is not true
   and mensagem = 'Mensagem de áudio ou mídia: atendimento humano necessário'
 group by 1, 2
having count(*) > 1;

-- D9b. Pedidos de saída (opt-out) registrados mais de uma vez na mesma conversa.
select conversation_id, count(*) as qtd
  from public.lotti_inbox_events
 where kind = 'consent' and to_label = 'Pediu para não receber mensagens'
 group by 1
having count(*) > 1;

-- D9c. Possíveis reenvios manuais: mesmo texto na mesma conversa em até 3 minutos.
select a.conversation_id, a.request_id as primeiro, b.request_id as repetido
  from public.lotti_manual_sends a
  join public.lotti_manual_sends b on b.conversation_id = a.conversation_id and b.fingerprint = a.fingerprint
                                   and b.request_id <> a.request_id
                                   and b.created_at between a.created_at and a.created_at + interval '3 minutes'
 where a.status in ('sent', 'uncertain') and b.status in ('sent', 'uncertain');

-- D10. Conversas só com LID e envio automático incerto: a união automática com a
--      conversa do telefone continua esperando (a mesclagem com envio incerto não
--      foi implementada). Revisar e unir à mão, se for o caso.
select v.id
  from public.lotti_agent_conversations v
 where v.phone is null
   and exists (select 1 from public.lotti_agent_outbox o where o.conversation_id = v.id and o.status = 'uncertain');

rollback;

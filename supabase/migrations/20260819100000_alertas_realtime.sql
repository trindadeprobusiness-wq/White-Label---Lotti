-- ---------------------------------------------------------------------------
-- O sino passa a receber sozinho.
--
-- O que estava errado: `fetchAlertas()` só rodava uma vez, no DataLoader,
-- durante o bootstrap do app. O webhook do Asaas gravava o recebimento em
-- `alertas`, o corretor ficava com a tela aberta a tarde inteira, e o sino
-- continuava zerado até alguém apertar F5. Um sino que só atualiza no reload
-- não é notificação — é histórico.
--
-- O front tem duas camadas (Realtime + sondagem de 90 s, ver
-- `src/hooks/useAlertasAoVivo.ts`) justamente porque esta migration pode não
-- estar aplicada. Sem ela o sino continua funcionando pela sondagem; com ela,
-- o alerta chega em cerca de um segundo, que é o comportamento do painel do
-- Asaas.
--
-- Segurança: entrar na publication NÃO afrouxa nada. O Realtime do Supabase
-- avalia a RLS da tabela para cada assinante — a policy
-- `corretor_id = get_corretor_id()` continua sendo o que decide quem vê o quê,
-- exatamente como no SELECT. Um corretor não recebe evento de alerta alheio.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- REPLICA IDENTITY FULL: sem isto o Realtime só enxerga a chave primária nos
-- eventos de UPDATE/DELETE, e a checagem de RLS por `corretor_id` não teria a
-- coluna para avaliar — o evento seria descartado em silêncio. `alertas` é
-- tabela pequena e de baixa escrita; o custo extra no WAL é irrelevante aqui.
ALTER TABLE public.alertas REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'alertas'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.alertas;
    END IF;
END $$;

COMMENT ON TABLE public.alertas IS
    'Notificações do sino. Publicada em supabase_realtime para o painel '
    'atualizar sem reload; a RLS por corretor continua valendo no Realtime.';

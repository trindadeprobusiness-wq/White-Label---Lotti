-- Sino ao vivo pela API (SSE, padrão do Clix): toda mudança em alertas avisa no
-- canal lotti_alertas com o id do corretor dono. Só o id vai no aviso; a API
-- relê os alertas com o RLS de quem está conectado. Vale para qualquer origem
-- (funções do banco, webhook do Asaas, agente, API). Sem ninguém escutando, o
-- aviso não custa nada (caso do Supabase, onde o Realtime segue como antes).
CREATE FUNCTION public.alertas_avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
AS $$
DECLARE
  dono uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN dono := OLD.corretor_id; ELSE dono := NEW.corretor_id; END IF;
  PERFORM pg_notify('lotti_alertas', dono::text);
  RETURN NULL;
END $$;

-- Função de gatilho: ninguém precisa chamá-la direto.
REVOKE ALL ON FUNCTION public.alertas_avisar_mudanca() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER alertas_avisar_mudanca
  AFTER INSERT OR UPDATE OR DELETE ON public.alertas
  FOR EACH ROW EXECUTE FUNCTION public.alertas_avisar_mudanca();

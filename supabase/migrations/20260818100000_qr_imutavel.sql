-- ---------------------------------------------------------------------------
-- O QR Code de uma fachada é imutável até a exclusão.
--
-- O QR é gerado a partir de `getFachadaPublicUrl(fachada.id)` — ou seja, o
-- código impresso na placa É o `id` da linha. Uma placa já instalada num imóvel
-- não pode ser reimpressa: se o id mudar, todo QR em campo aponta para o vazio,
-- e o corretor só descobre quando parar de receber lead.
--
-- Hoje isso está correto por convenção: `updateFachada` faz
-- `.update(data).eq('id', id)` e o payload do dialog não inclui `id`
-- (CriarFachadaDialog.tsx:181-188). Mas convenção não é garantia — basta
-- alguém no futuro passar `id` no objeto de update, ou trocar a edição por
-- delete+insert, para quebrar as placas silenciosamente.
--
-- Esta trigger transforma a convenção em regra do banco: editar dados da
-- fachada continua livre; trocar a identidade dela é recusado.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.proteger_id_fachada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION
            'O identificador da fachada é o QR Code impresso na placa e não pode mudar. Para um QR novo, exclua a fachada e crie outra.'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_proteger_id_fachada ON public.fachadas;
CREATE TRIGGER tr_proteger_id_fachada
    BEFORE UPDATE ON public.fachadas
    FOR EACH ROW EXECUTE FUNCTION public.proteger_id_fachada();

COMMENT ON FUNCTION public.proteger_id_fachada() IS
    'O id da fachada é o QR Code em campo. Placa impressa não se reimprime — '
    'trocar o id inutilizaria todo material já distribuído.';

-- Conferência: deve falhar com a mensagem acima.
--
--   UPDATE public.fachadas SET id = gen_random_uuid()
--    WHERE id = (SELECT id FROM public.fachadas LIMIT 1);

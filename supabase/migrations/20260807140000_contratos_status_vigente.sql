-- ---------------------------------------------------------------------------
-- Alinha o CHECK de status de contratos ao vocabulário que o app realmente usa.
--
-- Problema: a Central de Contratos grava status = 'VIGENTE' (contrato enviado e
-- analisado pela IA), mas chk_contratos_status (20260708150000_asaas_core_financeiro)
-- só aceitava RASCUNHO/ATIVO/ENCERRANDO/ENCERRADO/CANCELADO. O constraint foi
-- criado NOT VALID — isso dispensa as linhas antigas, mas continua barrando
-- INSERT novo, então "Salvar Contrato" quebrava com erro 23514.
--
-- 'ARQUIVADO' e 'RESCINDIDO' entram junto porque gerar_alertas_vencimento_contratos()
-- (20260729120000_central_contratos) já filtra por esses valores.
-- ---------------------------------------------------------------------------

ALTER TABLE public.contratos DROP CONSTRAINT IF EXISTS chk_contratos_status;

ALTER TABLE public.contratos
    ADD CONSTRAINT chk_contratos_status
    CHECK (status IN (
        'RASCUNHO', 'ATIVO', 'VIGENTE', 'ENCERRANDO',
        'ENCERRADO', 'CANCELADO', 'ARQUIVADO', 'RESCINDIDO'
    )) NOT VALID;

COMMENT ON CONSTRAINT chk_contratos_status ON public.contratos IS
    'Vocabulário de status aceito. VIGENTE = contrato enviado/assinado em acompanhamento (Central de Contratos); ATIVO = contrato de locação em operação.';

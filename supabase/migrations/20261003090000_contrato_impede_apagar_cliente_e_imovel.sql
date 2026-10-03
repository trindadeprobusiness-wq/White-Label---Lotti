begin;

-- Contrato impede apagar o cliente e o imóvel dele.
--
-- As duas chaves eram ON DELETE CASCADE. Apagar um cliente, ou um imóvel,
-- apagava junto todo contrato ligado a ele — e o contrato levava, também em
-- cascata, as faturas e os repasses. Sem aviso nenhum.
--
-- Em 2026-10-02 isso custou contratos de locação ativos: proprietários
-- cadastrados como clientes, com telefone de preenchimento, foram excluídos em
-- lote na aba Clientes como se fossem leads de teste. Faturas e repasses foram
-- limpos pelo autovacuum no mesmo dia e não tinham backup.
--
-- Contrato é registro jurídico e financeiro. Não pode sumir como efeito
-- colateral de outra exclusão. Com RESTRICT, apagar cliente ou imóvel que tenha
-- contrato falha com 23503, e quem quiser mesmo apagar tem de tratar o contrato
-- antes — encerrar ou excluir, de propósito.
--
-- A intenção já estava no produto: a página de detalhe do cliente, ao falhar a
-- exclusão, diz "verifique se não há contratos vinculados a este cliente".
-- Quem escreveu esperava esse bloqueio. O banco fazia o oposto.
--
-- Vale para contrato de qualquer status. Contrato encerrado continua sendo
-- histórico que alguém pode precisar consultar.

alter table public.contratos
  drop constraint contratos_cliente_id_fkey,
  add constraint contratos_cliente_id_fkey
    foreign key (cliente_id) references public.clientes(id) on delete restrict;

alter table public.contratos
  drop constraint contratos_imovel_id_fkey,
  add constraint contratos_imovel_id_fkey
    foreign key (imovel_id) references public.imoveis(id) on delete restrict;

commit;

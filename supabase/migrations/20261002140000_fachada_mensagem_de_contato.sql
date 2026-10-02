begin;

-- A mensagem que o corretor manda para quem escaneou a placa.
--
-- O botão "Contactar" na lista de leads abria o WhatsApp EM BRANCO. Quem
-- clicava tinha que escrever do zero, toda vez, e acabava mandando "oi" para
-- alguém que não lembra de nada — tendo a informação mais útil da conversa
-- (qual placa, qual imóvel) guardada aqui do lado.
--
-- Não confundir com `mensagem_whatsapp`, que já existe e é o caminho
-- contrário: aquela é o texto que o LEAD envia ao tocar no botão da página
-- pública. Esta é a abordagem, e por isso é um campo separado.

alter table public.fachadas
  add column if not exists mensagem_contato text;

comment on column public.fachadas.mensagem_contato is
  'Modelo da mensagem que o corretor envia ao lead desta fachada. Aceita '
  '{nome}, {imovel} e {valor}. Vazio usa o padrão do aplicativo.';

-- O limite acompanha o da `mensagem_whatsapp`: é texto de WhatsApp, não
-- descrição de anúncio.
alter table public.fachadas
  drop constraint if exists fachadas_mensagem_contato_tamanho;
alter table public.fachadas
  add constraint fachadas_mensagem_contato_tamanho
  check (mensagem_contato is null or char_length(mensagem_contato) <= 600);

notify pgrst,'reload schema';
commit;

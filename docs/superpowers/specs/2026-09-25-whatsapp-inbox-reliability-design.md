# WhatsApp Inbox: desempenho e confiabilidade

## Objetivo

Tornar o WhatsApp da Lotti mais responsivo e coerente sem criar mensagens provisórias, alterar a semântica de entrega ou inventar contatos. Reunir as correções em uma prévia local única, preservando o comportamento existente até cada mudança ser verificada.

## Escopo

1. Medir separadamente o tempo entre Enter, Edge Function, ponte runtime, Evolution e confirmação. Reduzir somente esperas demonstradas como desnecessárias. O envio mantém `request_id` estável nas tentativas incertas e só mostra a mensagem como enviada após confirmação; não acrescentar estado visual “Enviando…”.
2. Reduzir consultas redundantes do Inbox sem perder atualização de novas mensagens, estado e eventos. Manter atualização imediata após uma ação confirmada.
3. Apresentar anexos como anexos, com nome, tipo e ação de abrir/baixar quando houver URL assinada, em vez de texto simples. Não ampliar tipos ou tamanhos permitidos sem validação do backend.
4. Usar fundo e detalhes verdes discretos da identidade Lotti no histórico, mantendo legibilidade e contraste.
5. Diferenciar evento de fechamento de conversa, alteração do modo IA e resposta humana. Não rebatizar evento gravado sem comprovar o significado dos campos; corrigir a origem se o evento incorreto for emitido.
6. Revisar o teste “Olá, tudo bem?” para não sugerir sucesso sem confirmação e expor a causa recuperável da falha sem vazar dados internos.
7. Importar somente conversas do dia disponíveis na Evolution para o número vinculado à conta, com telefone individual confirmado. Ignorar LID sem mapeamento confiável, grupos e dados ambíguos; preservar deduplicação e não importar a agenda inteira.

## Limites e segurança

- Sem envio real de mensagens ou conexão de telefone por conta do Codex.
- Sem mudanças destrutivas no Supabase, na Evolution ou em volumes Docker.
- A prévia local usa dados fictícios; UI funcional na prévia não prova entrega, áudio, arquivo ou importação real.
- Mudanças no app e no runtime são verificadas separadamente e reunidas apenas depois de testes focados.
- Preservar alterações não commitadas no checkout principal; trabalhar na área isolada.

## Validação

- Testes de regressão de envio normal/incerto, Enter com anexo, eventos e importação de hoje.
- Testes leves de componentes e build direcionado; inspeção do fluxo local sem sobrecarregar o PC.
- Fornecer URL localhost da prévia após o servidor responder. Declarar expressamente o que ainda requer teste com WhatsApp conectado.

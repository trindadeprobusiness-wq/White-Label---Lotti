# Ações essenciais do Inbox conectado

**Data:** 2026-09-21  
**Escopo aprovado:** Nova conversa, edição do nome do contato e fechamento/reabertura da conversa.

## Objetivo

Fazer com que os três controles destacados no Inbox conectado executem operações reais e persistentes, mantendo o visual já aprovado com base no Clix. O trabalho não inclui atribuição, tags, notas internas nem alterações gerais de design.

## Experiência

### Nova conversa

O botão `Nova` abre um modal compacto no padrão visual enviado pelo usuário. O formulário contém telefone obrigatório, nome opcional e mensagem inicial obrigatória. Não haverá busca de clientes, CPF, catálogo completo de templates ou outras opções nesta entrega.

Ao confirmar, o sistema normaliza o telefone, localiza ou cria o cliente pertencente ao corretor autenticado, localiza ou cria uma conversa no canal WhatsApp conectado e envia a mensagem inicial pelo fluxo manual existente. Se já existir conversa para o telefone, ela será reutilizada e selecionada. A interface informa carregamento, sucesso, falha e entrega incerta, sem duplicar envios em uma repetição.

### Editar nome

O lápis ao lado do nome abre um modal curto com um único campo. O nome é obrigatório, limitado e salvo no registro de `clientes` vinculado à conversa. Conversas ainda sem `cliente_id` exibem uma mensagem clara e não simulam salvamento. Após sucesso, cabeçalho, lista e perfil são atualizados pelo cache.

### Fechar e reabrir conversa

O status `Aberta`, com ponto verde e o mesmo desenho da referência, vira um botão. Ao clicar, abre a confirmação `Fechar conversa?`. Confirmar persiste o status como fechado. Uma conversa fechada exibe `Fechada` com tom neutro e oferece a ação inversa `Reabrir conversa`, também persistente.

## Persistência e segurança

- Uma migration aditiva inclui o estado da conversa e funções autenticadas para iniciar conversa e alterar aberto/fechado.
- As funções resolvem o corretor a partir de `auth.uid()` e verificam que canal, conversa e cliente pertencem a ele; IDs fornecidos pelo navegador não concedem acesso.
- A Edge Function `lotti-whatsapp` recebe uma ação específica para iniciar a conversa e continua sendo a única fronteira de envio ao provedor.
- O envio inicial reutiliza a reserva/idempotência do envio manual existente.
- Editar o nome usa a política de acesso já existente de `clientes`, com filtro simultâneo por `id` e corretor autenticado.

## Componentes

- `ConnectedInbox`: estado dos três diálogos, atualização de cache e apresentação dos estados.
- Novos componentes pequenos de diálogo para nova conversa, edição do nome e confirmação de fechamento, mantendo `ConnectedInbox` legível.
- Migration SQL e ajuste mínimo da Edge Function para as operações persistentes que ainda não existem.

## Falhas e estados

- Botões ficam bloqueados durante a própria operação.
- Erros aparecem dentro do diálogo correspondente e preservam os dados digitados.
- Entrega incerta não é tratada como sucesso e orienta o usuário a verificar antes de reenviar.
- Fechar/reabrir e editar nome somente fecham o diálogo depois de confirmação do banco.

## Testes e aceite

- Testes de componente comprovam abertura, validação, envio e estados de erro dos três fluxos.
- Testes de contrato cobrem autorização e idempotência das funções SQL/Edge.
- A suíte completa, build, ESLint direcionado e `git diff --check` devem passar.
- Inspeção visual no localhost confirma que o design existente não mudou além dos três controles aprovados.
- A entrega será feita em `codex/whatsapp-inbox-actions` por Pull Request; não haverá novo push direto para `main`.

## Fora do escopo

Atribuição, tags, notas internas, busca avançada de cliente, CPF, biblioteca de templates, anexos na primeira mensagem e redesenho das demais áreas do Inbox.

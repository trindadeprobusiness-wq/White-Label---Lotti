# WhatsApp Inbox da Lotti — Design

## Objetivo

Criar dentro do aplicativo Lotti uma área **WhatsApp > Inbox** inspirada na referência enviada pelo usuário, sem copiar sua identidade visual. A primeira entrega deve funcionar com dados de demonstração e ficar preparada para receber mensagens reais pela Evolution API quando a VPS estiver disponível.

## Escopo da primeira entrega

- Adicionar `WhatsApp` à navegação lateral, com acesso ao `Inbox`.
- Criar uma tela de atendimento em três áreas no desktop:
  - lista pesquisável de conversas;
  - conversa ativa e composição de mensagem;
  - perfil do contato, responsável, tags, notas internas e linha do tempo.
- Permitir selecionar conversas, escrever e enviar mensagens no modo demonstrativo.
- Exibir estado da conversa, mensagens não lidas e indicação de atendimento por IA ou humano.
- Permitir ligar ou pausar a IA por conversa e assumir o atendimento humano.
- Adaptar a experiência para celular sem tentar manter três colunas apertadas: lista, conversa e perfil serão telas navegáveis com retorno claro.
- Cobrir os comportamentos principais e a responsividade estrutural com testes automatizados.

## Fora do escopo desta entrega

- Conexão real com WhatsApp, leitura de QR Code e provisionamento da Evolution API.
- Contratação ou configuração da VPS.
- Envio real de mensagens, mídias ou áudios.
- Automação completa do agente de IA.
- Publicação de migrations no Supabase ou alterações no ambiente de produção.

## Navegação

O menu lateral continua no formato atual, sem grupos recolhíveis. Um item **WhatsApp** será inserido em **Operação**, antes de Clientes, apontando para `/whatsapp`. A tela terá o título `WhatsApp` e identificará o módulo como `Inbox` dentro do próprio conteúdo.

## Layout

### Desktop

A área útil será organizada em três colunas, com altura limitada à viewport do aplicativo:

1. **Conversas**: contador, busca, filtros rápidos, avatar/iniciais, nome, prévia, horário e não lidas.
2. **Atendimento**: cabeçalho do contato, controle IA/humano, situação, histórico de mensagens e compositor fixo no rodapé.
3. **Perfil do contato**: dados principais, etapa, responsável, tags, notas internas e eventos recentes.

Cada coluna terá sua própria rolagem para evitar que o compositor desapareça abaixo da página.

### Celular

- A entrada mostra somente a lista de conversas.
- Selecionar uma conversa abre o atendimento em largura total.
- O perfil abre como painel sobreposto.
- Botões de voltar e fechar serão explícitos.
- O compositor respeitará a área segura inferior e permanecerá visível.

## Estados e dados demonstrativos

Os dados simulados ficarão isolados do componente visual e usarão contratos que poderão ser implementados depois pelo Supabase. O protótipo incluirá conversas abertas, não lidas, atendidas por IA e assumidas por humano, além de mensagens recebidas e enviadas.

O envio demonstrativo adicionará a mensagem localmente e atualizará a prévia da conversa. Nenhuma chamada externa será simulada como se fosse real; a interface indicará que a conexão com WhatsApp ainda não está ativa.

## Modelo preparado para a integração real

Os contratos da interface devem separar:

- `WhatsAppConversation`: contato, estado, responsável, contadores e última mensagem;
- `WhatsAppMessage`: direção, conteúdo, tipo, horário e estado de entrega;
- `WhatsAppContactProfile`: dados do cliente, tags, notas e eventos;
- `WhatsAppInboxRepository`: leitura de conversas/mensagens e envio de mensagem.

Na integração futura, a Evolution API ficará na VPS e nunca será chamada diretamente pelo navegador. O fluxo será Evolution API → webhook autenticado → Supabase → interface Lotti. O envio seguirá interface Lotti → função autenticada → Evolution API. Chaves e credenciais permanecerão exclusivamente no servidor.

## IA e transferência humana

Cada conversa terá um modo explícito:

- **IA ativa**: preparada para respostas automáticas futuras;
- **Atendimento humano**: a IA não envia respostas;
- **Pausada**: nenhuma automação responde até reativação.

Assumir a conversa como humano deve desligar a resposta automática daquela conversa. A primeira entrega demonstra essas mudanças de estado, sem chamar um modelo externo.

## Segurança e isolamento

- Todo dado real futuro será isolado por organização/corretor com RLS.
- A chave da Evolution API jamais será enviada ao frontend.
- Webhooks deverão validar autenticação, instância e idempotência.
- Logs não poderão guardar tokens, QR Codes ou conteúdo sensível desnecessário.

## Critérios de aceite

- `WhatsApp` aparece no menu e `/whatsapp` abre o Inbox.
- Uma conversa pode ser selecionada, lida e respondida no modo demonstrativo.
- Busca e filtros alteram a lista exibida.
- Perfil, tags, responsável, notas e linha do tempo aparecem para a conversa selecionada.
- O operador consegue alternar entre IA e atendimento humano.
- Desktop mantém três áreas utilizáveis e rolagens internas.
- Celular permite navegar entre lista, conversa e perfil sem conteúdo cortado.
- Tema claro e escuro mantêm contraste legível.
- Testes específicos, build e verificação de diff passam antes da entrega.


# Plano de automação Lotti — backlog para revisão

Versão: 10/09/2026. Status: proposta, não autorização de publicação.

## 1. Objetivo

Centralizar atendimento pelo WhatsApp no Inbox da Lotti, conectar conversas ao funil e permitir que a IA consulte somente os imóveis e dados autorizados da operação. Começar com sugestões revisadas pelo corretor; automatizar apenas depois de validar qualidade, segurança e operação.

## 2. Situação atual

- Inbox local com demonstração de conversas, filtros, etapas, fechamento, edição de nome, responsável, tags, notas, anexos e rascunhos.
- Grande parte do estado do Inbox é mantida em memória e se perde ao recarregar. Isso não equivale a atendimento real.
- Assistente geral já possui integração própria e histórico de conversas. Não confundir com o agente de atendimento ao cliente.
- Função `inbox-suggest` preparada localmente para consultar um imóvel autorizado e gerar sugestão. Falta publicar e validar ponta a ponta.
- Personalização de instruções salva por conta neste navegador; atualização do servidor ainda pendente.
- Não há conexão real de WhatsApp validada neste fluxo. Interface visual não comprova integração.

## 3. Fluxo previsto

1. Responsável autorizado conecta o número à organização.
2. Conector recebe mensagem e encaminha evento autenticado ao servidor.
3. Servidor identifica organização, deduplica o evento e salva contato, conversa e mensagem.
4. Inbox atualiza em tempo real e relaciona contato a uma oportunidade do funil.
5. Havendo origem conhecida (anúncio/fachada), vincula o imóvel; se ambígua, pergunta ou solicita seleção humana.
6. IA consulta campos permitidos e atualizados, gera sugestão e apresenta para revisão.
7. Corretor edita e confirma envio. O servidor envia e atualiza estados de entrega conforme confirmação do conector.
8. Na fase automática, a IA só responde quando elegível. Mensagem da equipe pelo telefone ou Inbox pausa o agente imediatamente.
9. Mudanças de etapa, responsável e pausa aparecem no histórico com autor, motivo e horário.

## 4. Arquitetura proposta

| Parte | Responsabilidade |
| --- | --- |
| Aplicação Lotti | Inbox, perfil, filtros, revisão de sugestões e configurações |
| Backend e banco | Autenticação, isolamento por organização, persistência, auditoria e regras |
| Serviço de conexão WhatsApp | Sessão do número, recepção/envio e estados de conexão |
| Fila e worker | Retentativas, ordenação, processamento de eventos e execução da IA |
| Provedor de IA | Geração de respostas usando contexto previamente autorizado |
| Armazenamento privado | Anexos com acesso temporário e controle de tamanho/tipo |

A VPS pode hospedar o conector e o worker quando a integração for iniciada. O desenvolvimento da interface, persistência e contratos de eventos não depende da contratação imediata. Domínio/subdomínio pode servir como endereço HTTPS estável do serviço; o usuário continua atendendo no próprio site da Lotti.

A escolha do conector não oficial permanece pendente. Antes de contratar, validar condições de uso, segurança da sessão, risco de bloqueio/desconexão, manutenção e capacidade de detectar autoria de mensagens. Este documento não garante compatibilidade ou continuidade de um conector específico.

## 5. Backlog priorizado

P0: indispensável antes de produção. P1: versão inicial operacional. P2: evolução.

| ID | Prioridade | Entrega | Dependência | Critério de aceite |
| --- | --- | --- | --- | --- |
| AUT-01 | P0 | Modelo de organização, membros e permissões | Nenhuma | Usuário de uma conta não lê nem altera dados de outra, inclusive por chamada direta |
| AUT-02 | P0 | Persistir contatos, conversas, mensagens, tags, notas e responsáveis | AUT-01 | Recarregar e abrir em outro dispositivo preserva dados; erros de gravação são informados |
| AUT-03 | P0 | Contrato de eventos e deduplicação | AUT-02 | Mesmo evento repetido não duplica mensagem, resposta, etapa ou cobrança de IA |
| AUT-04 | P0 | Escolher conector e testar número dedicado | Revisão de riscos | Receber, enviar, reconectar e distinguir mensagem humana da automática em ambiente de teste |
| AUT-05 | P0 | Infraestrutura do conector | AUT-04 | HTTPS, segredos protegidos, reinício automático, logs sem conteúdo sensível e backup restaurável |
| AUT-06 | P0 | Webhook autenticado e fila | AUT-03, AUT-05 | Evento inválido é rejeitado; falhas são reprocessadas sem duplicação; ordem é preservada por conversa |
| AUT-07 | P1 | Conexão do número na interface | AUT-05 | Mostra conectar, conectado, desconectado e reconectar, sem simular sucesso |
| AUT-08 | P1 | Envio e recepção no Inbox | AUT-06 | Texto recebido aparece sem recarregar; envio mostra pendente, enviado ou falha conforme confirmação real |
| AUT-09 | P1 | Anexos reais | AUT-08 | Arquivo privado pode ser recebido/enviado com limite validado, falha visível e acesso autorizado |
| AUT-10 | P1 | Vincular funil e conversa | AUT-02 | Mudança de etapa reflete nos dois lados, com evento de auditoria; múltiplas oportunidades exigem escolha clara |
| AUT-11 | P1 | Perfil e ações completas | AUT-02 | Nome, tags, responsável e notas persistem; exclusão tem escopo explícito; membros vêm da equipe real |
| AUT-12 | P1 | Filtros e prazos de atendimento | AUT-08 | Atraso usa última espera real por resposta, não número de não lidas; fechamento e resposta removem espera |
| AUT-13 | P0 | Consulta segura de imóveis pela IA | AUT-01 | Consulta atualizada com lista de campos permitidos; não expõe proprietário, documentos ou notas internas |
| AUT-14 | P1 | Sugestão de resposta revisável | AUT-13 | Imóvel selecionado e pergunta geram rascunho; nada é enviado sem confirmação; falta de dado é explicitada |
| AUT-15 | P1 | Cotas, limites e tratamento de falhas de IA | AUT-14 | Falta de cota, timeout ou indisponibilidade não bloqueia atendimento humano nem gera envios repetidos |
| AUT-16 | P1 | Origem e busca de imóveis | AUT-10, AUT-13 | Anúncio conhecido vincula imóvel; busca usa critérios do cliente; ausência ou ambiguidade não gera invenção |
| AUT-17 | P0 | Interrupção humana e concorrência | AUT-08, AUT-14 | Resposta humana pausa IA; resposta automática já em geração não é enviada após a tomada humana |
| AUT-18 | P1 | Instruções personalizadas persistidas | AUT-01, AUT-14 | Configuração por organização com permissão, versão e restauração; não substitui regras de segurança |
| AUT-19 | P2 | Atendimento automático controlado | AUT-15, AUT-17, piloto aprovado | Ativação explícita, horário e escopo definidos; desligamento imediato disponível |
| AUT-20 | P2 | Follow-up e agendamento | AUT-19 | Regras de elegibilidade, limites de frequência e cancelamento; sem insistência após pedido de parada |
| AUT-21 | P1 | Auditoria e monitoramento | AUT-06 | Detecta desconexão, fila parada e falha de envio; permite investigar sem expor dados desnecessários |
| AUT-22 | P0 | Teste piloto e checklist de publicação | Todos os P0 aplicáveis | Isolamento, duplicação, reconexão, intervenção humana e recuperação aprovados antes da expansão |

## 6. Regras da IA

- Só recebe dados permitidos para a organização e para o propósito de atendimento.
- Não deduz financiamento, disponibilidade comercial ou descontos de um cadastro incompleto. Cadastro ativo não significa imóvel disponível.
- Preço e características vêm da consulta atual; não de memória de uma conversa antiga.
- Negociação, dados ausentes e situações ambíguas são encaminhados ao corretor.
- Mensagens e descrições de imóveis são dados, não instruções com poder de alterar permissões.
- Aprovação humana é obrigatória na primeira fase. Uma sugestão não é uma mensagem enviada.
- Preferências de tom não podem liberar acesso, dispensar confirmação ou expor documentos.

## 7. Estados e exceções

| Evento | Comportamento esperado |
| --- | --- |
| WhatsApp desconectado | Aviso visível; não marcar envio como concluído |
| Evento repetido | Ignorar duplicata usando identificador do provedor |
| Equipe responde pelo telefone | Identificar autoria humana, pausar IA e registrar evento |
| Mensagem enviada pelo próprio agente retorna no webhook | Correlacionar com envio original; não tratar como nova intervenção humana |
| IA gera enquanto corretor assume | Revalidar versão/estado antes de enviar e descartar resposta obsoleta |
| Imóvel removido ou acesso revogado | Bloquear consulta e pedir confirmação humana |
| API de IA falha | Manter atendimento manual; informar falha e permitir nova tentativa controlada |
| Nova mensagem após fechamento | Política a aprovar: reabrir conversa ou iniciar atendimento vinculado ao mesmo contato |

## 8. Sequência de implantação

1. Persistência e isolamento: AUT-01 a AUT-03.
2. Conector em teste e operação humana: AUT-04 a AUT-12, AUT-21.
3. Sugestões supervisionadas: AUT-13 a AUT-18.
4. Piloto com equipe e número dedicado: AUT-22.
5. Automação gradual e follow-up: AUT-19 e AUT-20, mediante aprovação.

Cada etapa termina com testes, demonstração e revisão. Não publicar automaticamente por concluir o código.

## 9. Decisões para sua conferência

- Quem pode conectar números, editar instruções e ativar atendimento automático?
- Um número por corretor ou número compartilhado pela imobiliária?
- Prazos iniciais de atraso/urgência: manter 15/60 minutos? Contar apenas horário de atendimento?
- Após fechamento, nova mensagem reabre a conversa?
- Quais dados podem ser enviados ao cliente: fotos, bairro, endereço completo e condições comerciais?
- Política de retenção/exclusão e responsáveis pela revisão de privacidade.
- Conector, hospedagem e orçamento mensal: decidir após prova de integração. Custos dependem de números conectados, volume e provedor de IA; não há estimativa comercial validada nesta versão.

## 10. Definição de pronto

Funcionalidade só é considerada pronta quando persiste dados corretamente, respeita permissões no servidor, tem estados de erro claros, passa nos testes e funciona no ambiente integrado. Protótipo local, botão visível e build aprovado não bastam para declarar automação operacional.

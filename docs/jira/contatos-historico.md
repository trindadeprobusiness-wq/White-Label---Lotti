# Contatos: origem e data inicial do histórico — SCRUM-49

Data: 2026-09-27 · Responsável: Claude · Base: teste com número real na ponte de teste local (Docker `lotti-lidtest`, Supabase local), com envio bloqueado. Os números abaixo são só contagens e datas; nenhum conteúdo, nome ou telefone foi registrado.

## De onde vem o histórico

1. **O celular envia o histórico ao aparelho novo.** Ao escanear o QR, o WhatsApp do celular manda ao novo "aparelho conectado" um pacote de histórico em lotes. Os tipos são `INITIAL_BOOTSTRAP`, `RECENT`, `FULL` e `PUSH_NAME`, este último só com nomes de perfil. Quem decide o período é o WhatsApp do celular, não a Lotti.
2. **A Evolution recebe e repassa.** A biblioteca Baileys emite `messaging-history.set`. A Evolution publica o webhook `MESSAGES_SET`, fatiado em lotes de 200 pelo patch da ponte. A configuração `syncFullHistory` é ligada quando a importação de histórico está ativa.
3. **A ponte grava.** A ponte chama `lotti_agent_import_history` conforme `HISTORY_IMPORT_MODE`:
   - `recent`: todo o dia de hoje, a última mensagem de cada conversa anterior e a última mensagem recebida;
   - `full`: todo o histórico;
   - `off`: nada.

   Esse modo existe na branch de número oculto. No runtime em produção (`codex/openai-whatsapp-agent`), `HISTORY_IMPORT_ENABLED=false`, e ao conectar roda só a importação "de hoje" (`today.mjs`), que busca na Evolution as mensagens do dia corrente com número conhecido.
4. **Só na primeira conexão do aparelho.** Reconexões da mesma sessão (queda de rede, reinício do Docker) não reenviam o histórico. Para receber de novo, é preciso um novo pareamento pelo QR.

## Data inicial observada (teste de 2026-09-27)

| Item | Resultado |
|---|---|
| Mensagens recebidas no histórico | 11.591 |
| Conversas individuais | 103 (102 com número oculto/LID, 1 com número) |
| Mensagens individuais | 2.139 (1.136 enviadas e 1.004 recebidas) |
| **Primeira mensagem individual** | **23/06/2026**, cerca de 3 meses (96 dias) antes da conexão |
| Última mensagem individual | 27/09/2026, dia da conexão |
| Grupos | 28, com 9.451 mensagens desde 29/04/2026. A Lotti ignora grupos |

**Mensagens por mês:** abril 2 (grupos), junho 152, julho 3.711, agosto 4.389, setembro 3.337.

**Última atividade das 103 conversas individuais:**

| Última mensagem | Conversas |
|---|---|
| Hoje | 1 |
| Até 7 dias | 10 |
| Até 30 dias | 13 |
| Até 60 dias | 43 |
| Mais de 60 dias | 36 |

- Mensagens por conversa: mediana 3, máximo 1.076.
- Tipos de mensagem: texto 1.669, imagem 217, documento 90, áudio 40, vídeo 24, botões 24 e figurinha 23. O agente só lê texto; mídia vai para atendimento humano.
- No modo `recent`, a importação gravou 108 mensagens nas 102 conversas.

## Conclusão
- **Origem:** o histórico vem do próprio WhatsApp do celular no momento do pareamento, pela sincronização de aparelhos conectados. Não há outra fonte: a Lotti não lê backup nem outra API.
- **Data inicial:** nesta amostra, as conversas individuais chegaram com cerca de **3 meses** de histórico. O período é definido pelo WhatsApp e não pode ser configurado pela Lotti. Para não prometer um prazo ao cliente, vale dizer "as conversas recentes do celular (em geral, dos últimos meses)".
- **Número oculto:** no teste, todas as conversas vieram com número oculto (LID) e sem nome. A correção está na branch `claude/whatsapp-lid-conversations`: busca o número real e o nome salvo na agenda, e contato não salvo aparece pelo número. Ela aguarda um novo pareamento para confirmar.

## Limitações e próximo passo
- A amostra é de **um aparelho**. iPhone, Android e WhatsApp Business podem enviar períodos diferentes. Vale repetir com outro número (de preferência um chip de teste) para confirmar a faixa.
- O WhatsApp removeu o aparelho 3,5 minutos depois da conexão (código 401) e depois bloqueou novos pareamentos por um tempo ("Can't link device now"). Novos testes devem ser espaçados.

**Status: Concluído com uma amostra.** Recomendado repetir com um segundo aparelho.

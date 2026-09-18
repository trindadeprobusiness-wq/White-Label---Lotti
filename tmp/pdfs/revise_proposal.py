from pathlib import Path
p=Path('C:/Users/Gabri/n8n-agent-lotti/docs/AGENTE_LOTTI_PROPOSTA.md')
s=p.read_text(encoding='utf-8')
s=s.replace('Pré-qualificação no WhatsApp, continuidade na plataforma','Atendimento comercial, qualificação e intervenção do corretor')
s=s.replace('v1.0 | 10 de setembro de 2026','v1.1 | 11 de setembro de 2026')
s=s.replace('O agente recebe o lead, entende o que ele procura, esclarece dúvidas com dados autorizados e entrega ao corretor um atendimento com contexto.', 'O agente conduz o atendimento comercial desde a primeira dúvida. Entende a necessidade atual, explora critérios e objeções, consulta unidades compatíveis e qualifica o lead para o próximo passo. Quando ele estiver qualificado, avisa o corretor dentro da plataforma para ajudar na escolha, busca ou visita ao imóvel.')
s=s.replace('E[IA pré-qualifica e salva cada avanço]', 'E[IA atende, descobre necessidades e qualifica]')
s=s.replace('E --> G[Resumo, responsável e prioridade na Lotti]', 'E --> Q[Lead qualificado para visita ou busca]\n  Q --> G[Aviso interno com resumo, motivo e responsável]')
start=s.index('## 01. Como a conversa acontece')
end=s.index('## 02. Limites por plano')
s=s[:start]+'''## 01. Conversa comercial desde a primeira dúvida

O cliente pode chegar perguntando “tem garagem?”, “qual o valor?” ou “ainda está disponível?”. Ele não precisa anunciar que quer comprar nem trazer seu perfil pronto. O agente responde ao assunto e abre uma descoberta útil, com linguagem natural de atendimento imobiliário.

### Exemplo fictício: do interesse na unidade à necessidade real

Nesta simulação, a carteira consultada informa: unidade A com uma vaga e preço de R$ 450 mil; unidade B com duas vagas e preço de R$ 470 mil. São dados fictícios. Em operação, toda afirmação depende da consulta atual.

**Lead:** Esse apartamento do anúncio tem garagem?

**Agente:** Tem uma vaga. Para você, uma atende ou precisa de espaço para dois carros?

**Lead:** Preciso de duas. Minha esposa também dirige.

**Agente:** Entendi. Então essa unidade não resolve um ponto importante para vocês. O que mais precisa ter no apartamento?

**Lead:** Dois quartos, perto do Centro. Hoje moramos longe do trabalho.

**Agente:** Faz sentido olhar o deslocamento junto com a região. Qual faixa de valor fica confortável para vocês?

**Lead:** Até R$ 480 mil, financiado.

**Agente:** E a mudança seria para agora ou vocês ainda estão pesquisando sem uma data?

**Lead:** Queremos mudar em até três meses. Estamos começando as visitas.

**Agente:** Encontrei outra unidade cadastrada por R$ 470 mil, com dois quartos e duas vagas, na região que você procura. Ela combina melhor com o que você descreveu. O que você gostaria de conferir antes de decidir se vale uma visita?

**Lead:** Quero ver as fotos e saber se posso visitar no sábado.

**Agente:** Vou te mostrar as fotos autorizadas dessa unidade. Para a visita, qual período do sábado funciona melhor para vocês?

**Na Lotti, sem anunciar uma transferência burocrática ao cliente:** “Lead qualificado para visita. Busca 2 quartos, 2 vagas, região central, até R$ 480 mil, financiamento, mudança em 3 meses. Unidade B é candidata. Confirmar disponibilidade, fotos atuais e horário de sábado.”

O corretor recebe o aviso, abre o histórico e assume quando necessário. A agenda e a disponibilidade ainda precisam de confirmação. A resposta comercial não deve se resumir a “vou organizar seu pedido”. O agente não inventa identidade humana ou registro profissional; se perguntado, informa que é um atendimento por IA.

<!-- PAGE -->

## 01B. Descoberta estratégica e ponto de qualificação

### O funil de atendimento do agente

**Entrada com dúvida → pré-qualificação → qualificação em andamento → qualificado para um próximo passo → aviso na Lotti → intervenção do corretor.** Esses são estados propostos do atendimento, separados das etapas comerciais já existentes na plataforma.

Na pré-qualificação, entender se a pessoa quer comprar, alugar, investir ou resolver outro assunto. Durante a qualificação, descobrir o que faz um imóvel servir para aquela pessoa. Perguntar o próximo ponto relevante a partir da resposta anterior, sem aplicar um formulário fixo.

### Informações que vale descobrir

| Dimensão | Descoberta que ajuda na escolha |
| --- | --- |
| Necessidade atual | Por que procura agora; o que não funciona no imóvel atual |
| Uso e unidade | Compra ou locação; morar ou investir; tipo e configuração desejados |
| Critérios essenciais | Quartos, vagas, acessibilidade e características indispensáveis |
| Localização | Região desejada e motivo: trabalho, deslocamento ou serviços |
| Viabilidade declarada | Faixa confortável e forma de pagamento; sem presumir crédito aprovado |
| Momento e decisão | Prazo, visitas em andamento e quem participa da escolha |
| Objeções e flexibilidade | O que descarta uma opção; em quais critérios aceita alternativas |
| Próximo passo | Ver opções, buscar outra unidade, tirar dúvida específica ou visitar |

Extrair o máximo de informação **útil**, sem cansar o cliente ou coletar dados desnecessários. Aproveitar o que já foi dito, responder antes de perguntar, aprofundar contradições e confirmar conclusões. Uma pergunta por vez; recusa ou desconhecimento viram pendência, não repetição insistente.

### Quando marcar “qualificado”

Existe entendimento suficiente do objetivo, dos critérios essenciais, da região, da faixa financeira declarada ou pendência explícita, do momento e de um próximo passo que o corretor consegue executar. Não significa aprovação financeira, visita agendada ou garantia de compra. Sem contexto acionável, permanece em qualificação.

**Qualificado para visita:** perfil e unidade candidata coerentes, com interesse de visita declarado. **Qualificado para busca:** necessidade suficientemente definida, mas a carteira ainda não trouxe unidade adequada; o corretor recebe os critérios para procurar. Não é necessário encontrar um imóvel para qualificar a pessoa.

O aviso traz “Fulano está qualificado”, finalidade, evidências, unidade candidata ou critérios de busca, pendências e ação recomendada. Pedido explícito de humano permite intervenção antecipada, marcado como tal; não deve fabricar o estado “qualificado”.

<!-- PAGE -->

'''+s[end:]
s=s.replace('O backend salva resumo, responsável, prioridade e notificação de forma consistente.', 'Ao atingir o estado qualificado, o backend salva resumo, responsável, prioridade e notificação de forma consistente. O aviso informa se o corretor deve ajudar na visita, escolha ou busca de unidade. Pedido humano antecipado gera aviso próprio, mesmo sem qualificação concluída.')
s=s.replace('Ao encaminhar, a IA pausa a qualificação. Ao assumir ou responder, o corretor confirma o controle humano; respostas automáticas pendentes são invalidadas.', 'Notificar o corretor não encerra automaticamente a conversa. Enquanto aguarda, o agente pode responder dúvidas dentro do escopo e enriquecer o contexto, sem continuar um interrogatório ou prometer agenda. Ao assumir ou responder, o corretor confirma o controle humano; a IA pausa e respostas automáticas pendentes são invalidadas.')
s=s.replace('| Pausa humana | Pausar também ao encaminhar; exigir retomada explícita autorizada |', '| Pausa humana | Aviso de qualificação não encerra a conversa; assumir ou responder pausa a IA |')
s=s.replace('respostas, campos mínimos flexíveis e encaminhamento antecipado','respostas, campos mínimos flexíveis e encaminhamento antecipado')
s=s.replace('| Resposta sugerida | Acrescentar roteiro, campos mínimos flexíveis e encaminhamento antecipado |', '| Atendimento comercial | Responder à dúvida de entrada, descobrir necessidades, consultar unidades e sinalizar qualificação |')
s=s.replace('Seu pedido atual define o destino: pré-qualificação automática com encaminhamento.', 'Seu pedido atual define o destino: atendimento comercial autônomo que pré-qualifica, qualifica e sinaliza à equipe quando há uma ação concreta para o corretor.')
s=s.replace('**Status final:** proposta para revisão.', '**Revisão 1.1:** condução comercial consultiva, entrada por dúvida sobre imóvel, descoberta estratégica, critérios de qualificação e notificação separada da tomada humana. **Status final:** proposta para revisão.')
p.write_text(s,encoding='utf-8')
b=Path('tmp/pdfs/build_lotti_proposal.py')
t=b.read_text(encoding='utf-8').replace('PROPOSTA 1.0','PROPOSTA 1.1').replace('10.09.2026','11.09.2026').replace("('04','Pré-qualificação','Conversa e atualiza'),('05','Prioridade','Resumo e responsável')","('04','Qualificação','Descobre e orienta'),('05','Qualificado','Avisa o corretor na Lotti')")
b.write_text(t,encoding='utf-8')
r=Path('C:/Users/Gabri/n8n-agent-lotti/README.md')
t=r.read_text(encoding='utf-8').replace('Planejamento do agente de pré-qualificação de leads pelo WhatsApp','Planejamento do agente de atendimento comercial e qualificação de leads pelo WhatsApp')
t+='\n## Revisão 1.1\n\nO agente conduz a conversa a partir da dúvida sobre um imóvel, descobre necessidades e critérios, consulta unidades compatíveis e avisa a equipe quando o lead está qualificado para visita ou busca. O aviso não encerra o atendimento; a IA pausa quando o corretor assume ou responde.\n'
r.write_text(t,encoding='utf-8')

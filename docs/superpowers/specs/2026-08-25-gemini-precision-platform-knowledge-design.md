# Gemini 2.5 Flash: precisão e conhecimento operacional da plataforma

## Objetivo

Maximizar a precisão das funcionalidades existentes baseadas em Gemini sem trocar o
modelo `gemini-2.5-flash` e sem adicionar OpenAI nesta etapa. O Gemini deverá:

- responder com dados verificáveis do CRM;
- gerar e analisar documentos com campos e formatos controlados;
- orientar o usuário sobre páginas, abas, botões e fluxos da Lotti;
- sugerir ações seguras, executadas somente após confirmação;
- admitir quando uma informação não estiver disponível;
- manter qualidade mensurável por uma suíte de avaliações.

## Escopo

O trabalho cobre as Edge Functions que usam Gemini, com prioridade para:

- `ai-assistant`;
- `analisar-contrato` e `gerar-contrato`;
- `ai-process-file` e roteamento de documentos;
- `generate-whatsapp-message`;
- `analisar-foto` e `analisar-fotos-imovel`.

Também cobre o hook e os componentes do Assistente necessários para confirmação de
ações, feedback e apresentação de fontes. Não cobre um novo assistente OpenAI,
atendimento autônomo por WhatsApp, busca aberta na internet ou redesenho visual da
plataforma.

## Princípios de precisão

1. Dados do CRM só podem ser afirmados após consulta a uma ferramenta.
2. Conhecimento da interface vem de um catálogo versionado, não da memória geral do
   modelo.
3. Ausência de evidência produz uma resposta explícita de indisponibilidade.
4. Escritas exigem schema válido, resumo legível e confirmação humana.
5. Documentos nunca completam campos ausentes com valores fictícios.
6. Cálculos relevantes são feitos no código, não estimados pelo modelo.
7. Prompts, ferramentas e schemas são testados como código de produção.

## Arquitetura proposta

### 1. Catálogo operacional da Lotti

Será criado um catálogo tipado e versionado que descreve a interface real. Cada entrada
terá, quando aplicável:

- módulo e rota;
- nome da página e localização no menu lateral;
- abas e seções;
- rótulo visível do botão ou comando;
- finalidade;
- pré-requisitos e campos obrigatórios;
- resultado esperado;
- confirmação ou risco envolvido;
- ferramenta do assistente relacionada;
- limitações conhecidas.

Exemplo conceitual:

```ts
{
  module: "Clientes",
  route: "/clientes",
  location: "Menu lateral > Clientes",
  action: "Novo cliente",
  control: { kind: "button", label: "Novo Cliente" },
  effect: "Abre o formulário de cadastro de cliente",
  requiredFields: ["nome", "telefone"],
  assistantTool: "suggest_action:create_client"
}
```

O catálogo não dependerá de coordenadas de tela, porque elas mudam conforme dispositivo
e responsividade. A orientação usará nomes estáveis: menu, página, aba, seção e rótulo
visível. Rotas condicionais por feature flag e controles dependentes de permissão serão
descritos explicitamente.

Uma checagem automatizada comparará o catálogo com as rotas e itens principais de
navegação. A cobertura de botões será incremental e priorizará primeiro todos os fluxos
de negócio, não componentes genéricos como fechar modal ou abrir tooltip.

### 2. Ferramenta de ajuda da plataforma

O `ai-assistant` ganhará uma ferramenta de leitura `get_platform_help`, com busca por
módulo, página, ação ou rótulo. Perguntas como “onde cadastro um imóvel?” ou “o que faz
o botão Gerar Contrato?” deverão consultar essa ferramenta antes da resposta.

A resposta da ferramenta será pequena e estruturada. O Gemini transformará o resultado
em instruções passo a passo, citando os rótulos reais da interface. Se não houver uma
entrada compatível, responderá que não localizou aquele comando na versão catalogada.
Ele não poderá inventar um botão, rota ou capacidade.

O contexto-base do prompt conterá apenas uma visão geral dos módulos e a regra de usar
a ferramenta. O catálogo inteiro não será enviado em todas as mensagens, evitando
ruído, custo e perda de atenção.

### 3. Contexto e memória de conversa

O histórico passará a carregar as mensagens mais recentes em ordem cronológica. Quando
uma conversa exceder a janela direta, fatos antigos úteis serão preservados em um
resumo estruturado, separado das instruções do sistema.

O contexto operacional inicial incluirá somente informações calculadas e verificadas,
como contagens, follow-ups vencidos, alertas e datas relevantes. Será corrigida a
inconsistência atual que chama contratos `FINALIZADO` de ativos. Erros individuais ao
carregar contexto serão identificados; um zero não substituirá silenciosamente uma
consulta que falhou.

Arquivos enviados serão delimitados como dados não confiáveis. Instruções encontradas
dentro de documentos não poderão substituir regras do sistema nem autorizar ações.

### 4. Prompts especializados

Haverá uma base comum curta, complementada por instruções específicas de cada tarefa:

- assistente e navegação da plataforma;
- consulta e análise do CRM;
- extração de documentos;
- geração de contrato;
- análise jurídica assistiva;
- geração de mensagem;
- análise de fotografias.

Os prompts definirão fonte permitida, campos obrigatórios, formato de saída, critérios
de recusa, linguagem e exemplos curtos de sucesso e falha. A data atual será fornecida
pelo servidor. Conteúdo jurídico será apresentado como apoio operacional, sem afirmar
substituir revisão profissional.

### 5. Ferramentas, schemas e execução

Entradas e saídas das ferramentas terão schemas de runtime. Argumentos inválidos não
serão convertidos silenciosamente em zero, string vazia ou valor padrão que altere o
sentido do pedido. O assistente solicitará o dado faltante.

As ferramentas de leitura retornarão um envelope comum:

```ts
{
  ok: boolean,
  data?: unknown,
  source: string,
  count?: number,
  error?: { code: string, message: string }
}
```

O ciclo de ferramentas terá número máximo de etapas, timeout e tratamento para JSON
malformado. Chamadas de escrita permanecerão como propostas. A confirmação revalidará
o payload no frontend e no servidor antes de persistir.

O histórico de contatos será alinhado ao schema vigente (`data_contato`, `conteudo` e
vocabulário de canais), eliminando as referências antigas encontradas na implementação.

### 6. Documentos e contratos

Cada tipo de documento terá schema próprio. A extração retornará, além dos campos:

- tipo identificado;
- confiança por campo;
- trecho ou página de origem quando disponível;
- campos obrigatórios ausentes;
- alertas de inconsistência.

Geração de contrato seguirá três fases:

1. validar e normalizar os dados recebidos;
2. gerar conteúdo com estrutura obrigatória;
3. validar a saída antes de salvar ou disponibilizar.

Valores, datas, partes, imóvel e cláusulas essenciais serão conferidos
programaticamente. Se a saída falhar, haverá uma tentativa de reparo orientada pelos
erros; persistindo a falha, o usuário receberá mensagem clara e nenhum documento será
tratado como concluído.

### 7. Configuração do Gemini

O modelo permanecerá `gemini-2.5-flash`, centralizado em configuração compartilhada
para evitar divergências entre funções. Tarefas determinísticas usarão baixa
variabilidade e saída estruturada. Tarefas de redação poderão usar configuração um
pouco mais flexível, mantendo validação posterior.

O nível de raciocínio será configurado conforme a tarefa: maior para análise de
contratos e decisões com várias ferramentas; menor para classificação simples e
mensagens curtas. Tokens de saída, timeouts e tentativas serão limitados por operação.

### 8. Observabilidade e feedback

Serão registrados somente metadados operacionais necessários:

- modelo e versão de prompt;
- duração e resultado;
- ferramentas chamadas;
- erros de schema ou integração;
- ação proposta, confirmada ou rejeitada;
- avaliação explícita positiva ou negativa, quando fornecida.

Não serão registrados prompt secreto, raciocínio interno, chaves ou conteúdo pessoal
adicional fora dos dados já autorizados pela aplicação. O campo de modelo das conversas
será alinhado ao Gemini realmente utilizado.

## Avaliações e testes

A suíte inicial terá casos representativos das seguintes categorias:

- localização de páginas, abas e botões;
- explicação correta da finalidade de controles;
- consultas de clientes, imóveis, financeiro, contratos, alertas e funil;
- pergunta sem dados disponíveis;
- nomes ambíguos e múltiplos resultados;
- datas relativas e cálculos;
- extração de documentos completos e incompletos;
- geração e análise de contratos;
- propostas de escrita e confirmação;
- tentativa de prompt injection em mensagem e arquivo;
- chamada de ferramenta com argumentos inválidos;
- falha do Supabase ou do Gemini.

Os testes determinísticos validarão catálogo, schemas, construção de contexto,
seleção/execução de ferramentas e validadores de documentos. Um conjunto de evals do
modelo terá critérios objetivos: resposta apoiada em fonte, ferramenta correta, campos
corretos, ausência de invenção e orientação navegacional compatível com o catálogo.

Mudanças de prompt ou ferramenta só serão aceitas se não reduzirem a taxa de sucesso
da baseline. Testes que dependam da API real serão separados dos testes locais e não
exporão segredos.

## Implantação

A entrega será dividida em etapas reversíveis:

1. correções de memória, schema e contexto;
2. catálogo operacional e `get_platform_help`;
3. schemas e validadores compartilhados;
4. prompts especializados e configuração por tarefa;
5. documentos e contratos com validação em múltiplas fases;
6. telemetria, feedback e suíte de evals;
7. publicação gradual das Edge Functions e smoke tests autenticados.

Cada etapa terá testes antes do deploy. Alterações de banco serão feitas por migration.
As mudanças locais já existentes no repositório serão preservadas e não serão incluídas
por acidente nos commits deste trabalho.

## Critérios de aceite

- O assistente usa as mensagens recentes, não as mais antigas.
- Nenhum status ou métrica do CRM é apresentado com semântica incorreta.
- Perguntas sobre navegação citam página, seção/aba e rótulo existentes no catálogo.
- O Gemini não inventa botões ou capacidades quando o catálogo não contém a resposta.
- Consultas ao CRM usam ferramentas e distinguem vazio de erro.
- Ações inválidas ou incompletas não são persistidas.
- Documentos informam campos ausentes e não fabricam valores.
- Contratos gerados passam por validação programática antes de serem aceitos.
- O modelo registrado corresponde a `gemini-2.5-flash`.
- A suíte de testes e evals possui baseline documentada e reproduzível.
- Build e testes específicos passam; falhas preexistentes de typecheck/lint são
  identificadas separadamente.

## Riscos e mitigação

- **Catálogo ficar desatualizado:** checagens de cobertura e revisão obrigatória ao
  alterar rotas ou fluxos principais.
- **Prompt excessivamente grande:** recuperação seletiva via ferramenta.
- **Maior latência por raciocínio e validação:** configuração por tipo de tarefa e
  limites explícitos.
- **Falsa segurança jurídica:** avisos adequados e validações objetivas, mantendo a
  revisão humana.
- **Evals frágeis:** critérios estruturais e factuais, evitando exigir redação literal.

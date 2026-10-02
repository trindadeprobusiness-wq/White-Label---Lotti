Oi! Mais um, menor que o anterior. Está no Pull Request #46:

https://github.com/trindadeprobusiness-wq/casa-mente-contrato/pull/46

=== Fazer o merge ===

Mesma coisa de sempre: a Vercel bloqueia o deploy quando o commit é de
alguém sem acesso ao projeto dela. Não é erro de código, o build nem
chega a rodar.

  1. Abra o link acima
  2. Confira se o check "verify" está verde (é a suíte de testes)
  3. Clique em "Merge pull request" e confirme

Pode ignorar os dois checks vermelhos da Vercel.

=== NÃO rode "supabase db push" ===

Vale o mesmo aviso do anterior. O histórico de migrations do banco está
dessincronizado do repositório — 103 arquivos aqui contra 43 registrados
lá. Um "db push" tentaria rodar as que faltam, começando por uma de
janeiro, e boa parte quebra na hora porque cria tabelas e policies que já
existem. Ele aborta no primeiro erro.

A migration deste PR JÁ FOI aplicada e registrada, com conferência antes e
depois. Não há nada de banco para você fazer — só o merge, para a Vercel
publicar a tela.

=== O que muda ===

Isto é conserto de encanamento do agente de WhatsApp. Não muda nenhuma
tela que o corretor usa no dia a dia, mas evita duas formas de conversa
morta.

O problema de fundo:

  Quando a IA escreve uma resposta e o envio pelo WhatsApp não é
  confirmado, o sistema para de propósito — ninguém sabe se a pessoa
  recebeu, e mandar de novo pode repetir a mesma frase. Até agora, QUALQUER
  erro caía nessa categoria, inclusive os casos em que o WhatsApp recusou
  o envio na cara e a mensagem comprovadamente não saiu. A conversa
  congelava e precisava de alguém mexendo no banco para voltar.

O que este PR faz:

  - A ponte passa a poder dizer "não saiu, tenho certeza". Nesse caso a
    conversa não congela: a IA tenta de novo sozinha.

  - Só a recusa explícita do WhatsApp conta como certeza. Erro de servidor
    e resposta sem confirmação continuam tratados como dúvida, porque a
    mensagem PODE ter saído — e mensagem repetida no WhatsApp de um
    cliente é pior do que conversa parada esperando alguém olhar.

  - A retentativa automática ganhou um freio que o cliente não consegue
    desarmar escrevendo de novo. Sem isso, um lead insistindo manteria a
    IA tentando indefinidamente, sem nunca passar para a equipe e sem
    avisar ninguém.

  - A tela do Inbox aprendeu os motivos novos. Sem isso eles cairiam num
    texto genérico que não diz o que houve nem o que fazer.

  - Um defeito meu, de hoje de manhã: o botão "Não chegou" marcava o
    registro de um jeito que podia travar a conversa no caminho
    automático. Passa a apagar.

=== Como foi verificado ===

A migration foi revisada por três revisões independentes antes de ser
proposta, cada uma procurando um tipo de falha: quebra da máquina de
estados, risco de mensagem duplicada ou perdida, e problema na hora de
aplicar com o banco em uso.

Duas delas acharam defeito grave na primeira versão. Os dois foram
corrigidos e estão cobertos por teste.

Testes: 25 arquivos de migration, 365 testes, rodando a cadeia real de
migrations num Postgres de verdade.

=== Depois do merge ===

Nada da sua parte. A ponte (o servidor que conversa com o WhatsApp) só
pode ser atualizada depois que a migration estiver aplicada, e essa ordem
já está combinada com quem cuida dela.

Obrigado!

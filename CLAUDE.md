# Instruções para o Claude

No início de cada sessão neste projeto:

1. Leia `AI_HANDOFF.md`.
2. Rode `git status --short` e inspecione os diffs relevantes.
3. Trate o Git como fonte da verdade e o handoff como resumo auxiliar.
4. Preserve trabalho não commitado de outros agentes.

Antes de encerrar uma etapa relevante, atualize em `AI_HANDOFF.md` o estado verificado,
as validações realizadas, pendências e uma entrada curta no diário identificada como
`Claude`. Não registre raciocínio interno, segredos ou dados pessoais.

## Regras duras (valem sempre)

- Responder sempre em português do Brasil.
- Afirmar só com base em código real, log ou dado conferido. Nada de achismo; o que não deu para
  conferir é dito como não conferido.
- Segredos só pelo nome da variável; nunca colar valor de chave, senha ou token.
- Nenhuma mensagem a cliente real sem pedido explícito do Rafael.
- Notebook fraco: testes um arquivo por vez, nunca a suíte inteira, nunca duas IAs rodando testes
  ao mesmo tempo.
- Push com a conta GitHub `rportocortes`.
- Ação para o Codex vem sempre com o prompt pronto para colar.
- O Codex não mexe no worktree `follow-up-leads`.
- Não pausar nem apagar o Supabase antes da recuperação combinada.
- Não mexer em nada do Asaas nem da API do Gemini (já configurados): código, configuração, webhooks e
  chaves. Nem pedir ao Codex para consultar ou alterar esses dois.

## Fluxo para tarefa complexa

Tarefa complexa: mexe em banco/migration, em mais de um serviço ou repositório, no comportamento do
agente de IA ou do WhatsApp, em pagamento (Asaas), em autenticação/segurança, ou em muitos arquivos.
Ajuste pequeno e localizado (texto, visual de uma tela, correção pontual) segue direto.

1. Ler este arquivo inteiro e as regras duras acima.
2. Montar o plano da tarefa.
3. Disparar agentes em paralelo para pesquisar o plano no código real e validar se faz sentido
   (agentes só leem e pesquisam; testes continuam um por vez).
4. Rodada adversarial: agentes tentando achar buracos, pontos fracos, erros e o que ficou de fora.
5. Ajustar o plano com o que a pesquisa e a adversarial trouxeram; só então codar.
6. Antes de subir (push/deploy), validar com o Rafael: o que muda, o que foi testado e os riscos.
7. Registrar no `AI_HANDOFF.md` o plano final, o que a adversarial mudou e as validações.


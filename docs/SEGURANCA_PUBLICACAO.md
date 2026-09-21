# Correções de segurança — setembro de 2026

## Escopo preparado no repositório

- Captura de leads: JSON até 16 KiB (contagem dos bytes reais), tipos e tamanhos validados, aliases legados de nome/telefone preservados, metadados em allowlist e métodos restritos.
- Limite no PostgreSQL: 5 submissões por telefone em 10 minutos e 300 por minuto globalmente para `lead-capture`. Chave do contador é HMAC, sem telefone bruto. Na falha do limitador a função devolve 503, sem gravar. Excesso devolve 429 com `Retry-After`.
- QR Code: o INSERT direto recebe validação, limite de 5 leads por telefone/10 minutos e 300 leads/minuto globalmente. Escaneamentos: 120 por fachada/minuto e 1.200/minuto globalmente. Os dois canais de leads têm contadores separados. Campos de conversão/data não são aceitos do visitante; IP/hash declarado pelo cliente é descartado. A consulta da atividade da fachada não expõe a tabela ao visitante.
- Resposta pública uniforme para cliente novo, existente ou sem destinatário; mensagens de erro não revelam detalhes internos. Falha ao guardar lead sem destino não retorna sucesso.
- `public-imoveis`, `imovel-detalhe` e `fachada-publica`: validação básica de filtros/UUID, métodos permitidos e erros genéricos.
- Anexos de IA: bucket privado, até 50 MiB e os mesmos MIME types permitidos pela função de processamento. Policies existentes por pasta permanecem.
- CSP bloqueia scripts inline/handlers e objetos incorporados. Inicialização do Clarity em arquivo local. Conexões HTTPS continuam permitidas porque o app possui webhook de conversão configurável; esta CSP não é uma barreira completa contra exfiltração. Estilos inline são necessários ao Radix/React; imagens/vídeos HTTPS, blobs e visualização de PDFs foram preservados.
- Título da impressão de fachada usa `document.title`, sem interpolar texto do imóvel em HTML.
- Dependências atualizadas; instalação de produção usa `npm ci`. Servidor Vite escuta apenas em loopback por padrão.

## Ordem de publicação

1. Revisar/aplicar `supabase/migrations/20260916010000_public_security.sql` no projeto correto. A migration pressupõe as tabelas de fachadas existentes (`supabase/migration_fachadas.sql`) e o Storage. Não executar apenas o código da função antes do banco: o limitador ausente bloqueia a captura com 503.
2. Conferir integrações que consomem `lead-capture`: respostas detalhadas (`cliente_id`, `is_new`, `qualificar_com_ia`, `pendente_triagem`) exigem `x-n8n-secret` correspondente a `N8N_SHARED_SECRET` no ambiente da função. Nunca colocar esse segredo em variáveis `VITE_*`, no navegador ou no Git. Sem segredo, o visitante continua recebendo a confirmação genérica.
3. A captura não executa IA e agora **não debita cota**. `qualificar_com_ia` é uma consulta de permissão para integração autenticada. O executor real da qualificação deve revalidar a cota e registrar o consumo uma única vez após a operação efetiva. Conferir esse contrato nos workflows externos antes de ativar qualificação automática.
4. Publicar `lead-capture`, `public-imoveis`, `imovel-detalhe` e `fachada-publica`, incluindo os módulos compartilhados. `PUBLIC_RATE_LIMIT_SECRET` é opcional; se ausente, a função deriva os hashes usando a chave de serviço já disponível. Alterar a chave reinicia a identidade dos contadores de telefone, não o limite global.
5. Publicar o frontend e verificar captura QR, login, documentos, impressão, webhook de conversão e analytics nos domínios reais. Os testes locais usam dados fictícios.

## Verificação reproduzível

```powershell
npm ci
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='test-public-key'
npm test
npm run build
npm run audit:security
npx playwright install chromium --only-shell
npm run test:security-browser
```

Os testes PostgreSQL usam PGlite com um schema mínimo representativo, executam a migration e trocam os papéis `anon`, `authenticated` e `service_role`. Isso valida o SQL e os controles introduzidos; não substitui testar a cadeia completa de migrations e todos os acessos entre contas no Supabase publicado. O teste de navegador usa o bundle local com a CSP de produção e intercepta integrações externas; não valida os serviços de terceiros.

## Pendências fora deste commit

- Aplicação da migration e publicação das funções/frontend não são realizadas pelo push da branch ao Git por si só.
- Confirmar revogação de credenciais antigas. `.gitignore` não revoga tokens e esta etapa não reescreve o histórico Git.
- Testar isolamento completo entre duas contas reais de teste e revisar privilégios de assinatura/cotas. RLS por linha não impede o dono de alterar campos de cobrança quando possui permissão de escrita.
- Rate limit reduz gravações abusivas; não comprova humanidade. CAPTCHA/WAF e limites por origem confiável continuam como próxima camada. Os limites globais podem afetar visitantes legítimos durante ataque e precisam de monitoramento.
- O scan npm não cobre imports remotos Deno, imagens Docker ou configurações dos provedores. O typecheck global tem pendências preexistentes no schema/tipos do projeto.

-- ============================================================================
-- CORREÇÃO CRÍTICA — IDOR cross-tenant no Storage (OWASP A01)
-- ============================================================================
-- ANTES: todas as policies de storage.objects filtravam SOMENTE por bucket_id,
-- sem verificar dono. Ex.: USING (bucket_id = 'documentos'). Como o cadastro
-- público estava aberto, QUALQUER pessoa podia se registrar e ler/apagar os
-- arquivos privados (contratos, documentos, anexos de IA) de todos os corretores.
--
-- CONVENÇÃO VERIFICADA EM PRODUÇÃO (15 objetos inspecionados antes de escrever):
--   documentos      -> path '<corretor_id>/...'        (11/11 objetos conferem)
--   imoveis-fotos   -> path misto ('<uuid>/', 'fachadas/'); owner confiável (4/4)
--   ai-attachments  -> bucket vazio (0 objetos)
--   owner de 15/15 objetos = user_id do corretor -> escopo por owner é seguro.
--
-- ESTRATÉGIA: endurecer SELECT/UPDATE/DELETE (onde mora o dano real: ler e
-- apagar arquivo alheio). O INSERT fica escopado só onde a convenção de path é
-- comprovada (documentos), evitando regressão de upload nos demais.
-- ============================================================================

-- ---------- documentos (privado): escopo por CORRETOR via path ----------
DROP POLICY IF EXISTS "Corretor pode fazer upload de documentos" ON storage.objects;
DROP POLICY IF EXISTS "Corretor pode ver seus documentos" ON storage.objects;
DROP POLICY IF EXISTS "Corretor pode deletar seus documentos" ON storage.objects;

CREATE POLICY "documentos: corretor le os seus" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = public.get_corretor_id()::text
  );

CREATE POLICY "documentos: corretor faz upload nos seus" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = public.get_corretor_id()::text
  );

CREATE POLICY "documentos: corretor atualiza os seus" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = public.get_corretor_id()::text
  );

CREATE POLICY "documentos: corretor deleta os seus" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = public.get_corretor_id()::text
  );

-- ---------- ai-attachments (privado): escopo pelo dono do upload ----------
DROP POLICY IF EXISTS "Corretor faz upload em ai-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Corretor lê seus uploads em ai-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Corretor le seus uploads em ai-attachments" ON storage.objects;

CREATE POLICY "ai-attachments: dono le" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ai-attachments' AND owner = auth.uid());

-- INSERT sem checar owner: o owner é atribuído pelo storage no momento da escrita
-- e a convenção de path desta função ainda não é garantida. Ler/apagar já está fechado.
CREATE POLICY "ai-attachments: upload autenticado" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ai-attachments');

CREATE POLICY "ai-attachments: dono deleta" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ai-attachments' AND owner = auth.uid());

-- ---------- imoveis-fotos (bucket PÚBLICO = catálogo de anúncios) ----------
-- A leitura segue pública de propósito (o bucket é public:true e as fotos são o
-- catálogo). O que estava errado era qualquer autenticado APAGAR/ALTERAR foto alheia.
DROP POLICY IF EXISTS "Corretor pode fazer upload de fotos de imoveis" ON storage.objects;
DROP POLICY IF EXISTS "Corretor pode deletar fotos de seus imoveis" ON storage.objects;
DROP POLICY IF EXISTS "Corretor pode atualizar fotos de seus imoveis" ON storage.objects;

CREATE POLICY "imoveis-fotos: upload autenticado" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imoveis-fotos');

CREATE POLICY "imoveis-fotos: dono atualiza" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'imoveis-fotos' AND owner = auth.uid());

CREATE POLICY "imoveis-fotos: dono deleta" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'imoveis-fotos' AND owner = auth.uid());

-- A policy de SELECT público "Fotos de imoveis sao publicas" é mantida (intencional).

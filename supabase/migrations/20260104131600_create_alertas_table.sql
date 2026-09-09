-- Create enum types if they don't exist
DO $$ BEGIN
    CREATE TYPE tipo_alerta AS ENUM ('SISTEMA', 'CONTRATO', 'MENSALIDADE', 'DOCUMENTO', 'TAREFA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE prioridade_alerta AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'URGENTE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create table
CREATE TABLE IF NOT EXISTS public.alertas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    imovel_id UUID REFERENCES public.imoveis(id) ON DELETE SET NULL,
    contrato_id UUID REFERENCES public.contratos(id) ON DELETE SET NULL,
    tipo tipo_alerta NOT NULL,
    prioridade prioridade_alerta NOT NULL DEFAULT 'BAIXA',
    mensagem TEXT NOT NULL,
    lido BOOLEAN DEFAULT false,
    data_alerta TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- RLS policies
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corretores podem ver seus próprios alertas" 
    ON public.alertas 
    FOR SELECT 
    USING (auth.uid() IN (SELECT user_id FROM public.corretores WHERE id = alertas.corretor_id));

CREATE POLICY "Corretores podem inserir seus próprios alertas" 
    ON public.alertas 
    FOR INSERT 
    WITH CHECK (auth.uid() IN (SELECT user_id FROM public.corretores WHERE id = alertas.corretor_id));

CREATE POLICY "Corretores podem atualizar seus próprios alertas" 
    ON public.alertas 
    FOR UPDATE 
    USING (auth.uid() IN (SELECT user_id FROM public.corretores WHERE id = alertas.corretor_id));

CREATE POLICY "Corretores podem deletar seus próprios alertas" 
    ON public.alertas 
    FOR DELETE 
    USING (auth.uid() IN (SELECT user_id FROM public.corretores WHERE id = alertas.corretor_id));

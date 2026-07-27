export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alertas: {
        Row: {
          cliente_id: string | null
          contrato_id: string | null
          corretor_id: string
          created_at: string | null
          data_alerta: string | null
          id: string
          imovel_id: string | null
          lido: boolean | null
          mensagem: string
          prioridade: Database["public"]["Enums"]["prioridade_alerta"]
          tipo: Database["public"]["Enums"]["tipo_alerta"]
        }
        Insert: {
          cliente_id?: string | null
          contrato_id?: string | null
          corretor_id: string
          created_at?: string | null
          data_alerta?: string | null
          id?: string
          imovel_id?: string | null
          lido?: boolean | null
          mensagem: string
          prioridade?: Database["public"]["Enums"]["prioridade_alerta"]
          tipo: Database["public"]["Enums"]["tipo_alerta"]
        }
        Update: {
          cliente_id?: string | null
          contrato_id?: string | null
          corretor_id?: string
          created_at?: string | null
          data_alerta?: string | null
          id?: string
          imovel_id?: string | null
          lido?: boolean | null
          mensagem?: string
          prioridade?: Database["public"]["Enums"]["prioridade_alerta"]
          tipo?: Database["public"]["Enums"]["tipo_alerta"]
        }
        Relationships: [
          {
            foreignKeyName: "alertas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_imovel: {
        Row: {
          cliente_id: string
          created_at: string | null
          data_visita: string | null
          id: string
          imovel_id: string
          nivel_interesse: number | null
          observacoes: string | null
          visitou: boolean | null
        }
        Insert: {
          cliente_id: string
          created_at?: string | null
          data_visita?: string | null
          id?: string
          imovel_id: string
          nivel_interesse?: number | null
          observacoes?: string | null
          visitou?: boolean | null
        }
        Update: {
          cliente_id?: string
          created_at?: string | null
          data_visita?: string | null
          id?: string
          imovel_id?: string
          nivel_interesse?: number | null
          observacoes?: string | null
          visitou?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_imovel_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_imovel_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          corretor_id: string
          cpf: string | null
          created_at: string | null
          email: string | null
          endereco_completo: string | null
          estado_civil: string | null
          id: string
          nacionalidade: string | null
          nome: string
          observacoes: string | null
          profissao: string | null
          proximo_followup: string | null
          rg: string | null
          status_funil: Database["public"]["Enums"]["status_funil"]
          telefone: string
          tipo_interesse: Database["public"]["Enums"]["tipo_interesse"]
          ultimo_contato: string | null
          updated_at: string | null
        }
        Insert: {
          corretor_id: string
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          endereco_completo?: string | null
          estado_civil?: string | null
          id?: string
          nacionalidade?: string | null
          nome: string
          observacoes?: string | null
          profissao?: string | null
          proximo_followup?: string | null
          rg?: string | null
          status_funil?: Database["public"]["Enums"]["status_funil"]
          telefone: string
          tipo_interesse?: Database["public"]["Enums"]["tipo_interesse"]
          ultimo_contato?: string | null
          updated_at?: string | null
        }
        Update: {
          corretor_id?: string
          cpf?: string | null
          created_at?: string | null
          email?: string | null
          endereco_completo?: string | null
          estado_civil?: string | null
          id?: string
          nacionalidade?: string | null
          nome?: string
          observacoes?: string | null
          profissao?: string | null
          proximo_followup?: string | null
          rg?: string | null
          status_funil?: Database["public"]["Enums"]["status_funil"]
          telefone?: string
          tipo_interesse?: Database["public"]["Enums"]["tipo_interesse"]
          ultimo_contato?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos: {
        Row: {
          arquivo_url: string | null
          clausulas_adicionais: string[] | null
          cliente_id: string
          conteudo: string
          corretor_id: string
          created_at: string | null
          data_inicio: string
          dia_vencimento: number | null
          id: string
          imovel_id: string
          indice_reajuste: string | null
          modelo_ia: string | null
          prazo_meses: number | null
          status: string
          tempo_geracao_ms: number | null
          tipo: Database["public"]["Enums"]["tipo_contrato"]
          updated_at: string | null
          valor: number
          versao: number | null
        }
        Insert: {
          arquivo_url?: string | null
          clausulas_adicionais?: string[] | null
          cliente_id: string
          conteudo: string
          corretor_id: string
          created_at?: string | null
          data_inicio: string
          dia_vencimento?: number | null
          id?: string
          imovel_id: string
          indice_reajuste?: string | null
          modelo_ia?: string | null
          prazo_meses?: number | null
          status?: string
          tempo_geracao_ms?: number | null
          tipo: Database["public"]["Enums"]["tipo_contrato"]
          updated_at?: string | null
          valor: number
          versao?: number | null
        }
        Update: {
          arquivo_url?: string | null
          clausulas_adicionais?: string[] | null
          cliente_id?: string
          conteudo?: string
          corretor_id?: string
          created_at?: string | null
          data_inicio?: string
          dia_vencimento?: number | null
          id?: string
          imovel_id?: string
          indice_reajuste?: string | null
          modelo_ia?: string | null
          prazo_meses?: number | null
          status?: string
          tempo_geracao_ms?: number | null
          tipo?: Database["public"]["Enums"]["tipo_contrato"]
          updated_at?: string | null
          valor?: number
          versao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
      corretores: {
        Row: {
          cnpj_cpf: string | null
          created_at: string | null
          creci: string
          creci_estado: string
          email: string
          endereco: string | null
          endereco_completo: string | null
          foto_url: string | null
          id: string
          nome: string
          preferencias: Json | null
          razao_social: string | null
          telefone: string
          updated_at: string | null
          user_id: string
          website: string | null
        }
        Insert: {
          cnpj_cpf?: string | null
          created_at?: string | null
          creci: string
          creci_estado?: string
          email: string
          endereco?: string | null
          endereco_completo?: string | null
          foto_url?: string | null
          id?: string
          nome: string
          preferencias?: Json | null
          razao_social?: string | null
          telefone: string
          updated_at?: string | null
          user_id: string
          website?: string | null
        }
        Update: {
          cnpj_cpf?: string | null
          created_at?: string | null
          creci?: string
          creci_estado?: string
          email?: string
          endereco?: string | null
          endereco_completo?: string | null
          foto_url?: string | null
          id?: string
          nome?: string
          preferencias?: Json | null
          razao_social?: string | null
          telefone?: string
          updated_at?: string | null
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      documentos: {
        Row: {
          arquivo_path: string | null
          arquivo_url: string | null
          cliente_id: string | null
          corretor_id: string
          created_at: string | null
          data_validade: string | null
          id: string
          imovel_id: string | null
          nome: string
          observacoes: string | null
          tipo: string
          updated_at: string | null
          validado: boolean | null
        }
        Insert: {
          arquivo_path?: string | null
          arquivo_url?: string | null
          cliente_id?: string | null
          corretor_id: string
          created_at?: string | null
          data_validade?: string | null
          id?: string
          imovel_id?: string | null
          nome: string
          observacoes?: string | null
          tipo: string
          updated_at?: string | null
          validado?: boolean | null
        }
        Update: {
          arquivo_path?: string | null
          arquivo_url?: string | null
          cliente_id?: string | null
          corretor_id?: string
          created_at?: string | null
          data_validade?: string | null
          id?: string
          imovel_id?: string | null
          nome?: string
          observacoes?: string | null
          tipo?: string
          updated_at?: string | null
          validado?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_contatos: {
        Row: {
          cliente_id: string
          corretor_id: string
          created_at: string | null
          data: string
          descricao: string
          id: string
          imovel_relacionado_id: string | null
          tipo: Database["public"]["Enums"]["tipo_contato"]
        }
        Insert: {
          cliente_id: string
          corretor_id: string
          created_at?: string | null
          data?: string
          descricao: string
          id?: string
          imovel_relacionado_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_contato"]
        }
        Update: {
          cliente_id?: string
          corretor_id?: string
          created_at?: string | null
          data?: string
          descricao?: string
          id?: string
          imovel_relacionado_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_contato"]
        }
        Relationships: [
          {
            foreignKeyName: "historico_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_contatos_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_contatos_imovel_relacionado_id_fkey"
            columns: ["imovel_relacionado_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
      imoveis: {
        Row: {
          area_m2: number | null
          ativo: boolean | null
          bairro: string | null
          cep: string | null
          cidade: string
          corretor_id: string
          created_at: string | null
          descricao: string | null
          dormitorios: number | null
          endereco: string
          estado: string | null
          exclusividade_ate: string | null
          finalidade: Database["public"]["Enums"]["finalidade_imovel"]
          garagem: number | null
          id: string
          proprietario_cpf: string | null
          proprietario_email: string | null
          proprietario_nome: string
          proprietario_telefone: string | null
          tipo: Database["public"]["Enums"]["tipo_imovel"]
          titulo: string
          updated_at: string | null
          valor: number
        }
        Insert: {
          area_m2?: number | null
          ativo?: boolean | null
          bairro?: string | null
          cep?: string | null
          cidade: string
          corretor_id: string
          created_at?: string | null
          descricao?: string | null
          dormitorios?: number | null
          endereco: string
          estado?: string | null
          exclusividade_ate?: string | null
          finalidade?: Database["public"]["Enums"]["finalidade_imovel"]
          garagem?: number | null
          id?: string
          proprietario_cpf?: string | null
          proprietario_email?: string | null
          proprietario_nome: string
          proprietario_telefone?: string | null
          tipo: Database["public"]["Enums"]["tipo_imovel"]
          titulo: string
          updated_at?: string | null
          valor: number
        }
        Update: {
          area_m2?: number | null
          ativo?: boolean | null
          bairro?: string | null
          cep?: string | null
          cidade?: string
          corretor_id?: string
          created_at?: string | null
          descricao?: string | null
          dormitorios?: number | null
          endereco?: string
          estado?: string | null
          exclusividade_ate?: string | null
          finalidade?: Database["public"]["Enums"]["finalidade_imovel"]
          garagem?: number | null
          id?: string
          proprietario_cpf?: string | null
          proprietario_email?: string | null
          proprietario_nome?: string
          proprietario_telefone?: string | null
          tipo?: Database["public"]["Enums"]["tipo_imovel"]
          titulo?: string
          updated_at?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "imoveis_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
        ]
      }
      imovel_fotos: {
        Row: {
          arquivo_path: string
          arquivo_url: string
          created_at: string | null
          id: string
          imovel_id: string
          ordem: number | null
          principal: boolean | null
        }
        Insert: {
          arquivo_path: string
          arquivo_url: string
          created_at?: string | null
          id?: string
          imovel_id: string
          ordem?: number | null
          principal?: boolean | null
        }
        Update: {
          arquivo_path?: string
          arquivo_url?: string
          created_at?: string | null
          id?: string
          imovel_id?: string
          ordem?: number | null
          principal?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "imovel_fotos_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
      lancamentos_financeiros: {
        Row: {
          categoria: Database["public"]["Enums"]["categoria_financeira"]
          comprovante_url: string | null
          contrato_id: string | null
          corretor_id: string
          created_at: string | null
          data: string
          descricao: string
          fatura_id: string | null
          id: string
          imovel_id: string | null
          recorrente: boolean | null
          tipo: Database["public"]["Enums"]["tipo_lancamento"]
          updated_at: string | null
          valor: number
        }
        Insert: {
          categoria: Database["public"]["Enums"]["categoria_financeira"]
          comprovante_url?: string | null
          contrato_id?: string | null
          corretor_id: string
          created_at?: string | null
          data?: string
          descricao: string
          fatura_id?: string | null
          id?: string
          imovel_id?: string | null
          recorrente?: boolean | null
          tipo: Database["public"]["Enums"]["tipo_lancamento"]
          updated_at?: string | null
          valor: number
        }
        Update: {
          categoria?: Database["public"]["Enums"]["categoria_financeira"]
          comprovante_url?: string | null
          contrato_id?: string | null
          corretor_id?: string
          created_at?: string | null
          data?: string
          descricao?: string
          fatura_id?: string | null
          id?: string
          imovel_id?: string | null
          recorrente?: boolean | null
          tipo?: Database["public"]["Enums"]["tipo_lancamento"]
          updated_at?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "lancamentos_financeiros_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_financeiros_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          corretor_id: string
          created_at: string
          descricao: string | null
          duracao_segundos: number | null
          id: string
          imovel_id: string | null
          thumbnail_url: string | null
          tipo: Database["public"]["Enums"]["tipo_video"]
          titulo: string
          updated_at: string
          video_path: string
          video_url: string
          visualizacoes: number
        }
        Insert: {
          corretor_id: string
          created_at?: string
          descricao?: string | null
          duracao_segundos?: number | null
          id?: string
          imovel_id?: string | null
          thumbnail_url?: string | null
          tipo?: Database["public"]["Enums"]["tipo_video"]
          titulo: string
          updated_at?: string
          video_path: string
          video_url: string
          visualizacoes?: number
        }
        Update: {
          corretor_id?: string
          created_at?: string
          descricao?: string | null
          duracao_segundos?: number | null
          id?: string
          imovel_id?: string | null
          thumbnail_url?: string | null
          tipo?: Database["public"]["Enums"]["tipo_video"]
          titulo?: string
          updated_at?: string
          video_path?: string
          video_url?: string
          visualizacoes?: number
        }
        Relationships: [
          {
            foreignKeyName: "videos_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_corretor_id: { Args: never; Returns: string }
    }
    Enums: {
      categoria_financeira:
        | "ANUNCIO_PORTAL"
        | "ANUNCIO_SOCIAL"
        | "ANUNCIO_TRADICIONAL"
        | "OPERACIONAL_ESCRITORIO"
        | "OPERACIONAL_TRANSPORTE"
        | "OPERACIONAL_SISTEMA"
        | "IMPOSTO_ISS"
        | "IMPOSTO_IR"
        | "TAXA_BANCARIA"
        | "COMISSAO_PARCEIRO"
        | "COMISSAO_VENDA"
        | "COMISSAO_LOCACAO"
        | "TAXA_INTERMEDIACAO"
        | "HONORARIO_AVALIACAO"
        | "CONSULTORIA"
        | "OUTROS"
      finalidade_imovel: "VENDA" | "LOCACAO" | "AMBOS"
      prioridade_alerta: "ALTA" | "MEDIA" | "BAIXA"
      status_funil:
        | "QUALIFICACAO"
        | "VISITA_PROPOSTA"
        | "DOCUMENTACAO"
        | "FECHADO_GANHO"
        | "FECHADO_PERDIDO"
      tipo_alerta: "FOLLOWUP" | "DOCUMENTO" | "EXCLUSIVIDADE" | "GERAL"
      tipo_contato:
        | "LIGACAO"
        | "EMAIL"
        | "WHATSAPP"
        | "VISITA"
        | "PROPOSTA"
        | "NOTA"
      tipo_contrato:
        | "COMPRA_VENDA"
        | "LOCACAO_RESIDENCIAL"
        | "LOCACAO_COMERCIAL"
        | "EXCLUSIVIDADE_VENDA"
        | "EXCLUSIVIDADE_LOCACAO"
        | "DISTRATO"
        | "PROCURACAO"
        | "OUTRO"
      tipo_imovel: "APARTAMENTO" | "CASA" | "COMERCIAL" | "TERRENO"
      tipo_interesse: "COMPRA" | "LOCACAO" | "AMBOS"
      tipo_lancamento: "RECEITA" | "DESPESA"
      tipo_video:
        | "TOUR_VIRTUAL"
        | "APRESENTACAO"
        | "DEPOIMENTO"
        | "DRONE"
        | "INSTITUCIONAL"
        | "OUTRO"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      categoria_financeira: [
        "ANUNCIO_PORTAL",
        "ANUNCIO_SOCIAL",
        "ANUNCIO_TRADICIONAL",
        "OPERACIONAL_ESCRITORIO",
        "OPERACIONAL_TRANSPORTE",
        "OPERACIONAL_SISTEMA",
        "IMPOSTO_ISS",
        "IMPOSTO_IR",
        "TAXA_BANCARIA",
        "COMISSAO_PARCEIRO",
        "COMISSAO_VENDA",
        "COMISSAO_LOCACAO",
        "TAXA_INTERMEDIACAO",
        "HONORARIO_AVALIACAO",
        "CONSULTORIA",
        "OUTROS",
      ],
      prioridade_alerta: ["ALTA", "MEDIA", "BAIXA"],
      status_funil: [
        "QUALIFICACAO",
        "VISITA_PROPOSTA",
        "DOCUMENTACAO",
        "FECHADO_GANHO",
        "FECHADO_PERDIDO",
      ],
      tipo_alerta: ["FOLLOWUP", "DOCUMENTO", "EXCLUSIVIDADE", "GERAL"],
      tipo_contato: [
        "LIGACAO",
        "EMAIL",
        "WHATSAPP",
        "VISITA",
        "PROPOSTA",
        "NOTA",
      ],
      tipo_contrato: [
        "COMPRA_VENDA",
        "LOCACAO_RESIDENCIAL",
        "LOCACAO_COMERCIAL",
        "EXCLUSIVIDADE_VENDA",
        "EXCLUSIVIDADE_LOCACAO",
        "DISTRATO",
        "PROCURACAO",
        "OUTRO",
      ],
      tipo_imovel: ["APARTAMENTO", "CASA", "COMERCIAL", "TERRENO"],
      tipo_interesse: ["COMPRA", "LOCACAO", "AMBOS"],
      tipo_lancamento: ["RECEITA", "DESPESA"],
      tipo_video: [
        "TOUR_VIRTUAL",
        "APRESENTACAO",
        "DEPOIMENTO",
        "DRONE",
        "INSTITUCIONAL",
        "OUTRO",
      ],
    },
  },
} as const

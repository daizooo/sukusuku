// Supabase CLI（generate_typescript_types）による自動生成ファイル。
// 手動編集せず、スキーマ変更後は再生成すること。
// プロジェクト: sukusuku (nbkpwjtkkiaklewtegzh)

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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      care_logs: {
        Row: {
          amount: string | null
          created_by: string | null
          family_id: string
          id: string
          logged_at: string
          note: string | null
          type: string
        }
        Insert: {
          amount?: string | null
          created_by?: string | null
          family_id: string
          id?: string
          logged_at?: string
          note?: string | null
          type: string
        }
        Update: {
          amount?: string | null
          created_by?: string | null
          family_id?: string
          id?: string
          logged_at?: string
          note?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_logs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          birth_date: string | null
          created_at: string
          family_id: string
          id: string
          name: string | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          family_id: string
          id?: string
          name?: string | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          family_id?: string
          id?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "children_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          family_id: string
          file_url: string
          id: string
          title: string
          uploaded_at: string
        }
        Insert: {
          family_id: string
          file_url: string
          id?: string
          title: string
          uploaded_at?: string
        }
        Update: {
          family_id?: string
          file_url?: string
          id?: string
          title?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id?: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      family_profiles: {
        Row: {
          address: string
          baby_name: string
          birth_date: string | null
          custom_fields: Json
          dad_name: string
          dad_workplace: string
          family_id: string
          hospital_name: string
          hospital_phone: string
          mama_company_phone: string
          mama_contact_phone: string
          mom_name: string
          mom_workplace: string
          papa_company_phone: string
          papa_contact_phone: string
          pediatric_name: string
          pediatric_phone: string
          updated_at: string
        }
        Insert: {
          address?: string
          baby_name?: string
          birth_date?: string | null
          custom_fields?: Json
          dad_name?: string
          dad_workplace?: string
          family_id: string
          hospital_name?: string
          hospital_phone?: string
          mama_company_phone?: string
          mama_contact_phone?: string
          mom_name?: string
          mom_workplace?: string
          papa_company_phone?: string
          papa_contact_phone?: string
          pediatric_name?: string
          pediatric_phone?: string
          updated_at?: string
        }
        Update: {
          address?: string
          baby_name?: string
          birth_date?: string | null
          custom_fields?: Json
          dad_name?: string
          dad_workplace?: string
          family_id?: string
          hospital_name?: string
          hospital_phone?: string
          mama_company_phone?: string
          mama_contact_phone?: string
          mom_name?: string
          mom_workplace?: string
          papa_company_phone?: string
          papa_contact_phone?: string
          pediatric_name?: string
          pediatric_phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_profiles_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      gifts: {
        Row: {
          family_id: string
          id: string
          note: string | null
          received_date: string | null
          received_item: string | null
          return_item: string | null
          return_status: string
          sender_name: string
        }
        Insert: {
          family_id: string
          id?: string
          note?: string | null
          received_date?: string | null
          received_item?: string | null
          return_item?: string | null
          return_status?: string
          sender_name: string
        }
        Update: {
          family_id?: string
          id?: string
          note?: string | null
          received_date?: string | null
          received_item?: string | null
          return_item?: string | null
          return_status?: string
          sender_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "gifts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_records: {
        Row: {
          child_id: string
          height: number | null
          id: string
          month_age: number | null
          recorded_date: string
          weight: number | null
        }
        Insert: {
          child_id: string
          height?: number | null
          id?: string
          month_age?: number | null
          recorded_date?: string
          weight?: number | null
        }
        Update: {
          child_id?: string
          height?: number | null
          id?: string
          month_age?: number | null
          recorded_date?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_records_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      nurseries: {
        Row: {
          distance: string | null
          family_id: string
          id: string
          memo: string | null
          name: string
          phone: string | null
          status: string
        }
        Insert: {
          distance?: string | null
          family_id: string
          id?: string
          memo?: string | null
          name: string
          phone?: string | null
          status?: string
        }
        Update: {
          distance?: string | null
          family_id?: string
          id?: string
          memo?: string | null
          name?: string
          phone?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurseries_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee: string
          belongings: string | null
          category: string
          created_at: string
          days_after_birth: number
          family_id: string
          has_notification: boolean
          id: string
          is_done: boolean
          note: string | null
          place: string | null
          timing_memo: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee?: string
          belongings?: string | null
          category?: string
          created_at?: string
          days_after_birth?: number
          family_id: string
          has_notification?: boolean
          id?: string
          is_done?: boolean
          note?: string | null
          place?: string | null
          timing_memo?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee?: string
          belongings?: string | null
          category?: string
          created_at?: string
          days_after_birth?: number
          family_id?: string
          has_notification?: boolean
          id?: string
          is_done?: boolean
          note?: string | null
          place?: string | null
          timing_memo?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          family_id: string | null
          id: string
          name: string | null
          role: string | null
          workplace: string | null
        }
        Insert: {
          created_at?: string
          family_id?: string | null
          id: string
          name?: string | null
          role?: string | null
          workplace?: string | null
        }
        Update: {
          created_at?: string
          family_id?: string | null
          id?: string
          name?: string | null
          role?: string | null
          workplace?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_family_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

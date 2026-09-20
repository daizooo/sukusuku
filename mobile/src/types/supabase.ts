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
          details: Json
          family_id: string
          id: string
          logged_at: string
          note: string | null
          type: string
        }
        Insert: {
          amount?: string | null
          created_by?: string | null
          details?: Json
          family_id: string
          id?: string
          logged_at?: string
          note?: string | null
          type: string
        }
        Update: {
          amount?: string | null
          created_by?: string | null
          details?: Json
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
          child_fields: Json
          custom_fields: Json
          emergency_fields: Json
          family_fields: Json
          family_id: string
          updated_at: string
        }
        Insert: {
          child_fields?: Json
          custom_fields?: Json
          emergency_fields?: Json
          family_fields?: Json
          family_id: string
          updated_at?: string
        }
        Update: {
          child_fields?: Json
          custom_fields?: Json
          emergency_fields?: Json
          family_fields?: Json
          family_id?: string
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
      feeding_reminder_deliveries: {
        Row: {
          care_log_id: string
          error: string | null
          id: string
          scheduled_for: string
          sent_at: string
          status: string
          subscription_id: string
        }
        Insert: {
          care_log_id: string
          error?: string | null
          id?: string
          scheduled_for: string
          sent_at?: string
          status?: string
          subscription_id: string
        }
        Update: {
          care_log_id?: string
          error?: string | null
          id?: string
          scheduled_for?: string
          sent_at?: string
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feeding_reminder_deliveries_care_log_id_fkey"
            columns: ["care_log_id"]
            isOneToOne: false
            referencedRelation: "care_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feeding_reminder_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      feeding_settings: {
        Row: {
          family_id: string
          interval_minutes: number
          notify_enabled: boolean
          updated_at: string
        }
        Insert: {
          family_id: string
          interval_minutes?: number
          notify_enabled?: boolean
          updated_at?: string
        }
        Update: {
          family_id?: string
          interval_minutes?: number
          notify_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feeding_settings_family_id_fkey"
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
      list_groups: {
        Row: {
          created_at: string
          id: string
          list_id: string
          name: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          list_id: string
          name: string
          position?: number
        }
        Update: {
          created_at?: string
          id?: string
          list_id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_groups_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_items: {
        Row: {
          created_at: string
          done_at: string | null
          group_id: string | null
          id: string
          is_done: boolean
          list_id: string
          position: number
          title: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          group_id?: string | null
          id?: string
          is_done?: boolean
          list_id: string
          position?: number
          title: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          group_id?: string | null
          id?: string
          is_done?: boolean
          list_id?: string
          position?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "list_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          created_at: string
          family_id: string
          group_label: string
          id: string
          is_pinned: boolean
          name: string
          position: number
        }
        Insert: {
          created_at?: string
          family_id: string
          group_label?: string
          id?: string
          is_pinned?: boolean
          name: string
          position?: number
        }
        Update: {
          created_at?: string
          family_id?: string
          group_label?: string
          id?: string
          is_pinned?: boolean
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "lists_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      nurseries: {
        Row: {
          address: string | null
          checklist: Json
          family_id: string
          id: string
          memo: string | null
          name: string
          phone: string | null
          status: string
          visit_date: string | null
          visit_time: string | null
        }
        Insert: {
          address?: string | null
          checklist?: Json
          family_id: string
          id?: string
          memo?: string | null
          name: string
          phone?: string | null
          status?: string
          visit_date?: string | null
          visit_time?: string | null
        }
        Update: {
          address?: string | null
          checklist?: Json
          family_id?: string
          id?: string
          memo?: string | null
          name?: string
          phone?: string | null
          status?: string
          visit_date?: string | null
          visit_time?: string | null
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
      nursing_alarms: {
        Row: {
          baseline_at: string
          interval_minutes: number
          notified_step: number
          side: string
          stopped_at: string | null
          subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          baseline_at: string
          interval_minutes: number
          notified_step?: number
          side: string
          stopped_at?: string | null
          subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          baseline_at?: string
          interval_minutes?: number
          notified_step?: number
          side?: string
          stopped_at?: string | null
          subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nursing_alarms_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nursing_alarms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          family_id: string
          id: string
          kind: string
          last_success_at: string | null
          p256dh: string
          user_agent: string
          user_id: string
        }
        Insert: {
          auth?: string
          created_at?: string
          endpoint: string
          failure_count?: number
          family_id: string
          id?: string
          kind?: string
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          family_id?: string
          id?: string
          kind?: string
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_deliveries: {
        Row: {
          error: string | null
          id: string
          scheduled_for: string
          sent_at: string
          status: string
          subscription_id: string
          task_id: string
        }
        Insert: {
          error?: string | null
          id?: string
          scheduled_for: string
          sent_at?: string
          status?: string
          subscription_id: string
          task_id: string
        }
        Update: {
          error?: string | null
          id?: string
          scheduled_for?: string
          sent_at?: string
          status?: string
          subscription_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_deliveries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_reminder_schedule"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "reminder_deliveries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          anchor_type: string
          belongings: string | null
          category: string
          created_at: string
          days_after_birth: number
          end_time: string | null
          family_id: string
          has_notification: boolean
          id: string
          is_done: boolean
          kind: string
          note: string | null
          participants: string[]
          place: string | null
          remind_minutes_before: number | null
          start_date: string | null
          start_time: string | null
          timing_memo: string | null
          title: string
          updated_at: string
        }
        Insert: {
          anchor_type?: string
          belongings?: string | null
          category?: string
          created_at?: string
          days_after_birth?: number
          end_time?: string | null
          family_id: string
          has_notification?: boolean
          id?: string
          is_done?: boolean
          kind?: string
          note?: string | null
          participants?: string[]
          place?: string | null
          remind_minutes_before?: number | null
          start_date?: string | null
          start_time?: string | null
          timing_memo?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          anchor_type?: string
          belongings?: string | null
          category?: string
          created_at?: string
          days_after_birth?: number
          end_time?: string | null
          family_id?: string
          has_notification?: boolean
          id?: string
          is_done?: boolean
          kind?: string
          note?: string | null
          participants?: string[]
          place?: string | null
          remind_minutes_before?: number | null
          start_date?: string | null
          start_time?: string | null
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
      temperature_reminder_deliveries: {
        Row: {
          error: string | null
          family_id: string
          id: string
          scheduled_for: string
          sent_at: string
          status: string
          subscription_id: string
        }
        Insert: {
          error?: string | null
          family_id: string
          id?: string
          scheduled_for: string
          sent_at?: string
          status?: string
          subscription_id: string
        }
        Update: {
          error?: string | null
          family_id?: string
          id?: string
          scheduled_for?: string
          sent_at?: string
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "temperature_reminder_deliveries_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temperature_reminder_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      temperature_reminder_settings: {
        Row: {
          enabled: boolean
          evening_time: string
          family_id: string
          morning_time: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          evening_time?: string
          family_id: string
          morning_time?: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          evening_time?: string
          family_id?: string
          morning_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "temperature_reminder_settings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
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
      next_feeding_schedule: {
        Row: {
          care_log_id: string | null
          due_at: string | null
          family_id: string | null
          interval_minutes: number | null
          last_fed_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_logs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminder_schedule: {
        Row: {
          category: string | null
          family_id: string | null
          place: string | null
          remind_at: string | null
          remind_minutes_before: number | null
          start_time: string | null
          starts_at: string | null
          target_date: string | null
          task_id: string | null
          title: string | null
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
      temperature_reminder_schedule: {
        Row: {
          family_id: string | null
          scheduled_for: string | null
          slot: string | null
        }
        Relationships: [
          {
            foreignKeyName: "temperature_reminder_settings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_family_id: { Args: never; Returns: string }
      family_birth_date: { Args: { p_family_id: string }; Returns: string }
      increment_push_failure: {
        Args: { p_subscription_id: string }
        Returns: undefined
      }
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

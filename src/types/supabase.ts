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
          member_id: string | null
          name: string | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          family_id: string
          id?: string
          member_id?: string | null
          name?: string | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          family_id?: string
          id?: string
          member_id?: string | null
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
          {
            foreignKeyName: "children_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "family_members"
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
          address: string
          created_at: string
          home_phone: string
          id: string
          name: string
          postal_code: string
          stock_carry_days: number
          stock_days: number
          stock_people: number
          updated_at: string
        }
        Insert: {
          address?: string
          created_at?: string
          home_phone?: string
          id?: string
          name?: string
          postal_code?: string
          stock_carry_days?: number
          stock_days?: number
          stock_people?: number
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          home_phone?: string
          id?: string
          name?: string
          postal_code?: string
          stock_carry_days?: number
          stock_days?: number
          stock_people?: number
          updated_at?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          birth_date: string | null
          color: string
          created_at: string
          display_name: string
          email: string
          family_id: string
          family_name: string
          family_name_kana: string
          given_name: string
          given_name_kana: string
          id: string
          is_guardian: boolean
          phone: string
          relation: string
          sort_order: number
          updated_at: string
          user_id: string | null
          workplace: string
          workplace_phone: string
        }
        Insert: {
          birth_date?: string | null
          color?: string
          created_at?: string
          display_name: string
          email?: string
          family_id: string
          family_name?: string
          family_name_kana?: string
          given_name?: string
          given_name_kana?: string
          id?: string
          is_guardian?: boolean
          phone?: string
          relation: string
          sort_order?: number
          updated_at?: string
          user_id?: string | null
          workplace?: string
          workplace_phone?: string
        }
        Update: {
          birth_date?: string | null
          color?: string
          created_at?: string
          display_name?: string
          email?: string
          family_id?: string
          family_name?: string
          family_name_kana?: string
          given_name?: string
          given_name_kana?: string
          id?: string
          is_guardian?: boolean
          phone?: string
          relation?: string
          sort_order?: number
          updated_at?: string
          user_id?: string | null
          workplace?: string
          workplace_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      family_sync: {
        Row: {
          changed: Json
          family_id: string
          updated_at: string
        }
        Insert: {
          changed?: Json
          family_id: string
          updated_at?: string
        }
        Update: {
          changed?: Json
          family_id?: string
          updated_at?: string
        }
        Relationships: []
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
      household_product_categories: {
        Row: {
          created_at: string
          family_id: string
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_product_categories_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      household_products: {
        Row: {
          category: string
          created_at: string
          family_id: string
          id: string
          last_added_at: string | null
          money_category_id: string | null
          name: string
          note: string
          price: number | null
          store: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          family_id: string
          id?: string
          last_added_at?: string | null
          money_category_id?: string | null
          name: string
          note?: string
          price?: number | null
          store?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          family_id?: string
          id?: string
          last_added_at?: string | null
          money_category_id?: string | null
          name?: string
          note?: string
          price?: number | null
          store?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_products_money_category_id_fkey"
            columns: ["money_category_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_products_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
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
          created_by: string | null
          family_id: string
          group_label: string
          id: string
          is_pinned: boolean
          is_private: boolean
          name: string
          position: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          family_id: string
          group_label?: string
          id?: string
          is_pinned?: boolean
          is_private?: boolean
          name: string
          position?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          family_id?: string
          group_label?: string
          id?: string
          is_pinned?: boolean
          is_private?: boolean
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lists_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      lottery_coupons: {
        Row: {
          cycle: number | null
          expires_at: string | null
          family_id: string
          id: string
          is_test: boolean
          kind: string
          obtained_at: string
          owner_id: string
          slot: number | null
          source_draw_id: string | null
          used_at: string | null
          used_draw_id: string | null
        }
        Insert: {
          cycle?: number | null
          expires_at?: string | null
          family_id: string
          id?: string
          is_test?: boolean
          kind: string
          obtained_at?: string
          owner_id: string
          slot?: number | null
          source_draw_id?: string | null
          used_at?: string | null
          used_draw_id?: string | null
        }
        Update: {
          cycle?: number | null
          expires_at?: string | null
          family_id?: string
          id?: string
          is_test?: boolean
          kind?: string
          obtained_at?: string
          owner_id?: string
          slot?: number | null
          source_draw_id?: string | null
          used_at?: string | null
          used_draw_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lottery_coupons_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lottery_coupons_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lottery_coupons_source_draw_id_fkey"
            columns: ["source_draw_id"]
            isOneToOne: false
            referencedRelation: "subsidy_draws"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lottery_coupons_used_draw_id_fkey"
            columns: ["used_draw_id"]
            isOneToOne: false
            referencedRelation: "subsidy_draws"
            referencedColumns: ["id"]
          },
        ]
      }
      member_invites: {
        Row: {
          code_hash: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          member_id: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          member_id: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          member_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_invites_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      money_budgets: {
        Row: {
          category_id: string
          created_at: string
          family_id: string
          fiscal_year: number
          id: string
          monthly_amount: number
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          family_id: string
          fiscal_year: number
          id?: string
          monthly_amount?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          family_id?: string
          fiscal_year?: number
          id?: string
          monthly_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_budgets_category_fkey"
            columns: ["category_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_categories: {
        Row: {
          archived_at: string | null
          created_at: string
          family_id: string
          icon: string | null
          icon_color: string | null
          id: string
          kind: string
          name: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          family_id: string
          icon?: string | null
          icon_color?: string | null
          id?: string
          kind?: string
          name: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          family_id?: string
          icon?: string | null
          icon_color?: string | null
          id?: string
          kind?: string
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_categories_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_categories_parent_fkey"
            columns: ["parent_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_fx_rates: {
        Row: {
          created_at: string
          currency: string
          rate: number
          rate_on: string
        }
        Insert: {
          created_at?: string
          currency: string
          rate: number
          rate_on: string
        }
        Update: {
          created_at?: string
          currency?: string
          rate?: number
          rate_on?: string
        }
        Relationships: []
      }
      money_holding_values: {
        Row: {
          cost: number | null
          created_at: string
          family_id: string
          fx: number
          holding_id: string
          price: number
          quantity: number
          value: number
          value_on: string
        }
        Insert: {
          cost?: number | null
          created_at?: string
          family_id: string
          fx: number
          holding_id: string
          price: number
          quantity: number
          value: number
          value_on: string
        }
        Update: {
          cost?: number | null
          created_at?: string
          family_id?: string
          fx?: number
          holding_id?: string
          price?: number
          quantity?: number
          value?: number
          value_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_holding_values_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_holding_values_holding_fkey"
            columns: ["holding_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_holdings"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_holdings: {
        Row: {
          account: string
          archived_at: string | null
          cost_price: number | null
          created_at: string
          family_id: string
          id: string
          quantity: number
          security_id: string
          updated_at: string
          wallet_id: string
        }
        Insert: {
          account?: string
          archived_at?: string | null
          cost_price?: number | null
          created_at?: string
          family_id: string
          id?: string
          quantity?: number
          security_id: string
          updated_at?: string
          wallet_id: string
        }
        Update: {
          account?: string
          archived_at?: string | null
          cost_price?: number | null
          created_at?: string
          family_id?: string
          id?: string
          quantity?: number
          security_id?: string
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_holdings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_holdings_security_fkey"
            columns: ["security_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_securities"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_holdings_wallet_fkey"
            columns: ["wallet_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_wallets"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_items: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          family_id: string
          id: string
          memo: string
          name: string
          position: number
          product_id: string | null
          quantity: number
          record_id: string
          special_item_id: string | null
          special_plan_id: string | null
          unit_price: number | null
        }
        Insert: {
          amount?: number
          category_id?: string | null
          created_at?: string
          family_id: string
          id?: string
          memo?: string
          name?: string
          position?: number
          product_id?: string | null
          quantity?: number
          record_id: string
          special_item_id?: string | null
          special_plan_id?: string | null
          unit_price?: number | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          family_id?: string
          id?: string
          memo?: string
          name?: string
          position?: number
          product_id?: string | null
          quantity?: number
          record_id?: string
          special_item_id?: string | null
          special_plan_id?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "money_items_category_fkey"
            columns: ["category_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "household_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_items_record_fkey"
            columns: ["record_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_records"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_items_special_item_fkey"
            columns: ["special_item_id", "family_id"]
            isOneToOne: false
            referencedRelation: "special_items"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_items_special_plan_id_fkey"
            columns: ["special_plan_id"]
            isOneToOne: false
            referencedRelation: "special_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      money_records: {
        Row: {
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          is_estimate: boolean
          kind: string
          month: string | null
          occurred_on: string
          recurring_id: string | null
          store: string
          to_wallet_id: string | null
          updated_at: string
          wallet_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          is_estimate?: boolean
          kind?: string
          month?: string | null
          occurred_on: string
          recurring_id?: string | null
          store?: string
          to_wallet_id?: string | null
          updated_at?: string
          wallet_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          is_estimate?: boolean
          kind?: string
          month?: string | null
          occurred_on?: string
          recurring_id?: string | null
          store?: string
          to_wallet_id?: string | null
          updated_at?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_records_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_records_recurring_fkey"
            columns: ["recurring_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_recurring"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_records_to_wallet_fkey"
            columns: ["to_wallet_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_wallets"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_records_wallet_fkey"
            columns: ["wallet_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_wallets"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_recurring: {
        Row: {
          amount: number
          amount_mode: string
          archived_at: string | null
          category_id: string | null
          created_at: string
          day: number
          family_id: string
          holiday: string
          id: string
          kind: string
          made_through: string | null
          months: number[] | null
          name: string
          position: number
          special_item_id: string | null
          store: string
          to_wallet_id: string | null
          updated_at: string
          wallet_id: string | null
        }
        Insert: {
          amount?: number
          amount_mode?: string
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          day: number
          family_id: string
          holiday?: string
          id?: string
          kind?: string
          made_through?: string | null
          months?: number[] | null
          name?: string
          position?: number
          special_item_id?: string | null
          store?: string
          to_wallet_id?: string | null
          updated_at?: string
          wallet_id?: string | null
        }
        Update: {
          amount?: number
          amount_mode?: string
          archived_at?: string | null
          category_id?: string | null
          created_at?: string
          day?: number
          family_id?: string
          holiday?: string
          id?: string
          kind?: string
          made_through?: string | null
          months?: number[] | null
          name?: string
          position?: number
          special_item_id?: string | null
          store?: string
          to_wallet_id?: string | null
          updated_at?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "money_recurring_category_fkey"
            columns: ["category_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_categories"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_recurring_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_recurring_special_item_fkey"
            columns: ["special_item_id", "family_id"]
            isOneToOne: false
            referencedRelation: "special_items"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_recurring_to_wallet_fkey"
            columns: ["to_wallet_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_wallets"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "money_recurring_wallet_fkey"
            columns: ["wallet_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_wallets"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_securities: {
        Row: {
          archived_at: string | null
          code: string | null
          created_at: string
          currency: string
          family_id: string
          fund_code: string | null
          id: string
          kind: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          currency?: string
          family_id: string
          fund_code?: string | null
          id?: string
          kind: string
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code?: string | null
          created_at?: string
          currency?: string
          family_id?: string
          fund_code?: string | null
          id?: string
          kind?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_securities_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      money_security_prices: {
        Row: {
          created_at: string
          family_id: string
          price: number
          price_on: string
          security_id: string
        }
        Insert: {
          created_at?: string
          family_id: string
          price: number
          price_on: string
          security_id: string
        }
        Update: {
          created_at?: string
          family_id?: string
          price?: number
          price_on?: string
          security_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_security_prices_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_security_prices_security_fkey"
            columns: ["security_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_securities"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_stores: {
        Row: {
          archived_at: string | null
          created_at: string
          family_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          family_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          family_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_stores_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      money_wallet_balances: {
        Row: {
          amount: number
          balance_on: string
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          show_in_history: boolean
          updated_at: string
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_on: string
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          show_in_history?: boolean
          updated_at?: string
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_on?: string
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          show_in_history?: boolean
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_wallet_balances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_wallet_balances_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_wallet_balances_wallet_fkey"
            columns: ["wallet_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_wallets"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      money_wallets: {
        Row: {
          archived_at: string | null
          card_made_through: string | null
          close_day: number | null
          created_at: string
          family_id: string
          icon_color: string | null
          id: string
          is_saving: boolean
          name: string
          pay_day: number | null
          pay_month_offset: number | null
          pay_wallet_id: string | null
          position: number
          saving_target: number | null
          type: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          card_made_through?: string | null
          close_day?: number | null
          created_at?: string
          family_id: string
          icon_color?: string | null
          id?: string
          is_saving?: boolean
          name: string
          pay_day?: number | null
          pay_month_offset?: number | null
          pay_wallet_id?: string | null
          position?: number
          saving_target?: number | null
          type?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          card_made_through?: string | null
          close_day?: number | null
          created_at?: string
          family_id?: string
          icon_color?: string | null
          id?: string
          is_saving?: boolean
          name?: string
          pay_day?: number | null
          pay_month_offset?: number | null
          pay_wallet_id?: string | null
          position?: number
          saving_target?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "money_wallets_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "money_wallets_pay_wallet_fkey"
            columns: ["pay_wallet_id", "family_id"]
            isOneToOne: false
            referencedRelation: "money_wallets"
            referencedColumns: ["id", "family_id"]
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
          feeding_quiet_end: number | null
          feeding_quiet_start: number | null
          id: string
          kind: string
          last_success_at: string | null
          p256dh: string
          user_agent: string
          user_id: string
          wake_alarm_enabled: boolean
          wake_quiet_end: number | null
          wake_quiet_start: number | null
          wake_synced_due_at: string | null
          wake_synced_trigger_at: string | null
        }
        Insert: {
          auth?: string
          created_at?: string
          endpoint: string
          failure_count?: number
          family_id: string
          feeding_quiet_end?: number | null
          feeding_quiet_start?: number | null
          id?: string
          kind?: string
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string
          user_id: string
          wake_alarm_enabled?: boolean
          wake_quiet_end?: number | null
          wake_quiet_start?: number | null
          wake_synced_due_at?: string | null
          wake_synced_trigger_at?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          family_id?: string
          feeding_quiet_end?: number | null
          feeding_quiet_start?: number | null
          id?: string
          kind?: string
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string
          user_id?: string
          wake_alarm_enabled?: boolean
          wake_quiet_end?: number | null
          wake_quiet_start?: number | null
          wake_synced_due_at?: string | null
          wake_synced_trigger_at?: string | null
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
      special_items: {
        Row: {
          base_year: number | null
          category: string
          created_at: string
          cycle_years: number
          family_id: string
          id: string
          kind: string
          name: string
          note: string
          position: number
          updated_at: string
        }
        Insert: {
          base_year?: number | null
          category?: string
          created_at?: string
          cycle_years?: number
          family_id: string
          id?: string
          kind?: string
          name: string
          note?: string
          position?: number
          updated_at?: string
        }
        Update: {
          base_year?: number | null
          category?: string
          created_at?: string
          cycle_years?: number
          family_id?: string
          id?: string
          kind?: string
          name?: string
          note?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "special_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      special_plans: {
        Row: {
          amount: number
          created_at: string
          family_id: string
          id: string
          item_id: string
          month: number | null
          tentative: boolean
        }
        Insert: {
          amount?: number
          created_at?: string
          family_id: string
          id?: string
          item_id: string
          month?: number | null
          tentative?: boolean
        }
        Update: {
          amount?: number
          created_at?: string
          family_id?: string
          id?: string
          item_id?: string
          month?: number | null
          tentative?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "special_plans_item_fkey"
            columns: ["item_id", "family_id"]
            isOneToOne: false
            referencedRelation: "special_items"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      stock_expiry_deliveries: {
        Row: {
          error: string | null
          family_id: string
          id: string
          notify_on: string
          sent_at: string
          status: string
          subscription_id: string
        }
        Insert: {
          error?: string | null
          family_id: string
          id?: string
          notify_on: string
          sent_at?: string
          status?: string
          subscription_id: string
        }
        Update: {
          error?: string | null
          family_id?: string
          id?: string
          notify_on?: string
          sent_at?: string
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_expiry_deliveries_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_expiry_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          amount_per_unit: number
          category: string
          created_at: string
          expires_month_only: boolean
          expires_on: string | null
          family_id: string
          id: string
          inspect_interval_months: number | null
          inspected_on: string | null
          name: string
          note: string
          position: number
          quantity: number
          storage: string
          target_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          amount_per_unit?: number
          category?: string
          created_at?: string
          expires_month_only?: boolean
          expires_on?: string | null
          family_id: string
          id?: string
          inspect_interval_months?: number | null
          inspected_on?: string | null
          name: string
          note?: string
          position?: number
          quantity?: number
          storage?: string
          target_id?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          amount_per_unit?: number
          category?: string
          created_at?: string
          expires_month_only?: boolean
          expires_on?: string | null
          family_id?: string
          id?: string
          inspect_interval_months?: number | null
          inspected_on?: string | null
          name?: string
          note?: string
          position?: number
          quantity?: number
          storage?: string
          target_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_items_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "stock_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_targets: {
        Row: {
          carry: boolean
          category: string
          created_at: string
          family_id: string
          id: string
          name: string
          note: string
          per_person_day: boolean
          position: number
          quantity: number
          unit: string
          updated_at: string
        }
        Insert: {
          carry?: boolean
          category?: string
          created_at?: string
          family_id: string
          id?: string
          name: string
          note?: string
          per_person_day?: boolean
          position?: number
          quantity?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          carry?: boolean
          category?: string
          created_at?: string
          family_id?: string
          id?: string
          name?: string
          note?: string
          per_person_day?: boolean
          position?: number
          quantity?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_targets_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      subsidy_draws: {
        Row: {
          ball: string
          drawn_at: string
          drawn_by: string | null
          family_id: string
          id: string
          is_test: boolean
          item_name: string
          price: number
          push_coupon_id: string | null
          rate: number
          rate_up_used: boolean
          subsidy: number
        }
        Insert: {
          ball: string
          drawn_at?: string
          drawn_by?: string | null
          family_id: string
          id?: string
          is_test?: boolean
          item_name?: string
          price: number
          push_coupon_id?: string | null
          rate: number
          rate_up_used?: boolean
          subsidy: number
        }
        Update: {
          ball?: string
          drawn_at?: string
          drawn_by?: string | null
          family_id?: string
          id?: string
          is_test?: boolean
          item_name?: string
          price?: number
          push_coupon_id?: string | null
          rate?: number
          rate_up_used?: boolean
          subsidy?: number
        }
        Relationships: [
          {
            foreignKeyName: "subsidy_draws_drawn_by_fkey"
            columns: ["drawn_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subsidy_draws_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          anchor_type: string
          done_dates: string[]
          belongings: string | null
          category: string
          created_at: string
          created_by: string | null
          days_after_birth: number
          end_time: string | null
          family_id: string
          has_notification: boolean
          id: string
          is_done: boolean
          is_private: boolean
          kind: string
          note: string | null
          owner: string | null
          participants: string[]
          place: string | null
          recurrence: Json | null
          remind_minutes_before: number | null
          start_date: string | null
          start_time: string | null
          timing_memo: string | null
          title: string
          updated_at: string
        }
        Insert: {
          anchor_type?: string
          done_dates?: string[]
          belongings?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          days_after_birth?: number
          end_time?: string | null
          family_id: string
          has_notification?: boolean
          id?: string
          is_done?: boolean
          is_private?: boolean
          kind?: string
          note?: string | null
          owner?: string | null
          participants?: string[]
          place?: string | null
          recurrence?: Json | null
          remind_minutes_before?: number | null
          start_date?: string | null
          start_time?: string | null
          timing_memo?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          anchor_type?: string
          done_dates?: string[]
          belongings?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          days_after_birth?: number
          end_time?: string | null
          family_id?: string
          has_notification?: boolean
          id?: string
          is_done?: boolean
          is_private?: boolean
          kind?: string
          note?: string | null
          owner?: string | null
          participants?: string[]
          place?: string | null
          recurrence?: Json | null
          remind_minutes_before?: number | null
          start_date?: string | null
          start_time?: string | null
          timing_memo?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
          show_care_tab: boolean
          start_tab: string
          workplace: string | null
        }
        Insert: {
          created_at?: string
          family_id?: string | null
          id: string
          name?: string | null
          role?: string | null
          show_care_tab?: boolean
          start_tab?: string
          workplace?: string | null
        }
        Update: {
          created_at?: string
          family_id?: string | null
          id?: string
          name?: string | null
          role?: string | null
          show_care_tab?: boolean
          start_tab?: string
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
      attach_family_sync: {
        Args: { p_resolver?: string; p_table: unknown }
        Returns: undefined
      }
      create_member_invite: { Args: { p_member_id: string }; Returns: string }
      create_my_family: { Args: { p_role: string }; Returns: string }
      current_family_id: { Args: never; Returns: string }
      family_birth_date: { Args: { p_family_id: string }; Returns: string }
      family_sync_missing: { Args: never; Returns: string[] }
      increment_push_failure: {
        Args: { p_subscription_id: string }
        Returns: undefined
      }
      is_family_guardian: { Args: never; Returns: boolean }
      jp_base_holiday_name: { Args: { p_date: string }; Returns: string }
      jp_holiday_name: { Args: { p_date: string }; Returns: string }
      lottery_delete_my_test_data: { Args: never; Returns: number }
      lottery_open_box: {
        Args: { p_draw_id: string }
        Returns: Database["public"]["Tables"]["lottery_coupons"]["Row"][]
      }
      lottery_use_coupon: {
        Args: { p_coupon_id: string }
        Returns: Database["public"]["Tables"]["lottery_coupons"]["Row"]
      }
      lottery_use_rate_up: {
        Args: { p_draw_id: string; p_coupon_id: string }
        Returns: Database["public"]["Tables"]["subsidy_draws"]["Row"]
      }
      make_money_recurring_records: {
        Args: { p_today?: string }
        Returns: number
      }
      money_bootstrap: { Args: { p_family_id: string }; Returns: Json }
      money_day_of_month: {
        Args: { p_day: number; p_month: string }
        Returns: string
      }
      money_is_business_day: { Args: { p_date: string }; Returns: boolean }
      money_latest_holding_values: {
        Args: { p_family_id: string }
        Returns: {
          cost: number | null
          created_at: string
          family_id: string
          fx: number
          holding_id: string
          price: number
          quantity: number
          value: number
          value_on: string
        }[]
        SetofOptions: {
          from: "*"
          to: "money_holding_values"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      money_recurring_estimate: {
        Args: {
          p_month: string
          p_on: string
          p_rule: Database["public"]["Tables"]["money_recurring"]["Row"]
        }
        Returns: number
      }
      money_shift_business_day: {
        Args: { p_date: string; p_holiday: string }
        Returns: string
      }
      redeem_member_invite: { Args: { p_code: string }; Returns: string }
      refresh_money_holding_values: {
        Args: { p_from: string; p_holding_id?: string; p_to: string }
        Returns: number
      }
      save_money_record: {
        Args: { p_items: Json; p_record: Json }
        Returns: string
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

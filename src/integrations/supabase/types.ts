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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      catalog_requests: {
        Row: {
          actor_id: string
          created_at: string
          payload: Json
          request_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          payload: Json
          request_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          payload?: Json
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          amount: number
          deposited_at: string
          id: string
          note: string
          salesman_id: string
          settlement_id: string | null
        }
        Insert: {
          amount: number
          deposited_at?: string
          id?: string
          note?: string
          salesman_id: string
          settlement_id?: string | null
        }
        Update: {
          amount?: number
          deposited_at?: string
          id?: string
          note?: string
          salesman_id?: string
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposits_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      imei_units: {
        Row: {
          created_at: string
          current_salesman: string | null
          id: string
          imei: string
          is_damaged: boolean
          issued_at: string | null
          product_id: string
          returned_at: string | null
          sold_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          current_salesman?: string | null
          id?: string
          imei: string
          is_damaged?: boolean
          issued_at?: string | null
          product_id: string
          returned_at?: string | null
          sold_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          current_salesman?: string | null
          id?: string
          imei?: string
          is_damaged?: boolean
          issued_at?: string | null
          product_id?: string
          returned_at?: string | null
          sold_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "imei_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      posting_requests: {
        Row: {
          actor_id: string
          created_at: string
          kind: string
          payload: Json
          request_id: string
          result_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          kind: string
          payload: Json
          request_id: string
          result_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          kind?: string
          payload?: Json
          request_id?: string
          result_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          model: string
          name: string
          price: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_active?: boolean
          model?: string
          name: string
          price?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          model?: string
          name?: string
          price?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          is_active?: boolean
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      retailer_payments: {
        Row: {
          amount: number
          id: string
          note: string
          paid_at: string
          retailer_id: string
          salesman_id: string
        }
        Insert: {
          amount: number
          id?: string
          note?: string
          paid_at?: string
          retailer_id: string
          salesman_id: string
        }
        Update: {
          amount?: number
          id?: string
          note?: string
          paid_at?: string
          retailer_id?: string
          salesman_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retailer_payments_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retailer_payments_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retailers: {
        Row: {
          address: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string
        }
        Insert: {
          address?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string
        }
        Relationships: []
      }
      returns: {
        Row: {
          id: string
          imei_unit_id: string | null
          is_damaged: boolean
          product_id: string
          quantity: number
          returned_at: string
          salesman_id: string
          settlement_id: string | null
        }
        Insert: {
          id?: string
          imei_unit_id?: string | null
          is_damaged?: boolean
          product_id: string
          quantity?: number
          returned_at?: string
          salesman_id: string
          settlement_id?: string | null
        }
        Update: {
          id?: string
          imei_unit_id?: string | null
          is_damaged?: boolean
          product_id?: string
          quantity?: number
          returned_at?: string
          salesman_id?: string
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_imei_unit_id_fkey"
            columns: ["imei_unit_id"]
            isOneToOne: false
            referencedRelation: "imei_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          imei_unit_id: string | null
          product_id: string
          quantity: number
          sale_id: string
          unit_price: number
        }
        Insert: {
          id?: string
          imei_unit_id?: string | null
          product_id: string
          quantity?: number
          sale_id: string
          unit_price?: number
        }
        Update: {
          id?: string
          imei_unit_id?: string | null
          product_id?: string
          quantity?: number
          sale_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_imei_unit_id_fkey"
            columns: ["imei_unit_id"]
            isOneToOne: false
            referencedRelation: "imei_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          id: string
          note: string
          paid_amount: number
          retailer_id: string
          salesman_id: string
          sold_at: string
          total_amount: number
        }
        Insert: {
          id?: string
          note?: string
          paid_amount?: number
          retailer_id: string
          salesman_id: string
          sold_at?: string
          total_amount?: number
        }
        Update: {
          id?: string
          note?: string
          paid_amount?: number
          retailer_id?: string
          salesman_id?: string
          sold_at?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          created_at: string
          id: string
          note: string
          salesman_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string
          salesman_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          salesman_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_issue_items: {
        Row: {
          id: string
          imei_unit_id: string | null
          issue_id: string
          product_id: string
          quantity: number
        }
        Insert: {
          id?: string
          imei_unit_id?: string | null
          issue_id: string
          product_id: string
          quantity?: number
        }
        Update: {
          id?: string
          imei_unit_id?: string | null
          issue_id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_issue_items_imei_unit_id_fkey"
            columns: ["imei_unit_id"]
            isOneToOne: false
            referencedRelation: "imei_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issue_items_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "stock_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_issues: {
        Row: {
          id: string
          issued_at: string
          issued_by: string
          note: string
          salesman_id: string
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by: string
          note?: string
          salesman_id: string
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string
          note?: string
          salesman_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_issues_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_issues_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accounting_snapshot: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_staff: { Args: { _uid: string }; Returns: boolean }
      issue_imei: {
        Args: { p_imei: string; p_issue_id: string }
        Returns: string
      }
      post_catalog: {
        Args: { p_payload: Json; p_request_id: string }
        Returns: undefined
      }
      post_transaction: {
        Args: { p_kind: string; p_payload: Json; p_request_id: string }
        Returns: string
      }
      require_active_account: { Args: never; Returns: string }
      return_imei: {
        Args: { p_imei: string; p_return_id: string }
        Returns: string
      }
      sell_imei: {
        Args: { p_imei: string; p_sale_id: string }
        Returns: string
      }
      set_sr_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "salesman"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "salesman"],
    },
  },
} as const

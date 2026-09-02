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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      brands: {
        Row: {
          banner_url: string | null
          brand_type: Database["public"]["Enums"]["brand_type"]
          created_at: string
          created_by: string | null
          description: string | null
          featured: boolean
          id: string
          logo_url: string | null
          name: string
          short_description: string | null
          slug: string
          sort_order: number
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
          visibility: Database["public"]["Enums"]["entity_visibility"]
          website: string | null
        }
        Insert: {
          banner_url?: string | null
          brand_type?: Database["public"]["Enums"]["brand_type"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          logo_url?: string | null
          name: string
          short_description?: string | null
          slug: string
          sort_order?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["entity_visibility"]
          website?: string | null
        }
        Update: {
          banner_url?: string | null
          brand_type?: Database["public"]["Enums"]["brand_type"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          logo_url?: string | null
          name?: string
          short_description?: string | null
          slug?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["entity_visibility"]
          website?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          banner_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          featured: boolean
          id: string
          name: string
          parent_id: string | null
          short_description: string | null
          slug: string
          sort_order: number
          status: Database["public"]["Enums"]["entity_status"]
          thumbnail_url: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["entity_visibility"]
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          name: string
          parent_id?: string | null
          short_description?: string | null
          slug: string
          sort_order?: number
          status?: Database["public"]["Enums"]["entity_status"]
          thumbnail_url?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["entity_visibility"]
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          name?: string
          parent_id?: string | null
          short_description?: string | null
          slug?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["entity_status"]
          thumbnail_url?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["entity_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          is_primary: boolean
          product_id: string
          sort_order: number
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          is_primary: boolean
          product_id: string
          sort_order: number
          url: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
          url: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_relationships: {
        Row: {
          created_at: string
          id: string
          product_id: string
          related_product_id: string
          relationship_type: Database["public"]["Enums"]["product_relationship_type"]
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          related_product_id: string
          relationship_type?: Database["public"]["Enums"]["product_relationship_type"]
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          related_product_id?: string
          relationship_type?: Database["public"]["Enums"]["product_relationship_type"]
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_relationships_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relationships_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          compare_at_price: number | null
          created_at: string
          id: string
          price: number | null
          product_id: string
          sku: string | null
          sort_order: number
          status: Database["public"]["Enums"]["variant_status"]
          title: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          compare_at_price?: number | null
          created_at?: string
          id?: string
          price?: number | null
          product_id: string
          sku?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["variant_status"]
          title: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          compare_at_price?: number | null
          created_at?: string
          id?: string
          price?: number | null
          product_id?: string
          sku?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["variant_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          compare_at_price: number | null
          created_at: string
          created_by: string | null
          description: string | null
          featured: boolean
          id: string
          name: string
          price: number
          product_type: Database["public"]["Enums"]["product_type"]
          short_description: string | null
          sku: string | null
          slug: string
          status: Database["public"]["Enums"]["product_status"]
          supply_model: Database["public"]["Enums"]["supply_model"]
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["entity_visibility"]
        }
        Insert: {
          brand_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          name: string
          price?: number
          product_type?: Database["public"]["Enums"]["product_type"]
          short_description?: string | null
          sku?: string | null
          slug: string
          status?: Database["public"]["Enums"]["product_status"]
          supply_model?: Database["public"]["Enums"]["supply_model"]
          updated_at?: string
          updated_by?: string | null
          visibility?: Database["public"]["Enums"]["entity_visibility"]
        }
        Update: {
          brand_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          name?: string
          price?: number
          product_type?: Database["public"]["Enums"]["product_type"]
          short_description?: string | null
          sku?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["product_status"]
          supply_model?: Database["public"]["Enums"]["supply_model"]
          updated_at?: string
          updated_by?: string | null
          visibility?: Database["public"]["Enums"]["entity_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
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
      brand_product_counts: {
        Args: never
        Returns: {
          brand_id: string
          product_count: number
        }[]
      }
      can_manage_commerce: { Args: { _user_id: string }; Returns: boolean }
      can_read_commerce: { Args: { _user_id: string }; Returns: boolean }
      category_product_counts: {
        Args: never
        Returns: {
          category_id: string
          product_count: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "owner" | "admin" | "staff" | "viewer"
      brand_type: "standard" | "own_brand" | "generic"
      entity_status: "active" | "inactive" | "archived"
      entity_visibility: "visible" | "hidden"
      product_relationship_type:
        | "related"
        | "upsell"
        | "cross_sell"
        | "bundle_item"
      product_status: "draft" | "active" | "inactive" | "archived"
      product_type: "simple" | "variable" | "bundle" | "service" | "digital"
      supply_model: "in_stock" | "local_sourcing" | "preorder"
      variant_status: "active" | "inactive"
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
      app_role: ["owner", "admin", "staff", "viewer"],
      brand_type: ["standard", "own_brand", "generic"],
      entity_status: ["active", "inactive", "archived"],
      entity_visibility: ["visible", "hidden"],
      product_relationship_type: [
        "related",
        "upsell",
        "cross_sell",
        "bundle_item",
      ],
      product_status: ["draft", "active", "inactive", "archived"],
      product_type: ["simple", "variable", "bundle", "service", "digital"],
      supply_model: ["in_stock", "local_sourcing", "preorder"],
      variant_status: ["active", "inactive"],
    },
  },
} as const

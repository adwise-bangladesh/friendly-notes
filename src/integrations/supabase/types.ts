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
      bundle_items: {
        Row: {
          bundle_product_id: string
          created_at: string
          id: string
          product_id: string | null
          quantity: number
          sort_order: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          bundle_product_id: string
          created_at?: string
          id?: string
          product_id?: string | null
          quantity?: number
          sort_order?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          bundle_product_id?: string
          created_at?: string
          id?: string
          product_id?: string | null
          quantity?: number
          sort_order?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bundle_items_bundle_product_id_fkey"
            columns: ["bundle_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
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
      courier_account_credentials: {
        Row: {
          access_token: string | null
          account_id: string
          client_id: string | null
          client_secret: string | null
          created_at: string
          password: string | null
          refresh_token: string | null
          token_expires_at: string | null
          token_refreshed_at: string | null
          updated_at: string
          username: string | null
          webhook_secret: string | null
        }
        Insert: {
          access_token?: string | null
          account_id: string
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          password?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          token_refreshed_at?: string | null
          updated_at?: string
          username?: string | null
          webhook_secret?: string | null
        }
        Update: {
          access_token?: string | null
          account_id?: string
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          password?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          token_refreshed_at?: string | null
          updated_at?: string
          username?: string | null
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_account_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "courier_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_accounts: {
        Row: {
          base_url: string | null
          code: string
          created_at: string
          created_by: string | null
          environment: Database["public"]["Enums"]["courier_environment"]
          external_store_id: string | null
          id: string
          is_default: boolean
          name: string
          provider_id: string
          settings: Json
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_url?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          environment?: Database["public"]["Enums"]["courier_environment"]
          external_store_id?: string | null
          id?: string
          is_default?: boolean
          name: string
          provider_id: string
          settings?: Json
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_url?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          environment?: Database["public"]["Enums"]["courier_environment"]
          external_store_id?: string | null
          id?: string
          is_default?: boolean
          name?: string
          provider_id?: string
          settings?: Json
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_accounts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_api_logs: {
        Row: {
          account_id: string | null
          created_at: string
          error_category: string | null
          id: string
          operation: string
          provider_id: string | null
          retryable: boolean
          safe_message: string | null
          shipment_id: string | null
          status_code: number | null
          succeeded: boolean
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          error_category?: string | null
          id?: string
          operation: string
          provider_id?: string | null
          retryable?: boolean
          safe_message?: string | null
          shipment_id?: string | null
          status_code?: number | null
          succeeded: boolean
        }
        Update: {
          account_id?: string | null
          created_at?: string
          error_category?: string | null
          id?: string
          operation?: string
          provider_id?: string | null
          retryable?: boolean
          safe_message?: string | null
          shipment_id?: string | null
          status_code?: number | null
          succeeded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "courier_api_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "courier_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_api_logs_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_api_logs_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_locations: {
        Row: {
          external_id: string
          id: string
          kind: string
          name: string
          parent_external_id: string | null
          provider_id: string
          refreshed_at: string
        }
        Insert: {
          external_id: string
          id?: string
          kind: string
          name: string
          parent_external_id?: string | null
          provider_id: string
          refreshed_at?: string
        }
        Update: {
          external_id?: string
          id?: string
          kind?: string
          name?: string
          parent_external_id?: string | null
          provider_id?: string
          refreshed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_locations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_provider_events: {
        Row: {
          account_id: string | null
          consignment_id: string | null
          fingerprint: string
          id: string
          merchant_order_id: string | null
          payload: Json | null
          processing_note: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event: string | null
          provider_event_at: string | null
          provider_id: string | null
          provider_status: string | null
          received_at: string
          shipment_id: string | null
          source: string
        }
        Insert: {
          account_id?: string | null
          consignment_id?: string | null
          fingerprint: string
          id?: string
          merchant_order_id?: string | null
          payload?: Json | null
          processing_note?: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event?: string | null
          provider_event_at?: string | null
          provider_id?: string | null
          provider_status?: string | null
          received_at?: string
          shipment_id?: string | null
          source?: string
        }
        Update: {
          account_id?: string | null
          consignment_id?: string | null
          fingerprint?: string
          id?: string
          merchant_order_id?: string | null
          payload?: Json | null
          processing_note?: string | null
          processing_status?: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event?: string | null
          provider_event_at?: string | null
          provider_id?: string | null
          provider_status?: string | null
          received_at?: string
          shipment_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_provider_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "courier_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_provider_events_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_provider_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_providers: {
        Row: {
          code: string
          config_schema: Json | null
          created_at: string
          description: string | null
          id: string
          name: string
          service_types: Database["public"]["Enums"]["courier_service_type"][]
          sort_order: number
          status: Database["public"]["Enums"]["courier_provider_status"]
          supports_cod: boolean
          supports_pickup: boolean
          supports_return: boolean
          supports_tracking: boolean
          updated_at: string
        }
        Insert: {
          code: string
          config_schema?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          service_types?: Database["public"]["Enums"]["courier_service_type"][]
          sort_order?: number
          status?: Database["public"]["Enums"]["courier_provider_status"]
          supports_cod?: boolean
          supports_pickup?: boolean
          supports_return?: boolean
          supports_tracking?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          config_schema?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          service_types?: Database["public"]["Enums"]["courier_service_type"][]
          sort_order?: number
          status?: Database["public"]["Enums"]["courier_provider_status"]
          supports_cod?: boolean
          supports_pickup?: boolean
          supports_return?: boolean
          supports_tracking?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      courier_status_map: {
        Row: {
          created_at: string
          description: string | null
          event_type: Database["public"]["Enums"]["shipment_event_type"]
          id: string
          provider_event: string
          provider_id: string
          shipment_status: Database["public"]["Enums"]["shipment_status"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_type?: Database["public"]["Enums"]["shipment_event_type"]
          id?: string
          provider_event: string
          provider_id: string
          shipment_status?:
            | Database["public"]["Enums"]["shipment_status"]
            | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          event_type?: Database["public"]["Enums"]["shipment_event_type"]
          id?: string
          provider_event?: string
          provider_id?: string
          shipment_status?:
            | Database["public"]["Enums"]["shipment_status"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_status_map_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      group_buy_campaigns: {
        Row: {
          campaign_price: number | null
          created_at: string
          created_by: string | null
          current_quantity: number
          ends_at: string
          expected_delivery_end: string | null
          expected_delivery_start: string | null
          id: string
          minimum_quantity: number
          product_id: string
          starts_at: string
          status: Database["public"]["Enums"]["group_buy_status"]
          target_quantity: number | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_price?: number | null
          created_at?: string
          created_by?: string | null
          current_quantity?: number
          ends_at: string
          expected_delivery_end?: string | null
          expected_delivery_start?: string | null
          id?: string
          minimum_quantity?: number
          product_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["group_buy_status"]
          target_quantity?: number | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_price?: number | null
          created_at?: string
          created_by?: string | null
          current_quantity?: number
          ends_at?: string
          expected_delivery_end?: string | null
          expected_delivery_start?: string | null
          id?: string
          minimum_quantity?: number
          product_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["group_buy_status"]
          target_quantity?: number | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_buy_campaigns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_levels: {
        Row: {
          available_quantity: number | null
          created_at: string
          created_by: string | null
          damaged: number
          id: string
          incoming: number
          location_id: string
          low_stock_threshold: number | null
          on_hand: number
          product_id: string | null
          reserved: number
          updated_at: string
          updated_by: string | null
          variant_id: string | null
        }
        Insert: {
          available_quantity?: number | null
          created_at?: string
          created_by?: string | null
          damaged?: number
          id?: string
          incoming?: number
          location_id: string
          low_stock_threshold?: number | null
          on_hand?: number
          product_id?: string | null
          reserved?: number
          updated_at?: string
          updated_by?: string | null
          variant_id?: string | null
        }
        Update: {
          available_quantity?: number | null
          created_at?: string
          created_by?: string | null
          damaged?: number
          id?: string
          incoming?: number
          location_id?: string
          low_stock_threshold?: number | null
          on_hand?: number
          product_id?: string | null
          reserved?: number
          updated_at?: string
          updated_by?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          name: string
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inventory_level_id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_level_id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string | null
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_level_id?: string
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_inventory_level_id_fkey"
            columns: ["inventory_level_id"]
            isOneToOne: false
            referencedRelation: "inventory_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_reservations: {
        Row: {
          committed_at: string | null
          committed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          inventory_level_id: string
          location_id: string
          order_id: string
          order_item_id: string
          product_id: string | null
          quantity: number
          released_at: string | null
          released_by: string | null
          status: Database["public"]["Enums"]["reservation_record_status"]
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_level_id: string
          location_id: string
          order_id: string
          order_item_id: string
          product_id?: string | null
          quantity: number
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["reservation_record_status"]
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_level_id?: string
          location_id?: string
          order_id?: string
          order_item_id?: string
          product_id?: string | null
          quantity?: number
          released_at?: string | null
          released_by?: string | null
          status?: Database["public"]["Enums"]["reservation_record_status"]
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservations_inventory_level_id_fkey"
            columns: ["inventory_level_id"]
            isOneToOne: false
            referencedRelation: "inventory_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_addresses: {
        Row: {
          address_line: string
          address_type: string
          area: string | null
          country: string
          created_at: string
          district: string | null
          division: string | null
          id: string
          order_id: string
          phone: string
          postal_code: string | null
          recipient_name: string
          updated_at: string
        }
        Insert: {
          address_line: string
          address_type?: string
          area?: string | null
          country?: string
          created_at?: string
          district?: string | null
          division?: string | null
          id?: string
          order_id: string
          phone: string
          postal_code?: string | null
          recipient_name: string
          updated_at?: string
        }
        Update: {
          address_line?: string
          address_type?: string
          area?: string | null
          country?: string
          created_at?: string
          district?: string | null
          division?: string | null
          id?: string
          order_id?: string
          phone?: string
          postal_code?: string | null
          recipient_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_addresses_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_fulfillment_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["fulfillment_event_type"]
          from_status:
            | Database["public"]["Enums"]["fulfillment_record_status"]
            | null
          fulfillment_id: string
          id: string
          message: string
          metadata: Json | null
          order_id: string
          to_status:
            | Database["public"]["Enums"]["fulfillment_record_status"]
            | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["fulfillment_event_type"]
          from_status?:
            | Database["public"]["Enums"]["fulfillment_record_status"]
            | null
          fulfillment_id: string
          id?: string
          message: string
          metadata?: Json | null
          order_id: string
          to_status?:
            | Database["public"]["Enums"]["fulfillment_record_status"]
            | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["fulfillment_event_type"]
          from_status?:
            | Database["public"]["Enums"]["fulfillment_record_status"]
            | null
          fulfillment_id?: string
          id?: string
          message?: string
          metadata?: Json | null
          order_id?: string
          to_status?:
            | Database["public"]["Enums"]["fulfillment_record_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "order_fulfillment_events_fulfillment_id_fkey"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "order_fulfillments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_fulfillment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_fulfillment_items: {
        Row: {
          created_at: string
          fulfillment_id: string
          id: string
          order_item_id: string
          packed_quantity: number
          picked_quantity: number
          qc_note: string | null
          qc_status: Database["public"]["Enums"]["fulfillment_qc_status"]
          quantity: number
          shortage_reason:
            | Database["public"]["Enums"]["fulfillment_shortage_reason"]
            | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fulfillment_id: string
          id?: string
          order_item_id: string
          packed_quantity?: number
          picked_quantity?: number
          qc_note?: string | null
          qc_status?: Database["public"]["Enums"]["fulfillment_qc_status"]
          quantity: number
          shortage_reason?:
            | Database["public"]["Enums"]["fulfillment_shortage_reason"]
            | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fulfillment_id?: string
          id?: string
          order_item_id?: string
          packed_quantity?: number
          picked_quantity?: number
          qc_note?: string | null
          qc_status?: Database["public"]["Enums"]["fulfillment_qc_status"]
          quantity?: number
          shortage_reason?:
            | Database["public"]["Enums"]["fulfillment_shortage_reason"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_fulfillment_items_fulfillment_id_fkey"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "order_fulfillments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_fulfillment_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_fulfillments: {
        Row: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          fulfillment_number: number
          hold_reason: string | null
          id: string
          location_id: string | null
          notes: string | null
          order_id: string
          packed_at: string | null
          picked_at: string | null
          ready_for_handover_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["fulfillment_record_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          fulfillment_number: number
          hold_reason?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          order_id: string
          packed_at?: string | null
          picked_at?: string | null
          ready_for_handover_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["fulfillment_record_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          fulfillment_number?: number
          hold_reason?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          order_id?: string
          packed_at?: string | null
          picked_at?: string | null
          ready_for_handover_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["fulfillment_record_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_fulfillments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_fulfillments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          compare_at_price: number | null
          created_at: string
          discount_amount: number
          id: string
          line_total: number | null
          order_id: string
          product_id: string | null
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"] | null
          quantity: number
          sku: string | null
          sort_order: number
          unit_price: number
          variant_id: string | null
          variant_name: string | null
        }
        Insert: {
          compare_at_price?: number | null
          created_at?: string
          discount_amount?: number
          id?: string
          line_total?: number | null
          order_id: string
          product_id?: string | null
          product_name: string
          product_type?: Database["public"]["Enums"]["product_type"] | null
          quantity: number
          sku?: string | null
          sort_order?: number
          unit_price: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Update: {
          compare_at_price?: number | null
          created_at?: string
          discount_amount?: number
          id?: string
          line_total?: number | null
          order_id?: string
          product_id?: string | null
          product_name?: string
          product_type?: Database["public"]["Enums"]["product_type"] | null
          quantity?: number
          sku?: string | null
          sort_order?: number
          unit_price?: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_internal: boolean
          note: string
          note_type: Database["public"]["Enums"]["order_note_type"]
          order_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_internal?: boolean
          note: string
          note_type?: Database["public"]["Enums"]["order_note_type"]
          order_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_internal?: boolean
          note?: string
          note_type?: Database["public"]["Enums"]["order_note_type"]
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_return_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["return_event_type"]
          from_status: Database["public"]["Enums"]["order_return_status"] | null
          id: string
          message: string
          metadata: Json | null
          order_id: string
          return_id: string
          to_status: Database["public"]["Enums"]["order_return_status"] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["return_event_type"]
          from_status?:
            | Database["public"]["Enums"]["order_return_status"]
            | null
          id?: string
          message: string
          metadata?: Json | null
          order_id: string
          return_id: string
          to_status?: Database["public"]["Enums"]["order_return_status"] | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["return_event_type"]
          from_status?:
            | Database["public"]["Enums"]["order_return_status"]
            | null
          id?: string
          message?: string
          metadata?: Json | null
          order_id?: string
          return_id?: string
          to_status?: Database["public"]["Enums"]["order_return_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "order_return_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_return_events_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "order_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      order_return_items: {
        Row: {
          condition: Database["public"]["Enums"]["return_item_condition"]
          created_at: string
          id: string
          notes: string | null
          order_item_id: string
          quantity_accepted: number
          quantity_expected: number
          quantity_received: number
          reason: string | null
          return_id: string
          updated_at: string
        }
        Insert: {
          condition?: Database["public"]["Enums"]["return_item_condition"]
          created_at?: string
          id?: string
          notes?: string | null
          order_item_id: string
          quantity_accepted?: number
          quantity_expected?: number
          quantity_received?: number
          reason?: string | null
          return_id: string
          updated_at?: string
        }
        Update: {
          condition?: Database["public"]["Enums"]["return_item_condition"]
          created_at?: string
          id?: string
          notes?: string | null
          order_item_id?: string
          quantity_accepted?: number
          quantity_expected?: number
          quantity_received?: number
          reason?: string | null
          return_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_return_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "order_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      order_returns: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          requested_at: string
          resolution_note: string | null
          return_number: string
          return_type: Database["public"]["Enums"]["order_return_type"]
          shipment_id: string | null
          source: string
          status: Database["public"]["Enums"]["order_return_status"]
          tracking_reference: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          courier_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          initiated_at?: string | null
          inspected_at?: string | null
          notes?: string | null
          order_id: string
          reason?: string | null
          received_at?: string | null
          requested_at?: string
          resolution_note?: string | null
          return_number: string
          return_type?: Database["public"]["Enums"]["order_return_type"]
          shipment_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["order_return_status"]
          tracking_reference?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          courier_reason?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          initiated_at?: string | null
          inspected_at?: string | null
          notes?: string | null
          order_id?: string
          reason?: string | null
          received_at?: string | null
          requested_at?: string
          resolution_note?: string | null
          return_number?: string
          return_type?: Database["public"]["Enums"]["order_return_type"]
          shipment_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["order_return_status"]
          tracking_reference?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_returns_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      order_verification_attempts: {
        Row: {
          ai_result: Json | null
          attempt_number: number
          completed_at: string | null
          created_at: string
          duration_seconds: number | null
          external_call_id: string | null
          failure_reason: string | null
          id: string
          initiated_by: string | null
          method: Database["public"]["Enums"]["verification_method"]
          notes: string | null
          order_id: string
          outcome: Database["public"]["Enums"]["verification_attempt_outcome"]
          provider: string | null
          recording_reference: string | null
          scheduled_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["verification_attempt_status"]
          transcript_reference: string | null
        }
        Insert: {
          ai_result?: Json | null
          attempt_number: number
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          external_call_id?: string | null
          failure_reason?: string | null
          id?: string
          initiated_by?: string | null
          method: Database["public"]["Enums"]["verification_method"]
          notes?: string | null
          order_id: string
          outcome?: Database["public"]["Enums"]["verification_attempt_outcome"]
          provider?: string | null
          recording_reference?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["verification_attempt_status"]
          transcript_reference?: string | null
        }
        Update: {
          ai_result?: Json | null
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          external_call_id?: string | null
          failure_reason?: string | null
          id?: string
          initiated_by?: string | null
          method?: Database["public"]["Enums"]["verification_method"]
          notes?: string | null
          order_id?: string
          outcome?: Database["public"]["Enums"]["verification_attempt_outcome"]
          provider?: string | null
          recording_reference?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["verification_attempt_status"]
          transcript_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_verification_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_verification_events: {
        Row: {
          attempt_id: string | null
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["verification_event_type"]
          from_status:
            | Database["public"]["Enums"]["order_verification_status"]
            | null
          id: string
          message: string
          metadata: Json | null
          order_id: string
          to_status:
            | Database["public"]["Enums"]["order_verification_status"]
            | null
        }
        Insert: {
          attempt_id?: string | null
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["verification_event_type"]
          from_status?:
            | Database["public"]["Enums"]["order_verification_status"]
            | null
          id?: string
          message: string
          metadata?: Json | null
          order_id: string
          to_status?:
            | Database["public"]["Enums"]["order_verification_status"]
            | null
        }
        Update: {
          attempt_id?: string | null
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["verification_event_type"]
          from_status?:
            | Database["public"]["Enums"]["order_verification_status"]
            | null
          id?: string
          message?: string
          metadata?: Json | null
          order_id?: string
          to_status?:
            | Database["public"]["Enums"]["order_verification_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "order_verification_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "order_verification_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_verification_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        Insert: {
          adjustment?: number
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          delivery_charge?: number
          delivery_status?: Database["public"]["Enums"]["order_delivery_status"]
          due_amount?: number | null
          financial_status?: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason?: string | null
          fulfillment_location_id?: string | null
          fulfillment_status?: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total?: number
          id?: string
          order_discount?: number
          order_number: string
          packed_at?: string | null
          packing_charge?: number
          paid_amount?: number
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string | null
          product_discount?: number
          reservation_status?: Database["public"]["Enums"]["reservation_status"]
          reserved_at?: string | null
          risk_level?: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason?: string | null
          shipping_charge?: number
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          updated_at?: string
          updated_by?: string | null
          verification_attempt_count?: number
          verification_confirmed_at?: string | null
          verification_failure_reason?: string | null
          verification_last_attempt_at?: string | null
          verification_next_action_at?: string | null
          verification_priority?: Database["public"]["Enums"]["verification_priority"]
          verification_status?: Database["public"]["Enums"]["order_verification_status"]
        }
        Update: {
          adjustment?: number
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          delivery_charge?: number
          delivery_status?: Database["public"]["Enums"]["order_delivery_status"]
          due_amount?: number | null
          financial_status?: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason?: string | null
          fulfillment_location_id?: string | null
          fulfillment_status?: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total?: number
          id?: string
          order_discount?: number
          order_number?: string
          packed_at?: string | null
          packing_charge?: number
          paid_amount?: number
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string | null
          product_discount?: number
          reservation_status?: Database["public"]["Enums"]["reservation_status"]
          reserved_at?: string | null
          risk_level?: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason?: string | null
          shipping_charge?: number
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          updated_at?: string
          updated_by?: string | null
          verification_attempt_count?: number
          verification_confirmed_at?: string | null
          verification_failure_reason?: string | null
          verification_last_attempt_at?: string | null
          verification_next_action_at?: string | null
          verification_priority?: Database["public"]["Enums"]["verification_priority"]
          verification_status?: Database["public"]["Enums"]["order_verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "orders_fulfillment_location_id_fkey"
            columns: ["fulfillment_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
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
          product_id: string | null
          sort_order: number
          url: string
          variant_id: string | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string | null
          sort_order?: number
          url: string
          variant_id?: string | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string | null
          sort_order?: number
          url?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
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
          additional_cost: number | null
          barcode: string | null
          base_cost: number | null
          compare_at_price: number | null
          created_at: string
          height: number | null
          id: string
          length: number | null
          price: number | null
          product_id: string
          sku: string | null
          sort_order: number
          status: Database["public"]["Enums"]["variant_status"]
          title: string
          updated_at: string
          weight: number | null
          width: number | null
        }
        Insert: {
          additional_cost?: number | null
          barcode?: string | null
          base_cost?: number | null
          compare_at_price?: number | null
          created_at?: string
          height?: number | null
          id?: string
          length?: number | null
          price?: number | null
          product_id: string
          sku?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["variant_status"]
          title: string
          updated_at?: string
          weight?: number | null
          width?: number | null
        }
        Update: {
          additional_cost?: number | null
          barcode?: string | null
          base_cost?: number | null
          compare_at_price?: number | null
          created_at?: string
          height?: number | null
          id?: string
          length?: number | null
          price?: number | null
          product_id?: string
          sku?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["variant_status"]
          title?: string
          updated_at?: string
          weight?: number | null
          width?: number | null
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
          additional_cost: number
          barcode: string | null
          base_cost: number
          brand_id: string | null
          compare_at_price: number | null
          created_at: string
          created_by: string | null
          description: string | null
          dimension_unit: string
          estimated_landed_cost: number | null
          featured: boolean
          height: number | null
          id: string
          is_purchasable: boolean
          length: number | null
          name: string
          price: number
          product_type: Database["public"]["Enums"]["product_type"]
          requires_shipping: boolean
          short_description: string | null
          sku: string | null
          slug: string
          status: Database["public"]["Enums"]["product_status"]
          supply_model: Database["public"]["Enums"]["supply_model"]
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["entity_visibility"]
          weight: number | null
          weight_unit: string
          width: number | null
        }
        Insert: {
          additional_cost?: number
          barcode?: string | null
          base_cost?: number
          brand_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimension_unit?: string
          estimated_landed_cost?: number | null
          featured?: boolean
          height?: number | null
          id?: string
          is_purchasable?: boolean
          length?: number | null
          name: string
          price?: number
          product_type?: Database["public"]["Enums"]["product_type"]
          requires_shipping?: boolean
          short_description?: string | null
          sku?: string | null
          slug: string
          status?: Database["public"]["Enums"]["product_status"]
          supply_model?: Database["public"]["Enums"]["supply_model"]
          updated_at?: string
          updated_by?: string | null
          visibility?: Database["public"]["Enums"]["entity_visibility"]
          weight?: number | null
          weight_unit?: string
          width?: number | null
        }
        Update: {
          additional_cost?: number
          barcode?: string | null
          base_cost?: number
          brand_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dimension_unit?: string
          estimated_landed_cost?: number | null
          featured?: boolean
          height?: number | null
          id?: string
          is_purchasable?: boolean
          length?: number | null
          name?: string
          price?: number
          product_type?: Database["public"]["Enums"]["product_type"]
          requires_shipping?: boolean
          short_description?: string | null
          sku?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["product_status"]
          supply_model?: Database["public"]["Enums"]["supply_model"]
          updated_at?: string
          updated_by?: string | null
          visibility?: Database["public"]["Enums"]["entity_visibility"]
          weight?: number | null
          weight_unit?: string
          width?: number | null
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
      shipment_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["shipment_event_type"]
          from_status: Database["public"]["Enums"]["shipment_status"] | null
          id: string
          message: string
          metadata: Json | null
          order_id: string
          provider_event_id: string | null
          shipment_id: string
          to_status: Database["public"]["Enums"]["shipment_status"] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["shipment_event_type"]
          from_status?: Database["public"]["Enums"]["shipment_status"] | null
          id?: string
          message: string
          metadata?: Json | null
          order_id: string
          provider_event_id?: string | null
          shipment_id: string
          to_status?: Database["public"]["Enums"]["shipment_status"] | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["shipment_event_type"]
          from_status?: Database["public"]["Enums"]["shipment_status"] | null
          id?: string
          message?: string
          metadata?: Json | null
          order_id?: string
          provider_event_id?: string | null
          shipment_id?: string
          to_status?: Database["public"]["Enums"]["shipment_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_exceptions: {
        Row: {
          collected_amount: number | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          exception_type: Database["public"]["Enums"]["shipment_exception_type"]
          id: string
          notes: string | null
          occurred_at: string
          order_id: string
          provider_event: string | null
          reason: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          source: string
          status: Database["public"]["Enums"]["shipment_exception_status"]
          updated_at: string
        }
        Insert: {
          collected_amount?: number | null
          courier_reason?: string | null
          created_at?: string
          created_by?: string | null
          exception_type: Database["public"]["Enums"]["shipment_exception_type"]
          id?: string
          notes?: string | null
          occurred_at?: string
          order_id: string
          provider_event?: string | null
          reason?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id: string
          source?: string
          status?: Database["public"]["Enums"]["shipment_exception_status"]
          updated_at?: string
        }
        Update: {
          collected_amount?: number | null
          courier_reason?: string | null
          created_at?: string
          created_by?: string | null
          exception_type?: Database["public"]["Enums"]["shipment_exception_type"]
          id?: string
          notes?: string | null
          occurred_at?: string
          order_id?: string
          provider_event?: string | null
          reason?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id?: string
          source?: string
          status?: Database["public"]["Enums"]["shipment_exception_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_exceptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          created_at: string
          fulfillment_item_id: string | null
          id: string
          order_item_id: string
          quantity: number
          shipment_id: string
        }
        Insert: {
          created_at?: string
          fulfillment_item_id?: string | null
          id?: string
          order_item_id: string
          quantity: number
          shipment_id: string
        }
        Update: {
          created_at?: string
          fulfillment_item_id?: string | null
          id?: string
          order_item_id?: string
          quantity?: number
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_fulfillment_item_id_fkey"
            columns: ["fulfillment_item_id"]
            isOneToOne: false
            referencedRelation: "order_fulfillment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        Insert: {
          booked_at?: string | null
          booked_delivery_fee?: number | null
          booking_idempotency_key?: string
          cancelled_at?: string | null
          cash_on_delivery_amount?: number
          courier_account_id?: string | null
          created_at?: string
          created_by?: string | null
          declared_value?: number | null
          delivered_at?: string | null
          delivery_address: string
          delivery_area?: string | null
          delivery_city?: string | null
          delivery_zone?: string | null
          external_consignment_id?: string | null
          failure_reason?:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id?: string | null
          hold_reason?:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id?: string
          internal_notes?: string | null
          last_synced_at?: string | null
          notes?: string | null
          order_id: string
          package_count?: number
          partial_delivery_note?: string | null
          picked_up_at?: string | null
          postal_code?: string | null
          provider_id?: string | null
          provider_recipient_area_id?: string | null
          provider_recipient_city_id?: string | null
          provider_recipient_zone_id?: string | null
          provider_reference?: string | null
          provider_status?: string | null
          provider_status_at?: string | null
          provider_status_slug?: string | null
          quoted_delivery_fee?: number | null
          recipient_name: string
          recipient_phone: string
          return_reason?: string | null
          return_tracking_number?: string | null
          service_type?:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status?: Database["public"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          updated_at?: string
          updated_by?: string | null
          weight?: number | null
        }
        Update: {
          booked_at?: string | null
          booked_delivery_fee?: number | null
          booking_idempotency_key?: string
          cancelled_at?: string | null
          cash_on_delivery_amount?: number
          courier_account_id?: string | null
          created_at?: string
          created_by?: string | null
          declared_value?: number | null
          delivered_at?: string | null
          delivery_address?: string
          delivery_area?: string | null
          delivery_city?: string | null
          delivery_zone?: string | null
          external_consignment_id?: string | null
          failure_reason?:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id?: string | null
          hold_reason?:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id?: string
          internal_notes?: string | null
          last_synced_at?: string | null
          notes?: string | null
          order_id?: string
          package_count?: number
          partial_delivery_note?: string | null
          picked_up_at?: string | null
          postal_code?: string | null
          provider_id?: string | null
          provider_recipient_area_id?: string | null
          provider_recipient_city_id?: string | null
          provider_recipient_zone_id?: string | null
          provider_reference?: string | null
          provider_status?: string | null
          provider_status_at?: string | null
          provider_status_slug?: string | null
          quoted_delivery_fee?: number | null
          recipient_name?: string
          recipient_phone?: string
          return_reason?: string | null
          return_tracking_number?: string | null
          service_type?:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number?: string
          status?: Database["public"]["Enums"]["shipment_status"]
          tracking_number?: string | null
          updated_at?: string
          updated_by?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_courier_account_id_fkey"
            columns: ["courier_account_id"]
            isOneToOne: false
            referencedRelation: "courier_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_fulfillment_id_fkey"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "order_fulfillments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["id"]
          },
        ]
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
      adjust_group_buy_campaign_quantity: {
        Args: { _campaign_id: string; _quantity: number }
        Returns: number
      }
      apply_courier_operational_effects: {
        Args: {
          _at: string
          _event_type: Database["public"]["Enums"]["shipment_event_type"]
          _payload: Json
          _provider_event: string
          _shipment_id: string
        }
        Returns: undefined
      }
      apply_inventory_movement: {
        Args: {
          _inventory_level_id: string
          _movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          _note?: string
          _quantity: number
          _reference_id?: string
          _reference_type?: string
        }
        Returns: {
          available_quantity: number | null
          created_at: string
          created_by: string | null
          damaged: number
          id: string
          incoming: number
          location_id: string
          low_stock_threshold: number | null
          on_hand: number
          product_id: string | null
          reserved: number
          updated_at: string
          updated_by: string | null
          variant_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "inventory_levels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_verification_transition: {
        Args: {
          _attempt_id?: string
          _event: Database["public"]["Enums"]["verification_event_type"]
          _failure_reason?: string
          _message: string
          _metadata?: Json
          _order_id: string
          _risk_level?: Database["public"]["Enums"]["verification_risk_level"]
          _risk_reason?: string
          _scheduled_at?: string
          _to: Database["public"]["Enums"]["order_verification_status"]
          _touch_attempt?: boolean
        }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_shipment_courier: {
        Args: {
          _account_id?: string
          _provider_id: string
          _service_type?: Database["public"]["Enums"]["courier_service_type"]
          _shipment_id: string
        }
        Returns: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      brand_product_counts: {
        Args: never
        Returns: {
          brand_id: string
          product_count: number
        }[]
      }
      can_manage_commerce: { Args: { _user_id: string }; Returns: boolean }
      can_read_commerce: { Args: { _user_id: string }; Returns: boolean }
      cancel_order: {
        Args: { _force?: boolean; _order_id: string; _reason?: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      category_product_counts: {
        Args: never
        Returns: {
          category_id: string
          product_count: number
        }[]
      }
      commit_order_inventory: {
        Args: { _order_id: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_order: {
        Args: { _payload: Json }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_order_fulfillment: {
        Args: {
          _items: Json
          _location_id: string
          _notes?: string
          _order_id: string
        }
        Returns: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          fulfillment_number: number
          hold_reason: string | null
          id: string
          location_id: string | null
          notes: string | null
          order_id: string
          packed_at: string | null
          picked_at: string | null
          ready_for_handover_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["fulfillment_record_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_fulfillments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_order_return: {
        Args: {
          _courier_reason?: string
          _items?: Json
          _notes?: string
          _order_id: string
          _reason?: string
          _return_type?: Database["public"]["Enums"]["order_return_type"]
          _shipment_id?: string
          _source?: string
          _tracking_reference?: string
        }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          requested_at: string
          resolution_note: string | null
          return_number: string
          return_type: Database["public"]["Enums"]["order_return_type"]
          shipment_id: string | null
          source: string
          status: Database["public"]["Enums"]["order_return_status"]
          tracking_reference: string | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_returns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_shipment: {
        Args: {
          _cash_on_delivery_amount?: number
          _declared_value?: number
          _fulfillment_id: string
          _internal_notes?: string
          _items?: Json
          _notes?: string
          _package_count?: number
          _provider_id?: string
          _service_type?: Database["public"]["Enums"]["courier_service_type"]
          _weight?: number
        }
        Returns: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_shipment_exception: {
        Args: {
          _collected_amount?: number
          _courier_reason?: string
          _exception_type: Database["public"]["Enums"]["shipment_exception_type"]
          _notes?: string
          _occurred_at?: string
          _provider_event?: string
          _reason?: string
          _shipment_id: string
          _source?: string
        }
        Returns: {
          collected_amount: number | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          exception_type: Database["public"]["Enums"]["shipment_exception_type"]
          id: string
          notes: string | null
          occurred_at: string
          order_id: string
          provider_event: string | null
          reason: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          source: string
          status: Database["public"]["Enums"]["shipment_exception_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shipment_exceptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fulfillment_shippable_summary: {
        Args: { _fulfillment_id: string }
        Returns: {
          fulfilled: number
          fulfillment_item_id: string
          order_item_id: string
          planned: number
          product_name: string
          shippable: number
          shipped: number
          sku: string
          variant_name: string
        }[]
      }
      fulfillment_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["order_fulfillment_status"]
          _to: Database["public"]["Enums"]["order_fulfillment_status"]
        }
        Returns: boolean
      }
      fulfillment_transition_valid: {
        Args: {
          _from: Database["public"]["Enums"]["fulfillment_record_status"]
          _to: Database["public"]["Enums"]["fulfillment_record_status"]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ingest_courier_event: {
        Args: {
          _consignment_id?: string
          _merchant_order_id?: string
          _payload?: Json
          _provider_code: string
          _provider_event: string
          _provider_event_at?: string
          _provider_event_id?: string
          _source?: string
        }
        Returns: {
          account_id: string | null
          consignment_id: string | null
          fingerprint: string
          id: string
          merchant_order_id: string | null
          payload: Json | null
          processing_note: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event: string | null
          provider_event_at: string | null
          provider_id: string | null
          provider_status: string | null
          received_at: string
          shipment_id: string | null
          source: string
        }
        SetofOptions: {
          from: "*"
          to: "courier_provider_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      inspect_return_items: {
        Args: { _items: Json; _note?: string; _return_id: string }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          requested_at: string
          resolution_note: string | null
          return_number: string
          return_type: Database["public"]["Enums"]["order_return_type"]
          shipment_id: string | null
          source: string
          status: Database["public"]["Enums"]["order_return_status"]
          tracking_reference: string | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_returns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      log_fulfillment_event: {
        Args: {
          _event: Database["public"]["Enums"]["fulfillment_event_type"]
          _from: Database["public"]["Enums"]["fulfillment_record_status"]
          _fulfillment_id: string
          _message: string
          _metadata?: Json
          _order_id: string
          _to: Database["public"]["Enums"]["fulfillment_record_status"]
        }
        Returns: undefined
      }
      log_return_event: {
        Args: {
          _event: Database["public"]["Enums"]["return_event_type"]
          _from: Database["public"]["Enums"]["order_return_status"]
          _message: string
          _metadata?: Json
          _order_id: string
          _return_id: string
          _to: Database["public"]["Enums"]["order_return_status"]
        }
        Returns: undefined
      }
      log_shipment_event: {
        Args: {
          _event: Database["public"]["Enums"]["shipment_event_type"]
          _from: Database["public"]["Enums"]["shipment_status"]
          _message: string
          _metadata?: Json
          _order_id: string
          _shipment_id: string
          _to: Database["public"]["Enums"]["shipment_status"]
        }
        Returns: undefined
      }
      next_order_number: { Args: never; Returns: string }
      next_return_number: { Args: never; Returns: string }
      next_shipment_number: { Args: never; Returns: string }
      order_fulfillment_summary: {
        Args: { _order_id: string }
        Returns: {
          fulfilled: number
          order_item_id: string
          ordered: number
          remaining: number
        }[]
      }
      record_courier_booking: {
        Args: {
          _consignment_id: string
          _delivery_fee?: number
          _provider_status?: string
          _shipment_id: string
          _tracking_number?: string
        }
        Returns: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_courier_quote: {
        Args: { _quoted_fee: number; _shipment_id: string }
        Returns: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_fulfillment_picks: {
        Args: { _fulfillment_id: string; _items: Json }
        Returns: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          fulfillment_number: number
          hold_reason: string | null
          id: string
          location_id: string | null
          notes: string | null
          order_id: string
          packed_at: string | null
          picked_at: string | null
          ready_for_handover_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["fulfillment_record_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_fulfillments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_return_receipt: {
        Args: { _items: Json; _note?: string; _return_id: string }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          requested_at: string
          resolution_note: string | null
          return_number: string
          return_type: Database["public"]["Enums"]["order_return_type"]
          shipment_id: string | null
          source: string
          status: Database["public"]["Enums"]["order_return_status"]
          tracking_reference: string | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_returns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_verification_attempt: {
        Args: {
          _duration_seconds?: number
          _failure_reason?: string
          _method: Database["public"]["Enums"]["verification_method"]
          _notes?: string
          _order_id: string
          _outcome: Database["public"]["Enums"]["verification_attempt_outcome"]
          _provider?: string
          _risk_reason?: string
          _scheduled_at?: string
        }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_order_delivery_status: {
        Args: { _order_id: string }
        Returns: Database["public"]["Enums"]["order_delivery_status"]
      }
      release_order_reservations: {
        Args: { _order_id: string; _reason: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_order_inventory: {
        Args: { _order_id: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_transition_valid: {
        Args: {
          _from: Database["public"]["Enums"]["order_return_status"]
          _to: Database["public"]["Enums"]["order_return_status"]
        }
        Returns: boolean
      }
      set_default_inventory_location: {
        Args: { _location_id: string }
        Returns: string
      }
      set_exception_state: {
        Args: { _action: string; _exception_id: string; _note?: string }
        Returns: {
          collected_amount: number | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          exception_type: Database["public"]["Enums"]["shipment_exception_type"]
          id: string
          notes: string | null
          occurred_at: string
          order_id: string
          provider_event: string | null
          reason: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          source: string
          status: Database["public"]["Enums"]["shipment_exception_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shipment_exceptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_fulfillment_item_qc: {
        Args: {
          _item_id: string
          _note?: string
          _qc_status: Database["public"]["Enums"]["fulfillment_qc_status"]
        }
        Returns: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          fulfillment_number: number
          hold_reason: string | null
          id: string
          location_id: string | null
          notes: string | null
          order_id: string
          packed_at: string | null
          picked_at: string | null
          ready_for_handover_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["fulfillment_record_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_fulfillments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_fulfillment_state: {
        Args: { _action: string; _fulfillment_id: string; _reason?: string }
        Returns: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          fulfillment_number: number
          hold_reason: string | null
          id: string
          location_id: string | null
          notes: string | null
          order_id: string
          packed_at: string | null
          picked_at: string | null
          ready_for_handover_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["fulfillment_record_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_fulfillments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_order_fulfillment_state: {
        Args: { _action: string; _order_id: string; _reason?: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_order_verification_priority: {
        Args: {
          _order_id: string
          _priority: Database["public"]["Enums"]["verification_priority"]
        }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_order_verification_state: {
        Args: {
          _action: string
          _order_id: string
          _reason?: string
          _risk_level?: Database["public"]["Enums"]["verification_risk_level"]
          _scheduled_at?: string
        }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_return_state: {
        Args: { _action: string; _reason?: string; _return_id: string }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          requested_at: string
          resolution_note: string | null
          return_number: string
          return_type: Database["public"]["Enums"]["order_return_type"]
          shipment_id: string | null
          source: string
          status: Database["public"]["Enums"]["order_return_status"]
          tracking_reference: string | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_returns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_shipment_return_tracking: {
        Args: {
          _return_reason?: string
          _return_tracking_number: string
          _shipment_id: string
        }
        Returns: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_shipment_state: {
        Args: {
          _action: string
          _external_consignment_id?: string
          _failure_reason?: Database["public"]["Enums"]["shipment_failure_reason"]
          _hold_reason?: Database["public"]["Enums"]["shipment_hold_reason"]
          _reason?: string
          _shipment_id: string
          _tracking_number?: string
        }
        Returns: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shipment_transition_valid: {
        Args: {
          _from: Database["public"]["Enums"]["shipment_status"]
          _to: Database["public"]["Enums"]["shipment_status"]
        }
        Returns: boolean
      }
      start_order_verification: {
        Args: {
          _method?: Database["public"]["Enums"]["verification_method"]
          _order_id: string
        }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_status: Database["public"]["Enums"]["order_delivery_status"]
          due_amount: number | null
          financial_status: Database["public"]["Enums"]["order_financial_status"]
          fulfillment_hold_reason: string | null
          fulfillment_location_id: string | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          grand_total: number
          id: string
          order_discount: number
          order_number: string
          packed_at: string | null
          packing_charge: number
          paid_amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string | null
          product_discount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          updated_at: string
          updated_by: string | null
          verification_attempt_count: number
          verification_confirmed_at: string | null
          verification_failure_reason: string | null
          verification_last_attempt_at: string | null
          verification_next_action_at: string | null
          verification_priority: Database["public"]["Enums"]["verification_priority"]
          verification_status: Database["public"]["Enums"]["order_verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_shipment_details: {
        Args: {
          _cash_on_delivery_amount?: number
          _declared_value?: number
          _internal_notes?: string
          _notes?: string
          _package_count?: number
          _shipment_id: string
          _weight?: number
        }
        Returns: {
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_idempotency_key: string
          cancelled_at: string | null
          cash_on_delivery_amount: number
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          package_count: number
          partial_delivery_note: string | null
          picked_up_at: string | null
          postal_code: string | null
          provider_id: string | null
          provider_recipient_area_id: string | null
          provider_recipient_city_id: string | null
          provider_recipient_zone_id: string | null
          provider_reference: string | null
          provider_status: string | null
          provider_status_at: string | null
          provider_status_slug: string | null
          quoted_delivery_fee: number | null
          recipient_name: string
          recipient_phone: string
          return_reason: string | null
          return_tracking_number: string | null
          service_type:
            | Database["public"]["Enums"]["courier_service_type"]
            | null
          shipment_number: string
          status: Database["public"]["Enums"]["shipment_status"]
          tracking_number: string | null
          updated_at: string
          updated_by: string | null
          weight: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shipments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verification_max_attempts: { Args: never; Returns: number }
      verification_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["order_verification_status"]
          _to: Database["public"]["Enums"]["order_verification_status"]
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "staff" | "viewer"
      brand_type: "standard" | "own_brand" | "generic"
      courier_environment: "sandbox" | "production"
      courier_event_processing_status:
        | "applied"
        | "recorded"
        | "duplicate"
        | "stale"
        | "unmatched"
        | "rejected"
      courier_provider_status: "active" | "inactive" | "disabled"
      courier_service_type:
        | "standard"
        | "express"
        | "same_day"
        | "next_day"
        | "other"
      entity_status: "active" | "inactive" | "archived"
      entity_visibility: "visible" | "hidden"
      fulfillment_event_type:
        | "fulfillment_created"
        | "picking_started"
        | "item_picked"
        | "picking_completed"
        | "packing_started"
        | "qc_started"
        | "qc_passed"
        | "qc_failed"
        | "packed"
        | "ready_for_handover"
        | "put_on_hold"
        | "hold_released"
        | "fulfillment_cancelled"
      fulfillment_qc_status: "pending" | "passed" | "failed"
      fulfillment_record_status:
        | "unfulfilled"
        | "ready_to_pick"
        | "picking"
        | "picked"
        | "packing"
        | "qc_pending"
        | "qc_failed"
        | "packed"
        | "ready_for_handover"
        | "on_hold"
        | "cancelled"
      fulfillment_shortage_reason:
        | "out_of_stock"
        | "damaged"
        | "missing"
        | "wrong_item"
        | "other"
      group_buy_status:
        | "draft"
        | "scheduled"
        | "active"
        | "closed"
        | "target_met"
        | "target_not_met"
        | "procurement"
        | "fulfillment"
        | "completed"
        | "cancelled"
      inventory_movement_type:
        | "initial"
        | "adjustment_in"
        | "adjustment_out"
        | "damage"
        | "return_in"
        | "reservation"
        | "release_reservation"
        | "fulfillment_out"
      order_delivery_status:
        | "not_shipped"
        | "partially_shipped"
        | "shipped"
        | "in_transit"
        | "on_hold"
        | "partially_delivered"
        | "delivered"
        | "delivery_failed"
        | "partially_returned"
        | "returned"
      order_financial_status: "not_applicable"
      order_fulfillment_status:
        | "not_started"
        | "on_hold"
        | "ready"
        | "picking"
        | "picked"
        | "packing"
        | "packed"
        | "ready_for_courier"
      order_note_type: "general" | "system"
      order_return_status:
        | "pending"
        | "in_transit"
        | "received"
        | "inspected"
        | "completed"
        | "cancelled"
        | "lost"
      order_return_type:
        | "return_to_merchant"
        | "paid_return"
        | "customer_return"
        | "exchange_return"
        | "other"
      order_source:
        | "admin"
        | "web"
        | "mobile"
        | "facebook"
        | "whatsapp"
        | "phone"
        | "import"
        | "api"
      order_status: "draft" | "created" | "cancelled"
      order_verification_status:
        | "not_required"
        | "pending"
        | "in_progress"
        | "manual_review"
        | "rescheduled"
        | "confirmed"
        | "unreachable"
        | "failed"
        | "cancelled"
      payment_method:
        | "cod"
        | "cash"
        | "bkash"
        | "nagad"
        | "rocket"
        | "card"
        | "bank_transfer"
        | "other"
      payment_status: "unpaid" | "partial" | "paid" | "refunded"
      product_relationship_type: "related" | "upsell" | "cross_sell"
      product_status: "draft" | "active" | "inactive" | "archived"
      product_type: "simple" | "variable" | "bundle" | "service" | "digital"
      reservation_record_status: "active" | "released" | "committed"
      reservation_status:
        | "not_required"
        | "pending"
        | "reserved"
        | "partial"
        | "failed"
        | "released"
      return_event_type:
        | "return_created"
        | "status_changed"
        | "items_received"
        | "inspection_recorded"
        | "return_completed"
        | "return_cancelled"
        | "return_lost"
        | "provider_event"
        | "note_added"
      return_item_condition:
        | "unknown"
        | "good"
        | "opened"
        | "damaged"
        | "missing"
        | "unusable"
      shipment_event_type:
        | "shipment_created"
        | "ready_for_booking"
        | "booking_requested"
        | "booking_confirmed"
        | "pickup_requested"
        | "shipment_picked_up"
        | "status_updated"
        | "delivery_on_hold"
        | "delivery_failed"
        | "shipment_delivered"
        | "return_requested"
        | "return_started"
        | "return_received"
        | "shipment_lost"
        | "shipment_cancelled"
        | "courier_assigned"
        | "provider_event"
        | "status_refreshed"
        | "booking_failed"
        | "partial_delivery"
        | "pickup_failed"
        | "return_created"
      shipment_exception_status:
        | "open"
        | "under_review"
        | "resolved"
        | "dismissed"
      shipment_exception_type:
        | "delivery_failed"
        | "delivery_on_hold"
        | "pickup_failed"
        | "pickup_cancelled"
        | "address_issue"
        | "customer_unavailable"
        | "customer_refused"
        | "damaged_in_transit"
        | "lost_in_transit"
        | "partial_delivery"
        | "other"
      shipment_failure_reason:
        | "customer_unreachable"
        | "customer_refused"
        | "address_not_found"
        | "delivery_attempt_failed"
        | "area_unserviceable"
        | "customer_requested_cancel"
        | "other"
      shipment_hold_reason:
        | "customer_requested_delay"
        | "address_issue"
        | "rider_issue"
        | "weather"
        | "operational_issue"
        | "other"
      shipment_status:
        | "draft"
        | "ready_for_booking"
        | "booking_requested"
        | "booking_failed"
        | "booked"
        | "pickup_requested"
        | "pickup_failed"
        | "picked_up"
        | "in_transit"
        | "out_for_delivery"
        | "delivery_on_hold"
        | "delivered"
        | "partial_delivered"
        | "delivery_failed"
        | "return_requested"
        | "return_in_transit"
        | "return_received"
        | "lost"
        | "cancelled"
      supply_model: "in_stock" | "local_sourcing" | "preorder" | "group_buy"
      variant_status: "active" | "inactive"
      verification_attempt_outcome:
        | "pending"
        | "answered"
        | "confirmed"
        | "rejected"
        | "no_answer"
        | "busy"
        | "invalid_number"
        | "callback_requested"
        | "risk_flagged"
        | "failed"
      verification_attempt_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "cancelled"
      verification_event_type:
        | "verification_started"
        | "attempt_created"
        | "attempt_completed"
        | "callback_scheduled"
        | "moved_to_manual_review"
        | "risk_flagged"
        | "verification_confirmed"
        | "verification_failed"
        | "verification_unreachable"
        | "verification_cancelled"
        | "priority_changed"
      verification_method:
        | "ai_voice"
        | "manual_call"
        | "sms"
        | "whatsapp"
        | "other"
      verification_priority: "low" | "normal" | "high" | "urgent"
      verification_risk_level: "none" | "low" | "medium" | "high"
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
      courier_environment: ["sandbox", "production"],
      courier_event_processing_status: [
        "applied",
        "recorded",
        "duplicate",
        "stale",
        "unmatched",
        "rejected",
      ],
      courier_provider_status: ["active", "inactive", "disabled"],
      courier_service_type: [
        "standard",
        "express",
        "same_day",
        "next_day",
        "other",
      ],
      entity_status: ["active", "inactive", "archived"],
      entity_visibility: ["visible", "hidden"],
      fulfillment_event_type: [
        "fulfillment_created",
        "picking_started",
        "item_picked",
        "picking_completed",
        "packing_started",
        "qc_started",
        "qc_passed",
        "qc_failed",
        "packed",
        "ready_for_handover",
        "put_on_hold",
        "hold_released",
        "fulfillment_cancelled",
      ],
      fulfillment_qc_status: ["pending", "passed", "failed"],
      fulfillment_record_status: [
        "unfulfilled",
        "ready_to_pick",
        "picking",
        "picked",
        "packing",
        "qc_pending",
        "qc_failed",
        "packed",
        "ready_for_handover",
        "on_hold",
        "cancelled",
      ],
      fulfillment_shortage_reason: [
        "out_of_stock",
        "damaged",
        "missing",
        "wrong_item",
        "other",
      ],
      group_buy_status: [
        "draft",
        "scheduled",
        "active",
        "closed",
        "target_met",
        "target_not_met",
        "procurement",
        "fulfillment",
        "completed",
        "cancelled",
      ],
      inventory_movement_type: [
        "initial",
        "adjustment_in",
        "adjustment_out",
        "damage",
        "return_in",
        "reservation",
        "release_reservation",
        "fulfillment_out",
      ],
      order_delivery_status: [
        "not_shipped",
        "partially_shipped",
        "shipped",
        "in_transit",
        "on_hold",
        "partially_delivered",
        "delivered",
        "delivery_failed",
        "partially_returned",
        "returned",
      ],
      order_financial_status: ["not_applicable"],
      order_fulfillment_status: [
        "not_started",
        "on_hold",
        "ready",
        "picking",
        "picked",
        "packing",
        "packed",
        "ready_for_courier",
      ],
      order_note_type: ["general", "system"],
      order_return_status: [
        "pending",
        "in_transit",
        "received",
        "inspected",
        "completed",
        "cancelled",
        "lost",
      ],
      order_return_type: [
        "return_to_merchant",
        "paid_return",
        "customer_return",
        "exchange_return",
        "other",
      ],
      order_source: [
        "admin",
        "web",
        "mobile",
        "facebook",
        "whatsapp",
        "phone",
        "import",
        "api",
      ],
      order_status: ["draft", "created", "cancelled"],
      order_verification_status: [
        "not_required",
        "pending",
        "in_progress",
        "manual_review",
        "rescheduled",
        "confirmed",
        "unreachable",
        "failed",
        "cancelled",
      ],
      payment_method: [
        "cod",
        "cash",
        "bkash",
        "nagad",
        "rocket",
        "card",
        "bank_transfer",
        "other",
      ],
      payment_status: ["unpaid", "partial", "paid", "refunded"],
      product_relationship_type: ["related", "upsell", "cross_sell"],
      product_status: ["draft", "active", "inactive", "archived"],
      product_type: ["simple", "variable", "bundle", "service", "digital"],
      reservation_record_status: ["active", "released", "committed"],
      reservation_status: [
        "not_required",
        "pending",
        "reserved",
        "partial",
        "failed",
        "released",
      ],
      return_event_type: [
        "return_created",
        "status_changed",
        "items_received",
        "inspection_recorded",
        "return_completed",
        "return_cancelled",
        "return_lost",
        "provider_event",
        "note_added",
      ],
      return_item_condition: [
        "unknown",
        "good",
        "opened",
        "damaged",
        "missing",
        "unusable",
      ],
      shipment_event_type: [
        "shipment_created",
        "ready_for_booking",
        "booking_requested",
        "booking_confirmed",
        "pickup_requested",
        "shipment_picked_up",
        "status_updated",
        "delivery_on_hold",
        "delivery_failed",
        "shipment_delivered",
        "return_requested",
        "return_started",
        "return_received",
        "shipment_lost",
        "shipment_cancelled",
        "courier_assigned",
        "provider_event",
        "status_refreshed",
        "booking_failed",
        "partial_delivery",
        "pickup_failed",
        "return_created",
      ],
      shipment_exception_status: [
        "open",
        "under_review",
        "resolved",
        "dismissed",
      ],
      shipment_exception_type: [
        "delivery_failed",
        "delivery_on_hold",
        "pickup_failed",
        "pickup_cancelled",
        "address_issue",
        "customer_unavailable",
        "customer_refused",
        "damaged_in_transit",
        "lost_in_transit",
        "partial_delivery",
        "other",
      ],
      shipment_failure_reason: [
        "customer_unreachable",
        "customer_refused",
        "address_not_found",
        "delivery_attempt_failed",
        "area_unserviceable",
        "customer_requested_cancel",
        "other",
      ],
      shipment_hold_reason: [
        "customer_requested_delay",
        "address_issue",
        "rider_issue",
        "weather",
        "operational_issue",
        "other",
      ],
      shipment_status: [
        "draft",
        "ready_for_booking",
        "booking_requested",
        "booking_failed",
        "booked",
        "pickup_requested",
        "pickup_failed",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivery_on_hold",
        "delivered",
        "partial_delivered",
        "delivery_failed",
        "return_requested",
        "return_in_transit",
        "return_received",
        "lost",
        "cancelled",
      ],
      supply_model: ["in_stock", "local_sourcing", "preorder", "group_buy"],
      variant_status: ["active", "inactive"],
      verification_attempt_outcome: [
        "pending",
        "answered",
        "confirmed",
        "rejected",
        "no_answer",
        "busy",
        "invalid_number",
        "callback_requested",
        "risk_flagged",
        "failed",
      ],
      verification_attempt_status: [
        "pending",
        "in_progress",
        "completed",
        "cancelled",
      ],
      verification_event_type: [
        "verification_started",
        "attempt_created",
        "attempt_completed",
        "callback_scheduled",
        "moved_to_manual_review",
        "risk_flagged",
        "verification_confirmed",
        "verification_failed",
        "verification_unreachable",
        "verification_cancelled",
        "priority_changed",
      ],
      verification_method: [
        "ai_voice",
        "manual_call",
        "sms",
        "whatsapp",
        "other",
      ],
      verification_priority: ["low", "normal", "high", "urgent"],
      verification_risk_level: ["none", "low", "medium", "high"],
    },
  },
} as const

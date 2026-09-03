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
      ai_analysis_runs: {
        Row: {
          analysis_type: Database["public"]["Enums"]["ai_analysis_type"]
          completed_at: string | null
          context_summary: Json
          created_at: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string
          error_message: string | null
          id: string
          insight_count: number
          model: string | null
          provider: string | null
          recommendation_count: number
          requested_by: string
          source: string
          started_at: string | null
          status: Database["public"]["Enums"]["ai_run_status"]
          summary: string | null
        }
        Insert: {
          analysis_type: Database["public"]["Enums"]["ai_analysis_type"]
          completed_at?: string | null
          context_summary?: Json
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type: string
          error_message?: string | null
          id?: string
          insight_count?: number
          model?: string | null
          provider?: string | null
          recommendation_count?: number
          requested_by?: string
          source?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["ai_run_status"]
          summary?: string | null
        }
        Update: {
          analysis_type?: Database["public"]["Enums"]["ai_analysis_type"]
          completed_at?: string | null
          context_summary?: Json
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string
          error_message?: string | null
          id?: string
          insight_count?: number
          model?: string | null
          provider?: string | null
          recommendation_count?: number
          requested_by?: string
          source?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["ai_run_status"]
          summary?: string | null
        }
        Relationships: []
      }
      ai_brain_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          insight_id: string | null
          message: string
          recommendation_id: string | null
          run_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          insight_id?: string | null
          message: string
          recommendation_id?: string | null
          run_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          insight_id?: string | null
          message?: string
          recommendation_id?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_brain_events_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "ai_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_brain_events_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_brain_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          analysis_run_id: string
          category: Database["public"]["Enums"]["ai_insight_category"]
          confidence: number
          created_at: string
          entity_id: string | null
          entity_type: string
          evidence: Json
          expires_at: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          severity: Database["public"]["Enums"]["ai_insight_severity"]
          status: Database["public"]["Enums"]["ai_insight_status"]
          summary: string
          superseded_at: string | null
          superseded_by_run_id: string | null
          title: string
        }
        Insert: {
          analysis_run_id: string
          category: Database["public"]["Enums"]["ai_insight_category"]
          confidence?: number
          created_at?: string
          entity_id?: string | null
          entity_type: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity: Database["public"]["Enums"]["ai_insight_severity"]
          status?: Database["public"]["Enums"]["ai_insight_status"]
          summary: string
          superseded_at?: string | null
          superseded_by_run_id?: string | null
          title: string
        }
        Update: {
          analysis_run_id?: string
          category?: Database["public"]["Enums"]["ai_insight_category"]
          confidence?: number
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: Database["public"]["Enums"]["ai_insight_severity"]
          status?: Database["public"]["Enums"]["ai_insight_status"]
          summary?: string
          superseded_at?: string | null
          superseded_by_run_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "ai_analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_superseded_by_run_id_fkey"
            columns: ["superseded_by_run_id"]
            isOneToOne: false
            referencedRelation: "ai_analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          action_target: string | null
          analysis_run_id: string
          confidence: number
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string
          id: string
          insight_id: string | null
          priority: Database["public"]["Enums"]["ai_recommendation_priority"]
          recommendation_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["ai_recommendation_status"]
          suggested_action: string | null
          title: string
        }
        Insert: {
          action_target?: string | null
          analysis_run_id: string
          confidence?: number
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type: string
          id?: string
          insight_id?: string | null
          priority?: Database["public"]["Enums"]["ai_recommendation_priority"]
          recommendation_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["ai_recommendation_status"]
          suggested_action?: string | null
          title: string
        }
        Update: {
          action_target?: string | null
          analysis_run_id?: string
          confidence?: number
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          insight_id?: string | null
          priority?: Database["public"]["Enums"]["ai_recommendation_priority"]
          recommendation_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["ai_recommendation_status"]
          suggested_action?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "ai_analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendations_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "ai_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_notes: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          execution_id: string | null
          id: string
          note: string
          rule_id: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          execution_id?: string | null
          id?: string
          note: string
          rule_id?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          execution_id?: string | null
          id?: string
          note?: string
          rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_notes_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "automation_rule_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_notes_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rule_executions: {
        Row: {
          automation_depth: number
          completed_at: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          error_message: string | null
          event_type: Database["public"]["Enums"]["automation_trigger_type"]
          id: string
          input_snapshot: Json
          result: Json | null
          rule_id: string
          source_event_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["automation_execution_status"]
        }
        Insert: {
          automation_depth?: number
          completed_at?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          error_message?: string | null
          event_type: Database["public"]["Enums"]["automation_trigger_type"]
          id?: string
          input_snapshot?: Json
          result?: Json | null
          rule_id: string
          source_event_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["automation_execution_status"]
        }
        Update: {
          automation_depth?: number
          completed_at?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error_message?: string | null
          event_type?: Database["public"]["Enums"]["automation_trigger_type"]
          id?: string
          input_snapshot?: Json
          result?: Json | null
          rule_id?: string
          source_event_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["automation_execution_status"]
        }
        Relationships: [
          {
            foreignKeyName: "automation_rule_executions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action_config: Json
          action_type: Database["public"]["Enums"]["automation_action_type"]
          condition_mode: Database["public"]["Enums"]["automation_condition_mode"]
          conditions: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          priority: Database["public"]["Enums"]["automation_rule_priority"]
          status: Database["public"]["Enums"]["automation_rule_status"]
          trigger_type: Database["public"]["Enums"]["automation_trigger_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action_config?: Json
          action_type: Database["public"]["Enums"]["automation_action_type"]
          condition_mode?: Database["public"]["Enums"]["automation_condition_mode"]
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          priority?: Database["public"]["Enums"]["automation_rule_priority"]
          status?: Database["public"]["Enums"]["automation_rule_status"]
          trigger_type: Database["public"]["Enums"]["automation_trigger_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action_config?: Json
          action_type?: Database["public"]["Enums"]["automation_action_type"]
          condition_mode?: Database["public"]["Enums"]["automation_condition_mode"]
          conditions?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          priority?: Database["public"]["Enums"]["automation_rule_priority"]
          status?: Database["public"]["Enums"]["automation_rule_status"]
          trigger_type?: Database["public"]["Enums"]["automation_trigger_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      background_job_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          duration_ms: number | null
          failure_class:
            | Database["public"]["Enums"]["sync_failure_class"]
            | null
          finished_at: string | null
          id: string
          job_id: string
          message: string | null
          ok: boolean | null
          run_id: string | null
          started_at: string
          worker_id: string | null
        }
        Insert: {
          attempt_number: number
          created_at?: string
          duration_ms?: number | null
          failure_class?:
            | Database["public"]["Enums"]["sync_failure_class"]
            | null
          finished_at?: string | null
          id?: string
          job_id: string
          message?: string | null
          ok?: boolean | null
          run_id?: string | null
          started_at?: string
          worker_id?: string | null
        }
        Update: {
          attempt_number?: number
          created_at?: string
          duration_ms?: number | null
          failure_class?:
            | Database["public"]["Enums"]["sync_failure_class"]
            | null
          finished_at?: string | null
          id?: string
          job_id?: string
          message?: string | null
          ok?: boolean | null
          run_id?: string | null
          started_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "background_job_attempts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      background_job_types: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          job_type: string
          label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          job_type: string
          label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          job_type?: string
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
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
      channel_listing_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["channel_listing_event_type"]
          id: string
          listing_id: string
          message: string | null
          status_from:
            | Database["public"]["Enums"]["channel_listing_status"]
            | null
          status_to:
            | Database["public"]["Enums"]["channel_listing_status"]
            | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["channel_listing_event_type"]
          id?: string
          listing_id: string
          message?: string | null
          status_from?:
            | Database["public"]["Enums"]["channel_listing_status"]
            | null
          status_to?:
            | Database["public"]["Enums"]["channel_listing_status"]
            | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["channel_listing_event_type"]
          id?: string
          listing_id?: string
          message?: string | null
          status_from?:
            | Database["public"]["Enums"]["channel_listing_status"]
            | null
          status_to?:
            | Database["public"]["Enums"]["channel_listing_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_listing_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_product_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_account_credentials: {
        Row: {
          access_token_ref: string | null
          account_id: string
          client_id: string | null
          client_secret_ref: string | null
          created_at: string
          password_ref: string | null
          refresh_token_ref: string | null
          token_expires_at: string | null
          token_refreshed_at: string | null
          updated_at: string
          username: string | null
          webhook_secret_ref: string | null
        }
        Insert: {
          access_token_ref?: string | null
          account_id: string
          client_id?: string | null
          client_secret_ref?: string | null
          created_at?: string
          password_ref?: string | null
          refresh_token_ref?: string | null
          token_expires_at?: string | null
          token_refreshed_at?: string | null
          updated_at?: string
          username?: string | null
          webhook_secret_ref?: string | null
        }
        Update: {
          access_token_ref?: string | null
          account_id?: string
          client_id?: string | null
          client_secret_ref?: string | null
          created_at?: string
          password_ref?: string | null
          refresh_token_ref?: string | null
          token_expires_at?: string | null
          token_refreshed_at?: string | null
          updated_at?: string
          username?: string | null
          webhook_secret_ref?: string | null
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
          store_id: string | null
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
          store_id?: string | null
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
          store_id?: string | null
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
          {
            foreignKeyName: "courier_accounts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
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
          last_attempt_at: string | null
          last_error: string | null
          last_replay_at: string | null
          last_replay_by: string | null
          merchant_order_id: string | null
          next_retry_at: string | null
          payload: Json | null
          processing_note: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event: string | null
          provider_event_at: string | null
          provider_id: string | null
          provider_status: string | null
          received_at: string
          replay_count: number
          retry_count: number
          shipment_id: string | null
          source: string
        }
        Insert: {
          account_id?: string | null
          consignment_id?: string | null
          fingerprint: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_replay_at?: string | null
          last_replay_by?: string | null
          merchant_order_id?: string | null
          next_retry_at?: string | null
          payload?: Json | null
          processing_note?: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event?: string | null
          provider_event_at?: string | null
          provider_id?: string | null
          provider_status?: string | null
          received_at?: string
          replay_count?: number
          retry_count?: number
          shipment_id?: string | null
          source?: string
        }
        Update: {
          account_id?: string | null
          consignment_id?: string | null
          fingerprint?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_replay_at?: string | null
          last_replay_by?: string | null
          merchant_order_id?: string | null
          next_retry_at?: string | null
          payload?: Json | null
          processing_note?: string | null
          processing_status?: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event?: string | null
          provider_event_at?: string | null
          provider_id?: string | null
          provider_status?: string | null
          received_at?: string
          replay_count?: number
          retry_count?: number
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
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
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
      courier_settlement_discrepancies: {
        Row: {
          adjustment_id: string | null
          created_at: string
          created_by: string | null
          difference: number
          direction: string
          discrepancy_type: string
          expected_amount: number
          id: string
          order_id: string
          resolution:
            | Database["public"]["Enums"]["settlement_discrepancy_resolution"]
            | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          settled_amount: number
          settlement_id: string
          settlement_item_id: string
          shipment_id: string
          status: Database["public"]["Enums"]["settlement_discrepancy_status"]
          updated_at: string
        }
        Insert: {
          adjustment_id?: string | null
          created_at?: string
          created_by?: string | null
          difference: number
          direction: string
          discrepancy_type?: string
          expected_amount: number
          id?: string
          order_id: string
          resolution?:
            | Database["public"]["Enums"]["settlement_discrepancy_resolution"]
            | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settled_amount: number
          settlement_id: string
          settlement_item_id: string
          shipment_id: string
          status?: Database["public"]["Enums"]["settlement_discrepancy_status"]
          updated_at?: string
        }
        Update: {
          adjustment_id?: string | null
          created_at?: string
          created_by?: string | null
          difference?: number
          direction?: string
          discrepancy_type?: string
          expected_amount?: number
          id?: string
          order_id?: string
          resolution?:
            | Database["public"]["Enums"]["settlement_discrepancy_resolution"]
            | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settled_amount?: number
          settlement_id?: string
          settlement_item_id?: string
          shipment_id?: string
          status?: Database["public"]["Enums"]["settlement_discrepancy_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_settlement_discrepancies_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "order_financial_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlement_discrepancies_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "courier_settlement_discrepancies_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlement_discrepancies_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "courier_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlement_discrepancies_settlement_item_id_fkey"
            columns: ["settlement_item_id"]
            isOneToOne: false
            referencedRelation: "courier_settlement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlement_discrepancies_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "courier_settlement_discrepancies_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_settlement_items: {
        Row: {
          actual_collected_amount: number | null
          cod_charge: number | null
          created_at: string
          delivery_charge: number | null
          eligibility_reason: string | null
          expected_cod_fee: number
          expected_collected_amount: number
          expected_delivery_fee: number
          expected_net_amount: number
          expected_other_charge: number
          expected_return_charge: number
          id: string
          net_settlement_amount: number | null
          order_id: string
          other_charge: number | null
          reconciled_at: string | null
          return_charge: number | null
          settlement_id: string
          shipment_id: string
          updated_at: string
        }
        Insert: {
          actual_collected_amount?: number | null
          cod_charge?: number | null
          created_at?: string
          delivery_charge?: number | null
          eligibility_reason?: string | null
          expected_cod_fee?: number
          expected_collected_amount?: number
          expected_delivery_fee?: number
          expected_net_amount?: number
          expected_other_charge?: number
          expected_return_charge?: number
          id?: string
          net_settlement_amount?: number | null
          order_id: string
          other_charge?: number | null
          reconciled_at?: string | null
          return_charge?: number | null
          settlement_id: string
          shipment_id: string
          updated_at?: string
        }
        Update: {
          actual_collected_amount?: number | null
          cod_charge?: number | null
          created_at?: string
          delivery_charge?: number | null
          eligibility_reason?: string | null
          expected_cod_fee?: number
          expected_collected_amount?: number
          expected_delivery_fee?: number
          expected_net_amount?: number
          expected_other_charge?: number
          expected_return_charge?: number
          id?: string
          net_settlement_amount?: number | null
          order_id?: string
          other_charge?: number | null
          reconciled_at?: string | null
          return_charge?: number | null
          settlement_id?: string
          shipment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_settlement_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "courier_settlement_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "courier_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_settlement_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "courier_settlement_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_settlements: {
        Row: {
          actual_amount: number | null
          courier_account_id: string
          created_at: string
          created_by: string | null
          expected_amount: number
          finalized_at: string | null
          finalized_by: string | null
          id: string
          notes: string | null
          settlement_date: string | null
          settlement_reference: string
          status: Database["public"]["Enums"]["courier_settlement_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_amount?: number | null
          courier_account_id: string
          created_at?: string
          created_by?: string | null
          expected_amount?: number
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          notes?: string | null
          settlement_date?: string | null
          settlement_reference: string
          status?: Database["public"]["Enums"]["courier_settlement_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_amount?: number | null
          courier_account_id?: string
          created_at?: string
          created_by?: string | null
          expected_amount?: number
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          notes?: string | null
          settlement_date?: string | null
          settlement_reference?: string
          status?: Database["public"]["Enums"]["courier_settlement_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_settlements_courier_account_id_fkey"
            columns: ["courier_account_id"]
            isOneToOne: false
            referencedRelation: "courier_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_statement_imports: {
        Row: {
          ambiguous_rows: number
          applied_rows: number
          confirmed_at: string | null
          confirmed_by: string | null
          conflict_rows: number
          courier_account_id: string
          created_at: string
          duplicate_rows: number
          id: string
          imported_by: string | null
          invalid_rows: number
          matched_rows: number
          period_end: string | null
          period_start: string | null
          provider_id: string
          settlement_id: string | null
          source_name: string | null
          statement_reference: string
          status: string
          total_rows: number
          unmatched_rows: number
          updated_at: string
        }
        Insert: {
          ambiguous_rows?: number
          applied_rows?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          conflict_rows?: number
          courier_account_id: string
          created_at?: string
          duplicate_rows?: number
          id?: string
          imported_by?: string | null
          invalid_rows?: number
          matched_rows?: number
          period_end?: string | null
          period_start?: string | null
          provider_id: string
          settlement_id?: string | null
          source_name?: string | null
          statement_reference: string
          status?: string
          total_rows?: number
          unmatched_rows?: number
          updated_at?: string
        }
        Update: {
          ambiguous_rows?: number
          applied_rows?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          conflict_rows?: number
          courier_account_id?: string
          created_at?: string
          duplicate_rows?: number
          id?: string
          imported_by?: string | null
          invalid_rows?: number
          matched_rows?: number
          period_end?: string | null
          period_start?: string | null
          provider_id?: string
          settlement_id?: string | null
          source_name?: string | null
          statement_reference?: string
          status?: string
          total_rows?: number
          unmatched_rows?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_statement_imports_courier_account_id_fkey"
            columns: ["courier_account_id"]
            isOneToOne: false
            referencedRelation: "courier_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_statement_imports_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "courier_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_statement_imports_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "courier_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_statement_rows: {
        Row: {
          applied_at: string | null
          cod_fee: number | null
          collected_amount: number | null
          consignment_id: string | null
          created_at: string
          delivery_fee: number | null
          id: string
          import_id: string
          match_note: string | null
          match_status: string
          merchant_order_reference: string | null
          net_amount: number | null
          other_charge: number | null
          provider_status: string | null
          raw_row: Json | null
          return_charge: number | null
          row_fingerprint: string
          row_number: number
          settlement_item_id: string | null
          shipment_id: string | null
        }
        Insert: {
          applied_at?: string | null
          cod_fee?: number | null
          collected_amount?: number | null
          consignment_id?: string | null
          created_at?: string
          delivery_fee?: number | null
          id?: string
          import_id: string
          match_note?: string | null
          match_status?: string
          merchant_order_reference?: string | null
          net_amount?: number | null
          other_charge?: number | null
          provider_status?: string | null
          raw_row?: Json | null
          return_charge?: number | null
          row_fingerprint: string
          row_number: number
          settlement_item_id?: string | null
          shipment_id?: string | null
        }
        Update: {
          applied_at?: string | null
          cod_fee?: number | null
          collected_amount?: number | null
          consignment_id?: string | null
          created_at?: string
          delivery_fee?: number | null
          id?: string
          import_id?: string
          match_note?: string | null
          match_status?: string
          merchant_order_reference?: string | null
          net_amount?: number | null
          other_charge?: number | null
          provider_status?: string | null
          raw_row?: Json | null
          return_charge?: number | null
          row_fingerprint?: string
          row_number?: number
          settlement_item_id?: string | null
          shipment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_statement_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "courier_statement_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_statement_rows_settlement_item_id_fkey"
            columns: ["settlement_item_id"]
            isOneToOne: false
            referencedRelation: "courier_settlement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_statement_rows_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "courier_statement_rows_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
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
      courier_tracking_polls: {
        Row: {
          attempts: number
          consecutive_failures: number
          created_at: string
          last_error: string | null
          last_polled_at: string | null
          lease_token: string | null
          lease_until: string | null
          next_poll_at: string
          shipment_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          consecutive_failures?: number
          created_at?: string
          last_error?: string | null
          last_polled_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_poll_at?: string
          shipment_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          consecutive_failures?: number
          created_at?: string
          last_error?: string | null
          last_polled_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_poll_at?: string
          shipment_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "courier_tracking_polls_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "courier_tracking_polls_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_manual_flags: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          flag: Database["public"]["Enums"]["customer_manual_flag_type"]
          id: string
          is_active: boolean
          reason: string
          updated_at: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          flag: Database["public"]["Enums"]["customer_manual_flag_type"]
          id?: string
          is_active?: boolean
          reason: string
          updated_at?: string
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          flag?: Database["public"]["Enums"]["customer_manual_flag_type"]
          id?: string
          is_active?: boolean
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_manual_flags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notes: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          note: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          note: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          block_reason: string | null
          blocked_at: string | null
          blocked_by: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          primary_phone: string
          primary_phone_normalized: string | null
          secondary_phone: string | null
          secondary_phone_normalized: string | null
          status: Database["public"]["Enums"]["customer_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          block_reason?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          primary_phone: string
          primary_phone_normalized?: string | null
          secondary_phone?: string | null
          secondary_phone_normalized?: string | null
          status?: Database["public"]["Enums"]["customer_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          block_reason?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          primary_phone?: string
          primary_phone_normalized?: string | null
          secondary_phone?: string | null
          secondary_phone_normalized?: string | null
          status?: Database["public"]["Enums"]["customer_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      external_entity_mappings: {
        Row: {
          created_at: string
          entity_type: Database["public"]["Enums"]["external_entity_type"]
          external_id: string
          external_reference: string | null
          id: string
          internal_id: string
          payload_fingerprint: string | null
          sales_channel_account_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: Database["public"]["Enums"]["external_entity_type"]
          external_id: string
          external_reference?: string | null
          id?: string
          internal_id: string
          payload_fingerprint?: string | null
          sales_channel_account_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: Database["public"]["Enums"]["external_entity_type"]
          external_id?: string
          external_reference?: string | null
          id?: string
          internal_id?: string
          payload_fingerprint?: string | null
          sales_channel_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_entity_mappings_sales_channel_account_id_fkey"
            columns: ["sales_channel_account_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_items: {
        Row: {
          created_at: string
          goods_receipt_id: string
          id: string
          notes: string | null
          purchase_order_item_id: string
          quantity_accepted: number
          quantity_damaged: number
          quantity_received: number
          unit_cost_snapshot: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          goods_receipt_id: string
          id?: string
          notes?: string | null
          purchase_order_item_id: string
          quantity_accepted?: number
          quantity_damaged?: number
          quantity_received: number
          unit_cost_snapshot: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          goods_receipt_id?: string
          id?: string
          notes?: string | null
          purchase_order_item_id?: string
          quantity_accepted?: number
          quantity_damaged?: number
          quantity_received?: number
          unit_cost_snapshot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_items_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_items_purchase_order_item_id_fkey"
            columns: ["purchase_order_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inventory_location_id: string
          notes: string | null
          purchase_order_id: string
          receipt_number: string
          received_at: string | null
          received_by: string | null
          reversal_reason: string | null
          reversed_at: string | null
          status: Database["public"]["Enums"]["goods_receipt_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_location_id: string
          notes?: string | null
          purchase_order_id: string
          receipt_number: string
          received_at?: string | null
          received_by?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          status?: Database["public"]["Enums"]["goods_receipt_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_location_id?: string
          notes?: string | null
          purchase_order_id?: string
          receipt_number?: string
          received_at?: string | null
          received_by?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          status?: Database["public"]["Enums"]["goods_receipt_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_inventory_location_id_fkey"
            columns: ["inventory_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
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
          damaged_after: number | null
          damaged_before: number | null
          id: string
          incoming_after: number | null
          incoming_before: number | null
          inventory_level_id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note: string | null
          on_hand_after: number | null
          on_hand_before: number | null
          quantity: number
          reason:
            | Database["public"]["Enums"]["inventory_adjustment_reason"]
            | null
          reference_id: string | null
          reference_type: string | null
          reserved_after: number | null
          reserved_before: number | null
          seq: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          damaged_after?: number | null
          damaged_before?: number | null
          id?: string
          incoming_after?: number | null
          incoming_before?: number | null
          inventory_level_id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string | null
          on_hand_after?: number | null
          on_hand_before?: number | null
          quantity: number
          reason?:
            | Database["public"]["Enums"]["inventory_adjustment_reason"]
            | null
          reference_id?: string | null
          reference_type?: string | null
          reserved_after?: number | null
          reserved_before?: number | null
          seq?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          damaged_after?: number | null
          damaged_before?: number | null
          id?: string
          incoming_after?: number | null
          incoming_before?: number | null
          inventory_level_id?: string
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string | null
          on_hand_after?: number | null
          on_hand_before?: number | null
          quantity?: number
          reason?:
            | Database["public"]["Enums"]["inventory_adjustment_reason"]
            | null
          reference_id?: string | null
          reference_type?: string | null
          reserved_after?: number | null
          reserved_before?: number | null
          seq?: number
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
          committed_quantity: number
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
          committed_quantity?: number
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
          committed_quantity?: number
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
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
      inventory_transfer_items: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          product_name_snapshot: string
          received_quantity: number
          requested_quantity: number
          shipped_quantity: number
          sku_snapshot: string | null
          transfer_id: string
          updated_at: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name_snapshot: string
          received_quantity?: number
          requested_quantity: number
          shipped_quantity?: number
          sku_snapshot?: string | null
          transfer_id: string
          updated_at?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name_snapshot?: string
          received_quantity?: number
          requested_quantity?: number
          shipped_quantity?: number
          sku_snapshot?: string | null
          transfer_id?: string
          updated_at?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "inventory_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transfers: {
        Row: {
          approved_by: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          from_location_id: string
          id: string
          notes: string | null
          received_at: string | null
          received_by: string | null
          reference_number: string
          status: Database["public"]["Enums"]["inventory_transfer_status"]
          to_location_id: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          from_location_id: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          reference_number: string
          status?: Database["public"]["Enums"]["inventory_transfer_status"]
          to_location_id: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          from_location_id?: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          reference_number?: string
          status?: Database["public"]["Enums"]["inventory_transfer_status"]
          to_location_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_assignment_events: {
        Row: {
          actor_id: string | null
          assigned_to: string | null
          assignment_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["operation_assignment_event_type"]
          id: string
          note: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["operation_source_type"]
        }
        Insert: {
          actor_id?: string | null
          assigned_to?: string | null
          assignment_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["operation_assignment_event_type"]
          id?: string
          note?: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["operation_source_type"]
        }
        Update: {
          actor_id?: string | null
          assigned_to?: string | null
          assignment_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["operation_assignment_event_type"]
          id?: string
          note?: string | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["operation_source_type"]
        }
        Relationships: [
          {
            foreignKeyName: "operational_assignment_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "operational_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          assigned_to: string
          created_at: string
          id: string
          note: string | null
          released_at: string | null
          released_by: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["operation_source_type"]
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_to: string
          created_at?: string
          id?: string
          note?: string | null
          released_at?: string | null
          released_by?: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["operation_source_type"]
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_to?: string
          created_at?: string
          id?: string
          note?: string | null
          released_at?: string | null
          released_by?: string | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["operation_source_type"]
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_addresses_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_financial_adjustments: {
        Row: {
          adjustment_type: Database["public"]["Enums"]["financial_adjustment_type"]
          amount: number
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["financial_adjustment_direction"]
          id: string
          order_id: string
          reason: string | null
          reference: string | null
          return_id: string | null
          reversal_of: string | null
          reversed_at: string | null
          reversed_by: string | null
          settlement_id: string | null
          shipment_id: string | null
        }
        Insert: {
          adjustment_type: Database["public"]["Enums"]["financial_adjustment_type"]
          amount: number
          created_at?: string
          created_by?: string | null
          direction: Database["public"]["Enums"]["financial_adjustment_direction"]
          id?: string
          order_id: string
          reason?: string | null
          reference?: string | null
          return_id?: string | null
          reversal_of?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          settlement_id?: string | null
          shipment_id?: string | null
        }
        Update: {
          adjustment_type?: Database["public"]["Enums"]["financial_adjustment_type"]
          amount?: number
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["financial_adjustment_direction"]
          id?: string
          order_id?: string
          reason?: string | null
          reference?: string | null
          return_id?: string | null
          reversal_of?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          settlement_id?: string | null
          shipment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_financial_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_financial_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_financial_adjustments_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "order_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_financial_adjustments_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "order_financial_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_financial_adjustments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "order_financial_adjustments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
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
          inventory_committed_at: string | null
          inventory_committed_by: string | null
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
          inventory_committed_at?: string | null
          inventory_committed_by?: string | null
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
          inventory_committed_at?: string | null
          inventory_committed_by?: string | null
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
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
          cost_source: string | null
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
          unit_additional_cost: number | null
          unit_base_cost: number | null
          unit_cost: number | null
          unit_price: number
          variant_id: string | null
          variant_name: string | null
        }
        Insert: {
          compare_at_price?: number | null
          cost_source?: string | null
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
          unit_additional_cost?: number | null
          unit_base_cost?: number | null
          unit_cost?: number | null
          unit_price: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Update: {
          compare_at_price?: number | null
          cost_source?: string | null
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
          unit_additional_cost?: number | null
          unit_base_cost?: number | null
          unit_cost?: number | null
          unit_price?: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
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
          received_recorded_at: string | null
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
          received_recorded_at?: string | null
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
          received_recorded_at?: string | null
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
          financial_outcome: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at: string | null
          financial_recorded_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          refund_adjustment_id: string | null
          refund_amount: number
          requested_at: string
          resolution_note: string | null
          restocked_at: string | null
          restocked_by: string | null
          retained_amount: number
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
          financial_outcome?: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at?: string | null
          financial_recorded_by?: string | null
          id?: string
          initiated_at?: string | null
          inspected_at?: string | null
          notes?: string | null
          order_id: string
          reason?: string | null
          received_at?: string | null
          refund_adjustment_id?: string | null
          refund_amount?: number
          requested_at?: string
          resolution_note?: string | null
          restocked_at?: string | null
          restocked_by?: string | null
          retained_amount?: number
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
          financial_outcome?: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at?: string | null
          financial_recorded_by?: string | null
          id?: string
          initiated_at?: string | null
          inspected_at?: string | null
          notes?: string | null
          order_id?: string
          reason?: string | null
          received_at?: string | null
          refund_adjustment_id?: string | null
          refund_amount?: number
          requested_at?: string
          resolution_note?: string | null
          restocked_at?: string | null
          restocked_by?: string | null
          retained_amount?: number
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
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
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
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
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
          customer_id?: string | null
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
          refunded_amount?: number
          reservation_status?: Database["public"]["Enums"]["reservation_status"]
          reserved_at?: string | null
          risk_level?: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason?: string | null
          shipping_charge?: number
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string | null
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
          customer_id?: string | null
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
          refunded_amount?: number
          reservation_status?: Database["public"]["Enums"]["reservation_status"]
          reserved_at?: string | null
          risk_level?: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason?: string | null
          shipping_charge?: number
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string | null
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
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_fulfillment_location_id_fkey"
            columns: ["fulfillment_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
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
      product_cost_history: {
        Row: {
          cost_type: Database["public"]["Enums"]["item_cost_type"]
          created_at: string
          created_by: string | null
          effective_at: string
          id: string
          new_cost: number
          note: string | null
          previous_cost: number | null
          product_id: string | null
          source_id: string | null
          source_type: Database["public"]["Enums"]["cost_change_source"]
          variant_id: string | null
        }
        Insert: {
          cost_type?: Database["public"]["Enums"]["item_cost_type"]
          created_at?: string
          created_by?: string | null
          effective_at?: string
          id?: string
          new_cost: number
          note?: string | null
          previous_cost?: number | null
          product_id?: string | null
          source_id?: string | null
          source_type: Database["public"]["Enums"]["cost_change_source"]
          variant_id?: string | null
        }
        Update: {
          cost_type?: Database["public"]["Enums"]["item_cost_type"]
          created_at?: string
          created_by?: string | null
          effective_at?: string
          id?: string
          new_cost?: number
          note?: string | null
          previous_cost?: number | null
          product_id?: string | null
          source_id?: string | null
          source_type?: Database["public"]["Enums"]["cost_change_source"]
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_cost_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cost_history_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
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
      purchase_order_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: Database["public"]["Enums"]["purchase_order_event_type"]
          from_status:
            | Database["public"]["Enums"]["purchase_order_status"]
            | null
          id: string
          message: string
          metadata: Json | null
          purchase_order_id: string
          to_status: Database["public"]["Enums"]["purchase_order_status"] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: Database["public"]["Enums"]["purchase_order_event_type"]
          from_status?:
            | Database["public"]["Enums"]["purchase_order_status"]
            | null
          id?: string
          message: string
          metadata?: Json | null
          purchase_order_id: string
          to_status?:
            | Database["public"]["Enums"]["purchase_order_status"]
            | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["purchase_order_event_type"]
          from_status?:
            | Database["public"]["Enums"]["purchase_order_status"]
            | null
          id?: string
          message?: string
          metadata?: Json | null
          purchase_order_id?: string
          to_status?:
            | Database["public"]["Enums"]["purchase_order_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_events_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string
          discount_amount: number
          id: string
          line_total: number | null
          product_id: string | null
          product_name_snapshot: string
          purchase_order_id: string
          quantity_ordered: number
          quantity_received: number
          sku_snapshot: string | null
          sort_order: number
          tax_amount: number
          unit_cost: number
          updated_at: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          id?: string
          line_total?: number | null
          product_id?: string | null
          product_name_snapshot: string
          purchase_order_id: string
          quantity_ordered: number
          quantity_received?: number
          sku_snapshot?: string | null
          sort_order?: number
          tax_amount?: number
          unit_cost: number
          updated_at?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          created_at?: string
          discount_amount?: number
          id?: string
          line_total?: number | null
          product_id?: string | null
          product_name_snapshot?: string
          purchase_order_id?: string
          quantity_ordered?: number
          quantity_received?: number
          sku_snapshot?: string | null
          sort_order?: number
          tax_amount?: number
          unit_cost?: number
          updated_at?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          discount_total: number
          duty_cost: number
          exchange_rate: number | null
          expected_delivery_date: string | null
          grand_total: number
          id: string
          notes: string | null
          order_date: string
          ordered_at: string | null
          other_cost: number
          purchase_order_number: string
          shipping_cost: number
          status: Database["public"]["Enums"]["purchase_order_status"]
          submitted_at: string | null
          subtotal: number
          supplier_code_snapshot: string | null
          supplier_id: string
          supplier_name_snapshot: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_total?: number
          duty_cost?: number
          exchange_rate?: number | null
          expected_delivery_date?: string | null
          grand_total?: number
          id?: string
          notes?: string | null
          order_date?: string
          ordered_at?: string | null
          other_cost?: number
          purchase_order_number: string
          shipping_cost?: number
          status?: Database["public"]["Enums"]["purchase_order_status"]
          submitted_at?: string | null
          subtotal?: number
          supplier_code_snapshot?: string | null
          supplier_id: string
          supplier_name_snapshot?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_total?: number
          duty_cost?: number
          exchange_rate?: number | null
          expected_delivery_date?: string | null
          grand_total?: number
          id?: string
          notes?: string | null
          order_date?: string
          ordered_at?: string | null
          other_cost?: number
          purchase_order_number?: string
          shipping_cost?: number
          status?: Database["public"]["Enums"]["purchase_order_status"]
          submitted_at?: string | null
          subtotal?: number
          supplier_code_snapshot?: string | null
          supplier_id?: string
          supplier_name_snapshot?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      role_change_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          reason: string | null
          role_from: Database["public"]["Enums"]["app_role"] | null
          role_to: Database["public"]["Enums"]["app_role"] | null
          target_user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          role_from?: Database["public"]["Enums"]["app_role"] | null
          role_to?: Database["public"]["Enums"]["app_role"] | null
          target_user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          role_from?: Database["public"]["Enums"]["app_role"] | null
          role_to?: Database["public"]["Enums"]["app_role"] | null
          target_user_id?: string
        }
        Relationships: []
      }
      sales_channel_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          environment: Database["public"]["Enums"]["sales_channel_environment"]
          external_store_id: string | null
          external_store_name: string | null
          id: string
          last_error: string | null
          last_successful_sync_at: string | null
          last_sync_at: string | null
          name: string
          provider: Database["public"]["Enums"]["sales_channel_provider"]
          status: Database["public"]["Enums"]["sales_channel_status"]
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment?: Database["public"]["Enums"]["sales_channel_environment"]
          external_store_id?: string | null
          external_store_name?: string | null
          id?: string
          last_error?: string | null
          last_successful_sync_at?: string | null
          last_sync_at?: string | null
          name: string
          provider: Database["public"]["Enums"]["sales_channel_provider"]
          status?: Database["public"]["Enums"]["sales_channel_status"]
          store_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment?: Database["public"]["Enums"]["sales_channel_environment"]
          external_store_id?: string | null
          external_store_name?: string | null
          id?: string
          last_error?: string | null
          last_successful_sync_at?: string | null
          last_sync_at?: string | null
          name?: string
          provider?: Database["public"]["Enums"]["sales_channel_provider"]
          status?: Database["public"]["Enums"]["sales_channel_status"]
          store_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_channel_accounts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channel_credentials: {
        Row: {
          account_id: string
          api_version: string
          consumer_key: string | null
          consumer_secret: string | null
          created_at: string
          site_url: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          account_id: string
          api_version?: string
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          site_url?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          account_id?: string
          api_version?: string
          consumer_key?: string | null
          consumer_secret?: string | null
          created_at?: string
          site_url?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_channel_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "sales_channel_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channel_product_listings: {
        Row: {
          created_at: string
          created_by: string | null
          external_product_id: string | null
          external_sku: string | null
          external_url: string | null
          external_variant_reference: string | null
          id: string
          last_operation: string | null
          last_success_at: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          listing_status: Database["public"]["Enums"]["channel_listing_status"]
          sales_channel_account_id: string
          store_product_id: string
          sync_started_at: string | null
          synced_content_hash: string | null
          synced_price: number | null
          synced_qty: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          external_url?: string | null
          external_variant_reference?: string | null
          id?: string
          last_operation?: string | null
          last_success_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          listing_status?: Database["public"]["Enums"]["channel_listing_status"]
          sales_channel_account_id: string
          store_product_id: string
          sync_started_at?: string | null
          synced_content_hash?: string | null
          synced_price?: number | null
          synced_qty?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          external_url?: string | null
          external_variant_reference?: string | null
          id?: string
          last_operation?: string | null
          last_success_at?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          listing_status?: Database["public"]["Enums"]["channel_listing_status"]
          sales_channel_account_id?: string
          store_product_id?: string
          sync_started_at?: string | null
          synced_content_hash?: string | null
          synced_price?: number | null
          synced_qty?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_channel_product_listings_sales_channel_account_id_fkey"
            columns: ["sales_channel_account_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_product_listings_store_product_id_fkey"
            columns: ["store_product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channel_sync_jobs: {
        Row: {
          attempts: number
          available_at: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          depends_on_job_id: string | null
          failure_class:
            | Database["public"]["Enums"]["sync_failure_class"]
            | null
          final_failed_at: string | null
          first_failed_at: string | null
          id: string
          job_type: string
          last_attempt_at: string | null
          last_error: string | null
          last_run_id: string | null
          lease_expires_at: string | null
          lease_token: string | null
          listing_id: string | null
          max_attempts: number
          operation: Database["public"]["Enums"]["sales_channel_sync_type"]
          priority: number
          retry_after: string | null
          sales_channel_account_id: string | null
          source: string
          source_reference: string | null
          status: Database["public"]["Enums"]["sync_job_status"]
          store_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          depends_on_job_id?: string | null
          failure_class?:
            | Database["public"]["Enums"]["sync_failure_class"]
            | null
          final_failed_at?: string | null
          first_failed_at?: string | null
          id?: string
          job_type?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_run_id?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          listing_id?: string | null
          max_attempts?: number
          operation: Database["public"]["Enums"]["sales_channel_sync_type"]
          priority?: number
          retry_after?: string | null
          sales_channel_account_id?: string | null
          source?: string
          source_reference?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
          store_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          depends_on_job_id?: string | null
          failure_class?:
            | Database["public"]["Enums"]["sync_failure_class"]
            | null
          final_failed_at?: string | null
          first_failed_at?: string | null
          id?: string
          job_type?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_run_id?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          listing_id?: string | null
          max_attempts?: number
          operation?: Database["public"]["Enums"]["sales_channel_sync_type"]
          priority?: number
          retry_after?: string | null
          sales_channel_account_id?: string | null
          source?: string
          source_reference?: string | null
          status?: Database["public"]["Enums"]["sync_job_status"]
          store_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_channel_sync_jobs_depends_on_job_id_fkey"
            columns: ["depends_on_job_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_sync_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_sync_jobs_job_type_fkey"
            columns: ["job_type"]
            isOneToOne: false
            referencedRelation: "background_job_types"
            referencedColumns: ["job_type"]
          },
          {
            foreignKeyName: "sales_channel_sync_jobs_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_sync_jobs_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_product_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_sync_jobs_sales_channel_account_id_fkey"
            columns: ["sales_channel_account_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_sync_jobs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channel_sync_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_summary: string | null
          id: string
          initiated_by: string | null
          listing_id: string | null
          records_created: number
          records_failed: number
          records_fetched: number
          records_skipped: number
          records_updated: number
          sales_channel_account_id: string
          started_at: string
          status: Database["public"]["Enums"]["sales_channel_sync_status"]
          sync_type: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_summary?: string | null
          id?: string
          initiated_by?: string | null
          listing_id?: string | null
          records_created?: number
          records_failed?: number
          records_fetched?: number
          records_skipped?: number
          records_updated?: number
          sales_channel_account_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["sales_channel_sync_status"]
          sync_type: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_summary?: string | null
          id?: string
          initiated_by?: string | null
          listing_id?: string | null
          records_created?: number
          records_failed?: number
          records_fetched?: number
          records_skipped?: number
          records_updated?: number
          sales_channel_account_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["sales_channel_sync_status"]
          sync_type?: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        Relationships: [
          {
            foreignKeyName: "sales_channel_sync_runs_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_product_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_channel_sync_runs_sales_channel_account_id_fkey"
            columns: ["sales_channel_account_id"]
            isOneToOne: false
            referencedRelation: "sales_channel_accounts"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
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
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
          },
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
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
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
          damaged_quantity: number
          delivered_quantity: number
          fulfillment_item_id: string | null
          id: string
          lost_quantity: number
          order_item_id: string
          quantity: number
          refused_quantity: number
          shipment_id: string
        }
        Insert: {
          created_at?: string
          damaged_quantity?: number
          delivered_quantity?: number
          fulfillment_item_id?: string | null
          id?: string
          lost_quantity?: number
          order_item_id: string
          quantity: number
          refused_quantity?: number
          shipment_id: string
        }
        Update: {
          created_at?: string
          damaged_quantity?: number
          delivered_quantity?: number
          fulfillment_item_id?: string | null
          id?: string
          lost_quantity?: number
          order_item_id?: string
          quantity?: number
          refused_quantity?: number
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
            referencedRelation: "shipment_profit_rollup"
            referencedColumns: ["shipment_id"]
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
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
          actual_delivery_fee?: number | null
          booked_at?: string | null
          booked_delivery_fee?: number | null
          booking_attempt_count?: number
          booking_attempt_started_at?: string | null
          booking_idempotency_key?: string
          booking_last_error?: string | null
          booking_outcome_unknown?: boolean
          booking_snapshot?: Json | null
          cancelled_at?: string | null
          cash_on_delivery_amount?: number
          cod_fee?: number | null
          collected_amount?: number | null
          courier_account_id?: string | null
          created_at?: string
          created_by?: string | null
          declared_value?: number | null
          delivered_at?: string | null
          delivery_address: string
          delivery_area?: string | null
          delivery_city?: string | null
          delivery_outcome_fingerprint?: string | null
          delivery_outcome_recorded_at?: string | null
          delivery_outcome_recorded_by?: string | null
          delivery_zone?: string | null
          external_consignment_id?: string | null
          failure_reason?:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at?: string | null
          financials_recorded_by?: string | null
          fulfillment_id?: string | null
          hold_reason?:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id?: string
          internal_notes?: string | null
          last_synced_at?: string | null
          notes?: string | null
          order_id: string
          other_courier_charge?: number | null
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
          return_charge?: number | null
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
          actual_delivery_fee?: number | null
          booked_at?: string | null
          booked_delivery_fee?: number | null
          booking_attempt_count?: number
          booking_attempt_started_at?: string | null
          booking_idempotency_key?: string
          booking_last_error?: string | null
          booking_outcome_unknown?: boolean
          booking_snapshot?: Json | null
          cancelled_at?: string | null
          cash_on_delivery_amount?: number
          cod_fee?: number | null
          collected_amount?: number | null
          courier_account_id?: string | null
          created_at?: string
          created_by?: string | null
          declared_value?: number | null
          delivered_at?: string | null
          delivery_address?: string
          delivery_area?: string | null
          delivery_city?: string | null
          delivery_outcome_fingerprint?: string | null
          delivery_outcome_recorded_at?: string | null
          delivery_outcome_recorded_by?: string | null
          delivery_zone?: string | null
          external_consignment_id?: string | null
          failure_reason?:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at?: string | null
          financials_recorded_by?: string | null
          fulfillment_id?: string | null
          hold_reason?:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id?: string
          internal_notes?: string | null
          last_synced_at?: string | null
          notes?: string | null
          order_id?: string
          other_courier_charge?: number | null
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
          return_charge?: number | null
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
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
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
      stocktake_items: {
        Row: {
          applied_delta: number | null
          counted_quantity: number | null
          created_at: string
          id: string
          inventory_level_id: string
          note: string | null
          product_id: string | null
          product_name_snapshot: string
          sku_snapshot: string | null
          stocktake_id: string
          system_quantity: number
          updated_at: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          applied_delta?: number | null
          counted_quantity?: number | null
          created_at?: string
          id?: string
          inventory_level_id: string
          note?: string | null
          product_id?: string | null
          product_name_snapshot: string
          sku_snapshot?: string | null
          stocktake_id: string
          system_quantity: number
          updated_at?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          applied_delta?: number | null
          counted_quantity?: number | null
          created_at?: string
          id?: string
          inventory_level_id?: string
          note?: string | null
          product_id?: string | null
          product_name_snapshot?: string
          sku_snapshot?: string | null
          stocktake_id?: string
          system_quantity?: number
          updated_at?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_items_inventory_level_id_fkey"
            columns: ["inventory_level_id"]
            isOneToOne: false
            referencedRelation: "inventory_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_stocktake_id_fkey"
            columns: ["stocktake_id"]
            isOneToOne: false
            referencedRelation: "stocktakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktakes: {
        Row: {
          cancel_reason: string | null
          cancelled_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          notes: string | null
          reference_number: string
          started_at: string | null
          status: Database["public"]["Enums"]["stocktake_status"]
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          notes?: string | null
          reference_number: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["stocktake_status"]
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          reference_number?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["stocktake_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stocktakes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      store_product_price_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_price: number
          previous_price: number | null
          reason: string | null
          store_product_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_price: number
          previous_price?: number | null
          reason?: string | null
          store_product_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_price?: number
          previous_price?: number | null
          reason?: string | null
          store_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_product_price_history_store_product_id_fkey"
            columns: ["store_product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      store_products: {
        Row: {
          activated_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          description_override: string | null
          id: string
          product_id: string
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_id: string
          store_sku: string | null
          title_override: string | null
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }
        Insert: {
          activated_at?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description_override?: string | null
          id?: string
          product_id: string
          selling_price: number
          status?: Database["public"]["Enums"]["store_product_status"]
          store_id: string
          store_sku?: string | null
          title_override?: string | null
          updated_at?: string
          updated_by?: string | null
          visibility?: Database["public"]["Enums"]["store_product_visibility"]
        }
        Update: {
          activated_at?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description_override?: string | null
          id?: string
          product_id?: string
          selling_price?: number
          status?: Database["public"]["Enums"]["store_product_status"]
          store_id?: string
          store_sku?: string | null
          title_override?: string | null
          updated_at?: string
          updated_by?: string | null
          visibility?: Database["public"]["Enums"]["store_product_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "store_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          code: string
          country: string
          created_at: string
          created_by: string | null
          currency: string
          default_warehouse_id: string | null
          id: string
          name: string
          order_number_prefix: string | null
          slug: string
          status: Database["public"]["Enums"]["store_status"]
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          default_warehouse_id?: string | null
          id?: string
          name: string
          order_number_prefix?: string | null
          slug: string
          status?: Database["public"]["Enums"]["store_status"]
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          default_warehouse_id?: string | null
          id?: string
          name?: string
          order_number_prefix?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["store_status"]
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_default_warehouse_id_fkey"
            columns: ["default_warehouse_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          name: string
          notes: string | null
          phone: string | null
          role: string | null
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contacts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_preferred: boolean
          last_purchase_cost: number | null
          lead_time_days: number | null
          minimum_order_quantity: number
          notes: string | null
          product_id: string | null
          supplier_id: string
          supplier_product_name: string | null
          supplier_sku: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_preferred?: boolean
          last_purchase_cost?: number | null
          lead_time_days?: number | null
          minimum_order_quantity?: number
          notes?: string | null
          product_id?: string | null
          supplier_id: string
          supplier_product_name?: string | null
          supplier_sku?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_preferred?: boolean
          last_purchase_cost?: number | null
          lead_time_days?: number | null
          minimum_order_quantity?: number
          notes?: string | null
          product_id?: string | null
          supplier_id?: string
          supplier_product_name?: string | null
          supplier_sku?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          city: string | null
          contact_person: string | null
          country: string
          created_at: string
          created_by: string | null
          default_currency: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          status: Database["public"]["Enums"]["entity_status"]
          supplier_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_person?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          default_currency?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          supplier_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_person?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          default_currency?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          supplier_code?: string
          updated_at?: string
          updated_by?: string | null
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
      order_financial_rollup: {
        Row: {
          actual_delivery_cost: number | null
          actual_packing_cost: number | null
          actual_product_cost: number | null
          actual_profit: number | null
          adjustment_expense: number | null
          adjustment_income: number | null
          cod_fees: number | null
          collected_amount: number | null
          completeness: string | null
          cost_snapshot_complete: boolean | null
          created_at: string | null
          customer_id: string | null
          est_delivery_cost: number | null
          est_product_cost: number | null
          estimated_profit: number | null
          grand_total: number | null
          open_discrepancies: number | null
          open_discrepancy_amount: number | null
          order_discount: number | null
          order_id: string | null
          other_courier_charges: number | null
          packing_charge: number | null
          product_discount: number | null
          refunded_amount: number | null
          retained_amount: number | null
          return_charges: number | null
          returned_units: number | null
          shipment_count: number | null
          shipments_with_collection: number | null
          shipments_with_fee: number | null
          shipped_units: number | null
          shipping_charge: number | null
          source: Database["public"]["Enums"]["order_source"] | null
          status: Database["public"]["Enums"]["order_status"] | null
          subtotal: number | null
          units: number | null
          unresolved_returns: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_profit_rollup: {
        Row: {
          accepted_return_units: number | null
          actual_delivery_fee: number | null
          cod_fee: number | null
          collected_amount: number | null
          consumed_line_cost: number | null
          cost_snapshot_complete: boolean | null
          courier_account_id: string | null
          created_at: string | null
          damaged_units: number | null
          declared_return_units: number | null
          delivered_at: string | null
          delivered_line_value: number | null
          delivered_share: number | null
          delivered_units: number | null
          expected_cod: number | null
          expected_delivery_fee: number | null
          lost_units: number | null
          open_discrepancies: number | null
          order_id: string | null
          order_number: string | null
          other_courier_charge: number | null
          provider_id: string | null
          received_return_units: number | null
          recovered_line_cost: number | null
          refused_units: number | null
          return_charge: number | null
          returned_line_value: number | null
          settlement_finalized: boolean | null
          settlement_has_actuals: boolean | null
          settlement_status: string | null
          shipment_adjustment: number | null
          shipment_id: string | null
          shipment_number: string | null
          shipment_status: string | null
          shipped_line_cost: number | null
          shipped_line_value: number | null
          shipped_share: number | null
          shipped_units: number | null
          store_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_courier_account_id_fkey"
            columns: ["courier_account_id"]
            isOneToOne: false
            referencedRelation: "courier_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_financial_rollup"
            referencedColumns: ["order_id"]
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
    }
    Functions: {
      activate_sales_channel_account: {
        Args: { _account_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          environment: Database["public"]["Enums"]["sales_channel_environment"]
          external_store_id: string | null
          external_store_name: string | null
          id: string
          last_error: string | null
          last_successful_sync_at: string | null
          last_sync_at: string | null
          name: string
          provider: Database["public"]["Enums"]["sales_channel_provider"]
          status: Database["public"]["Enums"]["sales_channel_status"]
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      activate_store_product: {
        Args: { _id: string }
        Returns: {
          activated_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          description_override: string | null
          id: string
          product_id: string
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_id: string
          store_sku: string | null
          title_override: string | null
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }
        SetofOptions: {
          from: "*"
          to: "store_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_customer_note: {
        Args: { _customer_id: string; _note: string }
        Returns: {
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          note: string
        }
        SetofOptions: {
          from: "*"
          to: "customer_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_product_to_store: {
        Args: {
          _product_id: string
          _selling_price?: number
          _store_id: string
          _store_sku?: string
        }
        Returns: {
          activated_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          description_override: string | null
          id: string
          product_id: string
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_id: string
          store_sku: string | null
          title_override: string | null
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }
        SetofOptions: {
          from: "*"
          to: "store_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_settlement_item: {
        Args: { _settlement_id: string; _shipment_id: string }
        Returns: {
          actual_collected_amount: number | null
          cod_charge: number | null
          created_at: string
          delivery_charge: number | null
          eligibility_reason: string | null
          expected_cod_fee: number
          expected_collected_amount: number
          expected_delivery_fee: number
          expected_net_amount: number
          expected_other_charge: number
          expected_return_charge: number
          id: string
          net_settlement_amount: number | null
          order_id: string
          other_charge: number | null
          reconciled_at: string | null
          return_charge: number | null
          settlement_id: string
          shipment_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "courier_settlement_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adjust_group_buy_campaign_quantity: {
        Args: { _campaign_id: string; _quantity: number }
        Returns: number
      }
      adjust_inventory: {
        Args: {
          _inventory_level_id: string
          _movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          _note?: string
          _quantity: number
          _reason: Database["public"]["Enums"]["inventory_adjustment_reason"]
        }
        Returns: undefined
      }
      admin_list_users: {
        Args: never
        Returns: {
          avatar_url: string
          full_name: string
          joined_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      admin_revoke_user_role: {
        Args: { _reason?: string; _user_id: string }
        Returns: Json
      }
      admin_set_user_role: {
        Args: {
          _reason?: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: Json
      }
      ai_brain_overview: { Args: never; Returns: Json }
      ai_complete_analysis_run: {
        Args: { _payload: Json; _run_id: string }
        Returns: {
          analysis_type: Database["public"]["Enums"]["ai_analysis_type"]
          completed_at: string | null
          context_summary: Json
          created_at: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string
          error_message: string | null
          id: string
          insight_count: number
          model: string | null
          provider: string | null
          recommendation_count: number
          requested_by: string
          source: string
          started_at: string | null
          status: Database["public"]["Enums"]["ai_run_status"]
          summary: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ai_analysis_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ai_default_insight_ttl: { Args: never; Returns: string }
      ai_fail_analysis_run: {
        Args: { _error: string; _run_id: string }
        Returns: {
          analysis_type: Database["public"]["Enums"]["ai_analysis_type"]
          completed_at: string | null
          context_summary: Json
          created_at: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string
          error_message: string | null
          id: string
          insight_count: number
          model: string | null
          provider: string | null
          recommendation_count: number
          requested_by: string
          source: string
          started_at: string | null
          status: Database["public"]["Enums"]["ai_run_status"]
          summary: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ai_analysis_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ai_insight_freshness: {
        Args: { _insight: Database["public"]["Tables"]["ai_insights"]["Row"] }
        Returns: string
      }
      ai_set_insight_status: {
        Args: {
          _insight_id: string
          _status: Database["public"]["Enums"]["ai_insight_status"]
        }
        Returns: {
          analysis_run_id: string
          category: Database["public"]["Enums"]["ai_insight_category"]
          confidence: number
          created_at: string
          entity_id: string | null
          entity_type: string
          evidence: Json
          expires_at: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          severity: Database["public"]["Enums"]["ai_insight_severity"]
          status: Database["public"]["Enums"]["ai_insight_status"]
          summary: string
          superseded_at: string | null
          superseded_by_run_id: string | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_insights"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ai_set_recommendation_status: {
        Args: {
          _recommendation_id: string
          _status: Database["public"]["Enums"]["ai_recommendation_status"]
        }
        Returns: {
          action_target: string | null
          analysis_run_id: string
          confidence: number
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string
          id: string
          insight_id: string | null
          priority: Database["public"]["Enums"]["ai_recommendation_priority"]
          recommendation_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["ai_recommendation_status"]
          suggested_action: string | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_recommendations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ai_start_analysis_run: {
        Args: {
          _analysis_type: Database["public"]["Enums"]["ai_analysis_type"]
          _context_summary?: Json
          _entity_id?: string
          _entity_type: string
          _model?: string
          _provider?: string
          _source?: string
        }
        Returns: {
          analysis_type: Database["public"]["Enums"]["ai_analysis_type"]
          completed_at: string | null
          context_summary: Json
          created_at: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string
          error_message: string | null
          id: string
          insight_count: number
          model: string | null
          provider: string | null
          recommendation_count: number
          requested_by: string
          source: string
          started_at: string | null
          status: Database["public"]["Enums"]["ai_run_status"]
          summary: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ai_analysis_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      analytics_bucket: {
        Args: { _grain: string; _ts: string }
        Returns: string
      }
      analytics_courier_performance: {
        Args: {
          _account_id?: string
          _from: string
          _provider_id?: string
          _to: string
        }
        Returns: {
          account_id: string
          account_name: string
          avg_actual_cost: number
          avg_delivery_hours: number
          avg_estimated_cost: number
          delivered: number
          failed: number
          partial: number
          provider_id: string
          provider_name: string
          returned: number
          settlement_difference: number
          shipments: number
          shipments_with_actual_cost: number
        }[]
      }
      analytics_customer_trend: {
        Args: { _from: string; _grain?: string; _to: string }
        Returns: {
          active_customers: number
          bucket: string
          new_customers: number
        }[]
      }
      analytics_customers: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      analytics_delivery: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      analytics_guard: {
        Args: { _from: string; _to: string }
        Returns: undefined
      }
      analytics_inventory: { Args: never; Returns: Json }
      analytics_movement_summary: {
        Args: { _from: string; _to: string }
        Returns: {
          category: string
          movement_type: string
          movements: number
          net_quantity: number
          total_quantity: number
        }[]
      }
      analytics_operations_trend: {
        Args: { _from: string; _grain?: string; _to: string }
        Returns: {
          bucket: string
          exceptions: number
          failed_deliveries: number
          returns: number
          stock_adjustments: number
          verification_failures: number
        }[]
      }
      analytics_orders: {
        Args: {
          _from: string
          _source?: Database["public"]["Enums"]["order_source"]
          _store_id?: string
          _to: string
        }
        Returns: Json
      }
      analytics_overview: {
        Args: {
          _from: string
          _source?: Database["public"]["Enums"]["order_source"]
          _store_id?: string
          _to: string
        }
        Returns: Json
      }
      analytics_procurement: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      analytics_product_performance: {
        Args: {
          _from: string
          _limit?: number
          _product_id?: string
          _store_id?: string
          _to: string
        }
        Returns: {
          cost_snapshot_complete: boolean
          courier_cost: number
          estimated_margin: number
          estimated_profit: number
          net_estimated_profit: number
          net_revenue: number
          orders: number
          product_cost: number
          product_id: string
          product_name: string
          realized_margin: number
          realized_product_cost: number
          realized_profit: number
          realized_revenue: number
          return_loss: number
          returned_value: number
          revenue: number
          sku: string
          units_damaged: number
          units_delivered: number
          units_lost: number
          units_ordered: number
          units_refused: number
          units_returned: number
          variant_id: string
          variant_name: string
          variants_grouped: boolean
        }[]
      }
      analytics_profitability: {
        Args: { _from: string; _store_id?: string; _to: string }
        Returns: Json
      }
      analytics_purchased_products: {
        Args: { _from: string; _limit?: number; _to: string }
        Returns: {
          ordered_value: number
          product_id: string
          product_name: string
          quantity_ordered: number
          quantity_received: number
          sku: string
          variant_id: string
        }[]
      }
      analytics_sales_trend: {
        Args: {
          _from: string
          _grain?: string
          _source?: Database["public"]["Enums"]["order_source"]
          _store_id?: string
          _to: string
        }
        Returns: {
          average_order_value: number
          bucket: string
          cancelled_revenue: number
          delivered_revenue: number
          discounts: number
          net_product_revenue: number
          orders: number
          revenue: number
          shipping: number
        }[]
      }
      analytics_stock_risk: {
        Args: { _limit?: number }
        Returns: {
          available: number
          damaged: number
          incoming: number
          level_id: string
          location_name: string
          on_hand: number
          product_id: string
          product_name: string
          risk: string
          threshold: number
          variant_name: string
          variant_sku: string
        }[]
      }
      analytics_store_guard: { Args: { _store_id: string }; Returns: undefined }
      analytics_supplier_spend: {
        Args: { _from: string; _limit?: number; _to: string }
        Returns: {
          ordered_value: number
          purchase_orders: number
          quantity_ordered: number
          quantity_received: number
          received_value: number
          supplier_id: string
          supplier_name: string
        }[]
      }
      analytics_top_customers: {
        Args: { _from: string; _limit?: number; _to: string }
        Returns: {
          customer_id: string
          delivered_orders: number
          name: string
          orders: number
          phone: string
          returned_orders: number
          revenue: number
        }[]
      }
      apply_catalog_cost_update: {
        Args: {
          _new_cost: number
          _note?: string
          _product_id: string
          _source: Database["public"]["Enums"]["cost_change_source"]
          _source_id?: string
          _variant_id: string
        }
        Returns: undefined
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
          _reason?: Database["public"]["Enums"]["inventory_adjustment_reason"]
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
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      archive_store_product: {
        Args: { _id: string }
        Returns: {
          activated_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          description_override: string | null
          id: string
          product_id: string
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_id: string
          store_sku: string | null
          title_override: string | null
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }
        SetofOptions: {
          from: "*"
          to: "store_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_operation_source_exists: {
        Args: {
          _source_id: string
          _source_type: Database["public"]["Enums"]["operation_source_type"]
        }
        Returns: undefined
      }
      assign_operational_work: {
        Args: {
          _assigned_to: string
          _note?: string
          _source_id: string
          _source_type: Database["public"]["Enums"]["operation_source_type"]
        }
        Returns: {
          assigned_at: string
          assigned_by: string | null
          assigned_to: string
          created_at: string
          id: string
          note: string | null
          released_at: string | null
          released_by: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["operation_source_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operational_assignments"
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
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
      automation_emit_event: {
        Args: {
          _entity_id: string
          _entity_type: string
          _event_type: Database["public"]["Enums"]["automation_trigger_type"]
          _origin?: Database["public"]["Enums"]["automation_event_origin"]
          _payload: Json
          _source_event_id: string
        }
        Returns: undefined
      }
      automation_evaluate_conditions: {
        Args: {
          _conditions: Json
          _ctx: Json
          _mode: Database["public"]["Enums"]["automation_condition_mode"]
          _trigger: Database["public"]["Enums"]["automation_trigger_type"]
        }
        Returns: boolean
      }
      automation_execute_action: {
        Args: {
          _ctx: Json
          _execution_id: string
          _rule: Database["public"]["Tables"]["automation_rules"]["Row"]
        }
        Returns: Json
      }
      automation_max_depth: { Args: never; Returns: number }
      automation_max_replays: { Args: never; Returns: number }
      automation_order_context: { Args: { _order_id: string }; Returns: Json }
      automation_registry: { Args: never; Returns: Json }
      automation_replay_execution: {
        Args: { _execution_id: string }
        Returns: {
          automation_depth: number
          completed_at: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          error_message: string | null
          event_type: Database["public"]["Enums"]["automation_trigger_type"]
          id: string
          input_snapshot: Json
          result: Json | null
          rule_id: string
          source_event_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["automation_execution_status"]
        }
        SetofOptions: {
          from: "*"
          to: "automation_rule_executions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      automation_sanitize_error: { Args: { _msg: string }; Returns: string }
      automation_validate_rule: {
        Args: {
          _action: Database["public"]["Enums"]["automation_action_type"]
          _conditions: Json
          _config: Json
          _mode: Database["public"]["Enums"]["automation_condition_mode"]
          _trigger: Database["public"]["Enums"]["automation_trigger_type"]
        }
        Returns: undefined
      }
      background_jobs_attention: {
        Args: {
          _backlog_warning?: number
          _limit?: number
          _retry_warning_attempts?: number
          _stale_wait_hours?: number
        }
        Returns: {
          assignable: boolean
          assigned_to: string
          assigned_to_name: string
          assignment_source_type: string
          category: string
          due_at: string
          href: string
          id: string
          occurred_at: string
          reason: string
          severity: string
          source_id: string
          source_type: string
          state: string
          subtitle: string
          title: string
        }[]
      }
      begin_courier_statement_import: {
        Args: {
          _courier_account_id: string
          _period_end?: string
          _period_start?: string
          _settlement_id?: string
          _source_name?: string
          _statement_reference: string
        }
        Returns: {
          ambiguous_rows: number
          applied_rows: number
          confirmed_at: string | null
          confirmed_by: string | null
          conflict_rows: number
          courier_account_id: string
          created_at: string
          duplicate_rows: number
          id: string
          imported_by: string | null
          invalid_rows: number
          matched_rows: number
          period_end: string | null
          period_start: string | null
          provider_id: string
          settlement_id: string | null
          source_name: string | null
          statement_reference: string
          status: string
          total_rows: number
          unmatched_rows: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "courier_statement_imports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      begin_listing_operation: {
        Args: {
          _listing_id: string
          _operation: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        Returns: Json
      }
      book_shipment_begin: {
        Args: { _shipment_id: string; _stale_after_seconds?: number }
        Returns: Json
      }
      brand_product_counts: {
        Args: never
        Returns: {
          brand_id: string
          product_count: number
        }[]
      }
      bulk_assign_shipment_courier: {
        Args: {
          _account_id?: string
          _provider_id: string
          _service_type?: Database["public"]["Enums"]["courier_service_type"]
          _shipment_ids: string[]
        }
        Returns: Json
      }
      bulk_claim_verification_work: {
        Args: { _note?: string; _order_ids: string[] }
        Returns: Json
      }
      bundle_availability: {
        Args: { _bundle_product_id: string; _location_id?: string }
        Returns: number
      }
      can_manage_commerce: { Args: { _user_id: string }; Returns: boolean }
      can_read_channels: { Args: never; Returns: boolean }
      can_read_commerce: { Args: { _user_id: string }; Returns: boolean }
      can_sync_channels: { Args: never; Returns: boolean }
      cancel_goods_receipt: {
        Args: { _reason?: string; _receipt_id: string }
        Returns: undefined
      }
      cancel_order: {
        Args: { _force?: boolean; _order_id: string; _reason?: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      cancel_stocktake: {
        Args: { _reason: string; _stocktake_id: string }
        Returns: undefined
      }
      cancel_sync_job: { Args: { _job_id: string }; Returns: Json }
      canonical_contact_phone: {
        Args: { _label?: string; _phone: string }
        Returns: string
      }
      category_product_counts: {
        Args: never
        Returns: {
          category_id: string
          product_count: number
        }[]
      }
      channel_listing_readiness: {
        Args: { _listing_id: string }
        Returns: Json
      }
      claim_courier_tracking_polls: {
        Args: { _lease_seconds?: number; _limit?: number; _worker?: string }
        Returns: {
          account_id: string
          consignment_id: string
          lease_token: string
          provider_code: string
          shipment_id: string
          shipment_number: string
        }[]
      }
      claim_sync_jobs: {
        Args: { _lease_seconds?: number; _limit?: number; _worker_id?: string }
        Returns: Json
      }
      claim_verification_work: {
        Args: { _note?: string; _order_id: string }
        Returns: {
          assigned_at: string
          assigned_by: string | null
          assigned_to: string
          created_at: string
          id: string
          note: string | null
          released_at: string | null
          released_by: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["operation_source_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operational_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commit_fulfillment_inventory: {
        Args: { _fulfillment_id: string }
        Returns: undefined
      }
      complete_sync_job: {
        Args: {
          _failure_class?: Database["public"]["Enums"]["sync_failure_class"]
          _job_id: string
          _lease_token: string
          _message?: string
          _ok: boolean
          _retry_after?: string
          _run_id?: string
        }
        Returns: Json
      }
      confirm_courier_statement_import: {
        Args: { _import_id: string }
        Returns: Json
      }
      courier_apply_event: {
        Args: { _event_id: string }
        Returns: {
          account_id: string | null
          consignment_id: string | null
          fingerprint: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          last_replay_at: string | null
          last_replay_by: string | null
          merchant_order_id: string | null
          next_retry_at: string | null
          payload: Json | null
          processing_note: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event: string | null
          provider_event_at: string | null
          provider_id: string | null
          provider_status: string | null
          received_at: string
          replay_count: number
          retry_count: number
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
      courier_credential_status: {
        Args: { _account_id: string }
        Returns: Json
      }
      courier_credentials_resolve: {
        Args: { _account_id: string; _require_active?: boolean }
        Returns: Json
      }
      courier_credentials_set: {
        Args: {
          _account_id: string
          _client_id?: string
          _client_secret?: string
          _password?: string
          _username?: string
          _webhook_secret?: string
        }
        Returns: Json
      }
      courier_credentials_store_token: {
        Args: {
          _access_token: string
          _account_id: string
          _expires_at?: string
          _refresh_token?: string
        }
        Returns: undefined
      }
      courier_status_key: { Args: { _value: string }; Returns: string }
      courier_vault_put: {
        Args: { _name: string; _ref: string; _value: string }
        Returns: string
      }
      courier_vault_read: { Args: { _ref: string }; Returns: string }
      courier_webhook_match_account: {
        Args: { _presented: string; _provider_code: string }
        Returns: string
      }
      create_courier_settlement: {
        Args: {
          _courier_account_id: string
          _notes?: string
          _settlement_date?: string
          _settlement_reference: string
        }
        Returns: {
          actual_amount: number | null
          courier_account_id: string
          created_at: string
          created_by: string | null
          expected_amount: number
          finalized_at: string | null
          finalized_by: string | null
          id: string
          notes: string | null
          settlement_date: string | null
          settlement_reference: string
          status: Database["public"]["Enums"]["courier_settlement_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "courier_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_financial_adjustment: {
        Args: {
          _adjustment_type: Database["public"]["Enums"]["financial_adjustment_type"]
          _amount: number
          _direction: Database["public"]["Enums"]["financial_adjustment_direction"]
          _order_id: string
          _reason?: string
          _reference?: string
          _return_id?: string
          _shipment_id?: string
        }
        Returns: {
          adjustment_type: Database["public"]["Enums"]["financial_adjustment_type"]
          amount: number
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["financial_adjustment_direction"]
          id: string
          order_id: string
          reason: string | null
          reference: string | null
          return_id: string | null
          reversal_of: string | null
          reversed_at: string | null
          reversed_by: string | null
          settlement_id: string | null
          shipment_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_financial_adjustments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_goods_receipt: {
        Args: { _location_id: string; _notes?: string; _po_id: string }
        Returns: string
      }
      create_inventory_transfer: {
        Args: {
          _from_location_id: string
          _notes?: string
          _to_location_id: string
        }
        Returns: string
      }
      create_or_update_channel_listing: {
        Args: {
          _account_id: string
          _payload?: Json
          _store_product_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          external_product_id: string | null
          external_sku: string | null
          external_url: string | null
          external_variant_reference: string | null
          id: string
          last_operation: string | null
          last_success_at: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          listing_status: Database["public"]["Enums"]["channel_listing_status"]
          sales_channel_account_id: string
          store_product_id: string
          sync_started_at: string | null
          synced_content_hash: string | null
          synced_price: number | null
          synced_qty: number | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_product_listings"
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
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
          inventory_committed_at: string | null
          inventory_committed_by: string | null
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
          financial_outcome: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at: string | null
          financial_recorded_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          refund_adjustment_id: string | null
          refund_amount: number
          requested_at: string
          resolution_note: string | null
          restocked_at: string | null
          restocked_by: string | null
          retained_amount: number
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
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
      create_stocktake: {
        Args: { _location_id: string; _notes?: string }
        Returns: string
      }
      customer_financial_summary: {
        Args: { _customer_id: string }
        Returns: Json
      }
      customer_list: {
        Args: {
          _attention?: boolean
          _customer_type?: string
          _limit?: number
          _offset?: number
          _search?: string
          _status?: Database["public"]["Enums"]["customer_status"]
        }
        Returns: Json
      }
      customer_metrics: { Args: { _customer_id: string }; Returns: Json }
      customer_timeline: {
        Args: { _customer_id: string; _limit?: number; _offset?: number }
        Returns: Json
      }
      detect_settlement_item_discrepancies: {
        Args: { _item_id: string }
        Returns: number
      }
      effective_store_product_data: {
        Args: { _store_product_id: string }
        Returns: Json
      }
      enqueue_listing_sync: {
        Args: {
          _delay?: string
          _listing_id: string
          _operation: Database["public"]["Enums"]["sales_channel_sync_type"]
          _priority?: number
          _reference?: string
          _source?: string
        }
        Returns: string
      }
      enqueue_listing_sync_result: {
        Args: {
          _delay?: string
          _listing_id: string
          _operation: Database["public"]["Enums"]["sales_channel_sync_type"]
          _priority?: number
          _reference?: string
          _source?: string
        }
        Returns: Json
      }
      enqueue_sync_for_product: {
        Args: {
          _operation: Database["public"]["Enums"]["sales_channel_sync_type"]
          _product_id: string
          _source: string
        }
        Returns: number
      }
      enqueue_sync_for_store_product: {
        Args: {
          _operation: Database["public"]["Enums"]["sales_channel_sync_type"]
          _source: string
          _store_product_id: string
        }
        Returns: number
      }
      ensure_inventory_level_internal: {
        Args: { _location_id: string; _product_id: string; _variant_id: string }
        Returns: string
      }
      ensure_shipment_return: {
        Args: {
          _at: string
          _provider_event?: string
          _reason: string
          _shipment_id: string
          _target: Database["public"]["Enums"]["order_return_status"]
        }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          financial_outcome: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at: string | null
          financial_recorded_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          refund_adjustment_id: string | null
          refund_amount: number
          requested_at: string
          resolution_note: string | null
          restocked_at: string | null
          restocked_by: string | null
          retained_amount: number
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
      exception_quick_view: { Args: { _exception_id: string }; Returns: Json }
      exception_resolution_class: {
        Args: { _type: Database["public"]["Enums"]["shipment_exception_type"] }
        Returns: string
      }
      exceptions_console_list: { Args: { _payload?: Json }; Returns: Json }
      external_order_fingerprint: { Args: { _payload: Json }; Returns: string }
      finalize_goods_receipt: {
        Args: { _receipt_id: string }
        Returns: undefined
      }
      finalize_stocktake: {
        Args: { _accept_changes?: boolean; _stocktake_id: string }
        Returns: undefined
      }
      find_customer_by_phone: {
        Args: { _phone: string }
        Returns: {
          block_reason: string | null
          blocked_at: string | null
          blocked_by: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          primary_phone: string
          primary_phone_normalized: string | null
          secondary_phone: string | null
          secondary_phone_normalized: string | null
          status: Database["public"]["Enums"]["customer_status"]
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      finish_listing_operation: {
        Args: {
          _external_missing?: boolean
          _external_product_id?: string
          _external_url?: string
          _listing_id: string
          _message?: string
          _ok: boolean
          _operation: Database["public"]["Enums"]["sales_channel_sync_type"]
          _run_id: string
          _synced_price?: number
          _synced_qty?: number
        }
        Returns: {
          created_at: string
          created_by: string | null
          external_product_id: string | null
          external_sku: string | null
          external_url: string | null
          external_variant_reference: string | null
          id: string
          last_operation: string | null
          last_success_at: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          listing_status: Database["public"]["Enums"]["channel_listing_status"]
          sales_channel_account_id: string
          store_product_id: string
          sync_started_at: string | null
          synced_content_hash: string | null
          synced_price: number | null
          synced_qty: number | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_product_listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_sync_run: {
        Args: {
          _created?: number
          _error_summary?: string
          _failed?: number
          _fetched?: number
          _run_id: string
          _skipped?: number
          _status: Database["public"]["Enums"]["sales_channel_sync_status"]
          _updated?: number
        }
        Returns: {
          completed_at: string | null
          created_at: string
          error_summary: string | null
          id: string
          initiated_by: string | null
          listing_id: string | null
          records_created: number
          records_failed: number
          records_fetched: number
          records_skipped: number
          records_updated: number
          sales_channel_account_id: string
          started_at: string
          status: Database["public"]["Enums"]["sales_channel_sync_status"]
          sync_type: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_sync_runs"
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
      get_sync_job: { Args: { _job_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_external_order: {
        Args: {
          _account_id: string
          _external_id: string
          _external_reference: string
          _payload: Json
          _store_id: string
        }
        Returns: Json
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
          last_attempt_at: string | null
          last_error: string | null
          last_replay_at: string | null
          last_replay_by: string | null
          merchant_order_id: string | null
          next_retry_at: string | null
          payload: Json | null
          processing_note: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event: string | null
          provider_event_at: string | null
          provider_id: string | null
          provider_status: string | null
          received_at: string
          replay_count: number
          retry_count: number
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
          financial_outcome: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at: string | null
          financial_recorded_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          refund_adjustment_id: string | null
          refund_amount: number
          requested_at: string
          resolution_note: string | null
          restocked_at: string | null
          restocked_by: string | null
          retained_amount: number
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
      integration_account_health: {
        Args: { _account_id: string }
        Returns: {
          account_id: string
          failure_count_24h: number
          has_credentials: boolean
          has_webhook_secret: boolean
          last_activity_at: string
          last_failure_at: string
          last_failure_message: string
          last_success_at: string
          last_token_refresh_at: string
          last_webhook_at: string
          token_expires_at: string
        }[]
      }
      integration_activity_feed: {
        Args: {
          _account_id?: string
          _activity_type?: string
          _from?: string
          _limit?: number
          _offset?: number
          _provider_id?: string
          _status?: string
          _to?: string
        }
        Returns: {
          account_id: string
          account_name: string
          activity_type: string
          created_at: string
          environment: string
          id: string
          message: string
          provider_id: string
          provider_name: string
          shipment_id: string
          status: string
          total_count: number
        }[]
      }
      integration_webhook_overview: {
        Args: never
        Returns: {
          account_id: string
          account_name: string
          applied_count: number
          duplicate_count: number
          environment: string
          ignored_count: number
          last_received_at: string
          provider_code: string
          provider_id: string
          provider_name: string
          rejected_count: number
          webhook_configured: boolean
        }[]
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_inventory_eligible_item: {
        Args: { _product_id: string; _variant_id: string }
        Returns: boolean
      }
      is_service_context: { Args: never; Returns: boolean }
      list_sync_jobs: {
        Args: {
          _account_id?: string
          _failure_class?: Database["public"]["Enums"]["sync_failure_class"]
          _from?: string
          _job_type?: string
          _limit?: number
          _listing_id?: string
          _offset?: number
          _operation?: Database["public"]["Enums"]["sales_channel_sync_type"]
          _search?: string
          _sort?: string
          _status?: Database["public"]["Enums"]["sync_job_status"]
          _store_id?: string
          _to?: string
        }
        Returns: Json
      }
      listing_content_hash: { Args: { _listing_id: string }; Returns: string }
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
      log_purchase_order_event: {
        Args: {
          _event: Database["public"]["Enums"]["purchase_order_event_type"]
          _from?: Database["public"]["Enums"]["purchase_order_status"]
          _message: string
          _metadata?: Json
          _po_id: string
          _to?: Database["public"]["Enums"]["purchase_order_status"]
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
      merge_order_item_payload: { Args: { _items: Json }; Returns: Json }
      next_goods_receipt_number: { Args: never; Returns: string }
      next_order_number: { Args: never; Returns: string }
      next_purchase_order_number: { Args: never; Returns: string }
      next_return_number: { Args: never; Returns: string }
      next_shipment_number: { Args: never; Returns: string }
      next_stocktake_number: { Args: never; Returns: string }
      next_transfer_number: { Args: never; Returns: string }
      normalize_bd_phone: { Args: { _phone: string }; Returns: string }
      operations_attention_feed: {
        Args: {
          _limit?: number
          _low_stock_default?: number
          _picking_stale_hours?: number
          _purchase_order_overdue_days?: number
          _shipment_stale_hours?: number
          _stocktake_stale_hours?: number
          _transfer_stale_hours?: number
          _verification_pending_hours?: number
        }
        Returns: {
          assignable: boolean
          assigned_to: string
          assigned_to_name: string
          assignment_source_type: string
          category: string
          due_at: string
          href: string
          id: string
          occurred_at: string
          reason: string
          severity: string
          source_id: string
          source_type: string
          state: string
          subtitle: string
          title: string
        }[]
      }
      operations_recent_activity: {
        Args: { _limit?: number }
        Returns: {
          actor_name: string
          category: string
          created_at: string
          event_type: string
          href: string
          id: string
          message: string
          reference: string
        }[]
      }
      order_customer_intelligence: {
        Args: { _order_id: string }
        Returns: Json
      }
      order_edit_block_reason: { Args: { _order_id: string }; Returns: string }
      order_financials: { Args: { _order_id: string }; Returns: Json }
      order_fulfillment_summary: {
        Args: { _order_id: string }
        Returns: {
          fulfilled: number
          order_item_id: string
          ordered: number
          remaining: number
        }[]
      }
      order_item_returnable_quantity: {
        Args: { _order_item_id: string }
        Returns: number
      }
      order_item_snapshot: {
        Args: { _product_id: string; _variant_id: string }
        Returns: Json
      }
      order_operationally_locked: {
        Args: { _order_id: string }
        Returns: boolean
      }
      order_profitability: { Args: { _order_id: string }; Returns: Json }
      order_quick_view: { Args: { _order_id: string }; Returns: Json }
      order_settlement_discrepancy_summary: {
        Args: { _order_id: string }
        Returns: Json
      }
      orders_console_list: { Args: { _payload?: Json }; Returns: Json }
      parse_statement_amount: {
        Args: { _raw: string }
        Returns: Record<string, unknown>
      }
      populate_courier_settlement: {
        Args: { _limit?: number; _settlement_id: string }
        Returns: Json
      }
      product_store_assignments: {
        Args: { _product_id: string }
        Returns: {
          available_qty: number
          id: string
          listing_count: number
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_code: string
          store_id: string
          store_name: string
          updated_at: string
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }[]
      }
      queue_listing_sync: {
        Args: {
          _listing_id: string
          _operation: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        Returns: string
      }
      recalculate_purchase_order_totals: {
        Args: { _po_id: string }
        Returns: undefined
      }
      reclaim_stale_sync_jobs: { Args: never; Returns: number }
      record_courier_booking: {
        Args: {
          _booking_snapshot?: Json
          _consignment_id: string
          _delivery_fee?: number
          _idempotency_key?: string
          _provider_status?: string
          _shipment_id: string
          _tracking_number?: string
        }
        Returns: {
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
      record_courier_booking_failure: {
        Args: {
          _idempotency_key?: string
          _message: string
          _outcome_unknown?: boolean
          _shipment_id: string
        }
        Returns: {
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
      record_courier_tracking_poll: {
        Args: {
          _error?: string
          _lease_token: string
          _ok: boolean
          _shipment_id: string
        }
        Returns: boolean
      }
      record_delivery_outcome: {
        Args: {
          _finalize?: boolean
          _items: Json
          _note?: string
          _shipment_id: string
        }
        Returns: {
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
          inventory_committed_at: string | null
          inventory_committed_by: string | null
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
      record_listing_readiness_check: {
        Args: { _listing_id: string }
        Returns: Json
      }
      record_return_financial_outcome: {
        Args: {
          _note?: string
          _refund_amount?: number
          _retained_amount?: number
          _return_id: string
        }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          financial_outcome: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at: string | null
          financial_recorded_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          refund_adjustment_id: string | null
          refund_amount: number
          requested_at: string
          resolution_note: string | null
          restocked_at: string | null
          restocked_by: string | null
          retained_amount: number
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
      record_return_receipt: {
        Args: { _items: Json; _note?: string; _return_id: string }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          financial_outcome: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at: string | null
          financial_recorded_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          refund_adjustment_id: string | null
          refund_amount: number
          requested_at: string
          resolution_note: string | null
          restocked_at: string | null
          restocked_by: string | null
          retained_amount: number
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
      record_settlement_actuals: {
        Args: {
          _actual_collected_amount?: number
          _cod_charge?: number
          _delivery_charge?: number
          _item_id: string
          _other_charge?: number
          _return_charge?: number
        }
        Returns: {
          actual_collected_amount: number | null
          cod_charge: number | null
          created_at: string
          delivery_charge: number | null
          eligibility_reason: string | null
          expected_cod_fee: number
          expected_collected_amount: number
          expected_delivery_fee: number
          expected_net_amount: number
          expected_other_charge: number
          expected_return_charge: number
          id: string
          net_settlement_amount: number | null
          order_id: string
          other_charge: number | null
          reconciled_at: string | null
          return_charge: number | null
          settlement_id: string
          shipment_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "courier_settlement_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_shipment_financials: {
        Args: {
          _actual_delivery_fee?: number
          _cod_fee?: number
          _collected_amount?: number
          _note?: string
          _other_courier_charge?: number
          _return_charge?: number
          _shipment_id: string
        }
        Returns: {
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      recover_stale_sync_job: { Args: { _job_id: string }; Returns: Json }
      refresh_order_delivery_status: {
        Args: { _order_id: string }
        Returns: Database["public"]["Enums"]["order_delivery_status"]
      }
      refresh_order_fulfillment_projection: {
        Args: { _order_id: string }
        Returns: undefined
      }
      refresh_order_payment: { Args: { _order_id: string }; Returns: undefined }
      release_operational_work: {
        Args: {
          _note?: string
          _source_id: string
          _source_type: Database["public"]["Enums"]["operation_source_type"]
        }
        Returns: undefined
      }
      release_order_reservations: {
        Args: { _order_id: string; _reason: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      remove_settlement_item: { Args: { _item_id: string }; Returns: undefined }
      repeat_customer_threshold: { Args: never; Returns: number }
      replay_courier_event: {
        Args: { _event_id: string; _reason?: string }
        Returns: {
          account_id: string | null
          consignment_id: string | null
          fingerprint: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          last_replay_at: string | null
          last_replay_by: string | null
          merchant_order_id: string | null
          next_retry_at: string | null
          payload: Json | null
          processing_note: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event: string | null
          provider_event_at: string | null
          provider_id: string | null
          provider_status: string | null
          received_at: string
          replay_count: number
          retry_count: number
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
      requeue_sync_job: { Args: { _job_id: string }; Returns: string }
      reservation_committed_quantity: {
        Args: {
          _r: Database["public"]["Tables"]["inventory_reservations"]["Row"]
        }
        Returns: number
      }
      reserve_order_inventory: {
        Args: { _order_id: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      resolve_courier_account: {
        Args: { _account_id?: string; _provider_id: string; _store_id: string }
        Returns: string
      }
      resolve_customer_for_order: {
        Args: {
          _customer_id?: string
          _email: string
          _name: string
          _phone: string
        }
        Returns: string
      }
      resolve_settlement_discrepancy: {
        Args: {
          _discrepancy_id: string
          _note?: string
          _resolution: Database["public"]["Enums"]["settlement_discrepancy_resolution"]
        }
        Returns: {
          adjustment_id: string | null
          created_at: string
          created_by: string | null
          difference: number
          direction: string
          discrepancy_type: string
          expected_amount: number
          id: string
          order_id: string
          resolution:
            | Database["public"]["Enums"]["settlement_discrepancy_resolution"]
            | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          settled_amount: number
          settlement_id: string
          settlement_item_id: string
          shipment_id: string
          status: Database["public"]["Enums"]["settlement_discrepancy_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "courier_settlement_discrepancies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_unknown_courier_booking: {
        Args: {
          _consignment_id?: string
          _reason?: string
          _resolution: string
          _shipment_id: string
        }
        Returns: {
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
      restock_return_inventory: {
        Args: { _return_id: string }
        Returns: undefined
      }
      retry_courier_event: {
        Args: { _event_id: string }
        Returns: {
          account_id: string | null
          consignment_id: string | null
          fingerprint: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          last_replay_at: string | null
          last_replay_by: string | null
          merchant_order_id: string | null
          next_retry_at: string | null
          payload: Json | null
          processing_note: string | null
          processing_status: Database["public"]["Enums"]["courier_event_processing_status"]
          provider_event: string | null
          provider_event_at: string | null
          provider_id: string | null
          provider_status: string | null
          received_at: string
          replay_count: number
          retry_count: number
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
      return_financial_summary: { Args: { _return_id: string }; Returns: Json }
      return_transition_valid: {
        Args: {
          _from: Database["public"]["Enums"]["order_return_status"]
          _to: Database["public"]["Enums"]["order_return_status"]
        }
        Returns: boolean
      }
      reverse_financial_adjustment: {
        Args: { _adjustment_id: string; _reason?: string }
        Returns: {
          adjustment_type: Database["public"]["Enums"]["financial_adjustment_type"]
          amount: number
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["financial_adjustment_direction"]
          id: string
          order_id: string
          reason: string | null
          reference: string | null
          return_id: string | null
          reversal_of: string | null
          reversed_at: string | null
          reversed_by: string | null
          settlement_id: string | null
          shipment_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "order_financial_adjustments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_goods_receipt: {
        Args: { _reason: string; _receipt_id: string }
        Returns: undefined
      }
      sales_channel_account_readiness: {
        Args: { _account_id: string }
        Returns: Json
      }
      sales_channel_credentials_status: {
        Args: { _account_id: string }
        Returns: Json
      }
      save_automation_rule: {
        Args: { _payload: Json }
        Returns: {
          action_config: Json
          action_type: Database["public"]["Enums"]["automation_action_type"]
          condition_mode: Database["public"]["Enums"]["automation_condition_mode"]
          conditions: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          priority: Database["public"]["Enums"]["automation_rule_priority"]
          status: Database["public"]["Enums"]["automation_rule_status"]
          trigger_type: Database["public"]["Enums"]["automation_trigger_type"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "automation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_customer: {
        Args: { _payload: Json }
        Returns: {
          block_reason: string | null
          blocked_at: string | null
          blocked_by: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          primary_phone: string
          primary_phone_normalized: string | null
          secondary_phone: string | null
          secondary_phone_normalized: string | null
          status: Database["public"]["Enums"]["customer_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_product_catalog: {
        Args: { _payload: Json; _product_id: string }
        Returns: Json
      }
      save_purchase_order: { Args: { _payload: Json }; Returns: string }
      save_sales_channel_account: {
        Args: { _payload: Json }
        Returns: {
          created_at: string
          created_by: string | null
          environment: Database["public"]["Enums"]["sales_channel_environment"]
          external_store_id: string | null
          external_store_name: string | null
          id: string
          last_error: string | null
          last_successful_sync_at: string | null
          last_sync_at: string | null
          name: string
          provider: Database["public"]["Enums"]["sales_channel_provider"]
          status: Database["public"]["Enums"]["sales_channel_status"]
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_store: {
        Args: { _payload: Json }
        Returns: {
          code: string
          country: string
          created_at: string
          created_by: string | null
          currency: string
          default_warehouse_id: string | null
          id: string
          name: string
          order_number_prefix: string | null
          slug: string
          status: Database["public"]["Enums"]["store_status"]
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_automation_rule_status: {
        Args: {
          _rule_id: string
          _status: Database["public"]["Enums"]["automation_rule_status"]
        }
        Returns: {
          action_config: Json
          action_type: Database["public"]["Enums"]["automation_action_type"]
          condition_mode: Database["public"]["Enums"]["automation_condition_mode"]
          conditions: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          priority: Database["public"]["Enums"]["automation_rule_priority"]
          status: Database["public"]["Enums"]["automation_rule_status"]
          trigger_type: Database["public"]["Enums"]["automation_trigger_type"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "automation_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_channel_listing_status: {
        Args: {
          _listing_id: string
          _message?: string
          _status: Database["public"]["Enums"]["channel_listing_status"]
        }
        Returns: {
          created_at: string
          created_by: string | null
          external_product_id: string | null
          external_sku: string | null
          external_url: string | null
          external_variant_reference: string | null
          id: string
          last_operation: string | null
          last_success_at: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          listing_status: Database["public"]["Enums"]["channel_listing_status"]
          sales_channel_account_id: string
          store_product_id: string
          sync_started_at: string | null
          synced_content_hash: string | null
          synced_price: number | null
          synced_qty: number | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_product_listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_courier_account_scope: {
        Args: { _account_id: string; _is_default: boolean; _store_id: string }
        Returns: {
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
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "courier_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_courier_account_state: {
        Args: {
          _account_id: string
          _status: Database["public"]["Enums"]["courier_provider_status"]
        }
        Returns: {
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
          store_id: string | null
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "courier_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_customer_manual_flag: {
        Args: {
          _active: boolean
          _customer_id: string
          _flag: Database["public"]["Enums"]["customer_manual_flag_type"]
          _reason: string
        }
        Returns: {
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          flag: Database["public"]["Enums"]["customer_manual_flag_type"]
          id: string
          is_active: boolean
          reason: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "customer_manual_flags"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_customer_status: {
        Args: {
          _customer_id: string
          _reason?: string
          _status: Database["public"]["Enums"]["customer_status"]
        }
        Returns: {
          block_reason: string | null
          blocked_at: string | null
          blocked_by: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          primary_phone: string
          primary_phone_normalized: string | null
          secondary_phone: string | null
          secondary_phone_normalized: string | null
          status: Database["public"]["Enums"]["customer_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customers"
          isOneToOne: true
          isSetofReturn: false
        }
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
          inventory_committed_at: string | null
          inventory_committed_by: string | null
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
          inventory_committed_at: string | null
          inventory_committed_by: string | null
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
      set_goods_receipt_lines: {
        Args: { _lines: Json; _receipt_id: string }
        Returns: undefined
      }
      set_order_fulfillment_state: {
        Args: { _action: string; _order_id: string; _reason?: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      set_order_store: {
        Args: { _order_id: string; _store_id: string }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      set_preferred_supplier_product: {
        Args: { _supplier_product_id: string }
        Returns: undefined
      }
      set_purchase_order_status: {
        Args: {
          _note?: string
          _po_id: string
          _status: Database["public"]["Enums"]["purchase_order_status"]
        }
        Returns: undefined
      }
      set_return_state: {
        Args: { _action: string; _reason?: string; _return_id: string }
        Returns: {
          cancelled_at: string | null
          completed_at: string | null
          courier_reason: string | null
          created_at: string
          created_by: string | null
          financial_outcome: Database["public"]["Enums"]["return_financial_outcome"]
          financial_recorded_at: string | null
          financial_recorded_by: string | null
          id: string
          initiated_at: string | null
          inspected_at: string | null
          notes: string | null
          order_id: string
          reason: string | null
          received_at: string | null
          refund_adjustment_id: string | null
          refund_amount: number
          requested_at: string
          resolution_note: string | null
          restocked_at: string | null
          restocked_by: string | null
          retained_amount: number
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
      set_sales_channel_account_state: {
        Args: {
          _account_id: string
          _error?: string
          _status: Database["public"]["Enums"]["sales_channel_status"]
          _successful?: boolean
          _touch_sync?: boolean
        }
        Returns: {
          created_at: string
          created_by: string | null
          environment: Database["public"]["Enums"]["sales_channel_environment"]
          external_store_id: string | null
          external_store_name: string | null
          id: string
          last_error: string | null
          last_successful_sync_at: string | null
          last_sync_at: string | null
          name: string
          provider: Database["public"]["Enums"]["sales_channel_provider"]
          status: Database["public"]["Enums"]["sales_channel_status"]
          store_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_sales_channel_credentials: {
        Args: {
          _account_id: string
          _api_version?: string
          _consumer_key: string
          _consumer_secret: string
          _site_url: string
          _webhook_secret?: string
        }
        Returns: boolean
      }
      set_settlement_status: {
        Args: {
          _note?: string
          _settlement_id: string
          _status: Database["public"]["Enums"]["courier_settlement_status"]
        }
        Returns: {
          actual_amount: number | null
          courier_account_id: string
          created_at: string
          created_by: string | null
          expected_amount: number
          finalized_at: string | null
          finalized_by: string | null
          id: string
          notes: string | null
          settlement_date: string | null
          settlement_reference: string
          status: Database["public"]["Enums"]["courier_settlement_status"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "courier_settlements"
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
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
      set_stocktake_counts: {
        Args: { _lines: Json; _stocktake_id: string }
        Returns: undefined
      }
      set_store_product_price: {
        Args: { _id: string; _price: number; _reason?: string }
        Returns: {
          activated_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          description_override: string | null
          id: string
          product_id: string
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_id: string
          store_sku: string | null
          title_override: string | null
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }
        SetofOptions: {
          from: "*"
          to: "store_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_store_status: {
        Args: {
          _status: Database["public"]["Enums"]["store_status"]
          _store_id: string
        }
        Returns: {
          code: string
          country: string
          created_at: string
          created_by: string | null
          currency: string
          default_warehouse_id: string | null
          id: string
          name: string
          order_number_prefix: string | null
          slug: string
          status: Database["public"]["Enums"]["store_status"]
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_transfer_items: {
        Args: { _lines: Json; _transfer_id: string }
        Returns: undefined
      }
      set_transfer_status: {
        Args: {
          _reason?: string
          _status: Database["public"]["Enums"]["inventory_transfer_status"]
          _transfer_id: string
        }
        Returns: undefined
      }
      settlement_candidate_shipments: {
        Args: { _courier_account_id: string; _limit?: number; _offset?: number }
        Returns: {
          already_settled: boolean
          booked_delivery_fee: number
          collected_amount: number
          consignment_id: string
          courier_account_name: string
          eligibility_reason: string
          expected_collected: number
          expected_delivery_fee: number
          expected_net: number
          expected_return_charge: number
          order_id: string
          order_number: string
          provider_name: string
          settlement_reference: string
          shipment_id: string
          shipment_number: string
          status: string
        }[]
      }
      settlement_expected_values: {
        Args: { _shipment_id: string }
        Returns: {
          eligible: boolean
          expected_cod_fee: number
          expected_collected: number
          expected_delivery_fee: number
          expected_net: number
          expected_other_charge: number
          expected_return_charge: number
          reason: string
        }[]
      }
      shipment_expected_return_items: {
        Args: { _shipment_id: string }
        Returns: {
          damaged_quantity: number
          order_item_id: string
          product_name: string
          refused_quantity: number
          returnable_quantity: number
          sku: string
          suggested_quantity: number
          variant_name: string
        }[]
      }
      shipment_profitability: { Args: { _shipment_id: string }; Returns: Json }
      shipment_quick_view: { Args: { _shipment_id: string }; Returns: Json }
      shipment_transition_valid: {
        Args: {
          _from: Database["public"]["Enums"]["shipment_status"]
          _to: Database["public"]["Enums"]["shipment_status"]
        }
        Returns: boolean
      }
      shipments_console_list: { Args: { _payload?: Json }; Returns: Json }
      stage_courier_statement_rows: {
        Args: { _import_id: string; _rows: Json }
        Returns: Json
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
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      start_stocktake: { Args: { _stocktake_id: string }; Returns: undefined }
      start_sync_run: {
        Args: {
          _account_id: string
          _sync_type: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        Returns: {
          completed_at: string | null
          created_at: string
          error_summary: string | null
          id: string
          initiated_by: string | null
          listing_id: string | null
          records_created: number
          records_failed: number
          records_fetched: number
          records_skipped: number
          records_updated: number
          sales_channel_account_id: string
          started_at: string
          status: Database["public"]["Enums"]["sales_channel_sync_status"]
          sync_type: Database["public"]["Enums"]["sales_channel_sync_type"]
        }
        SetofOptions: {
          from: "*"
          to: "sales_channel_sync_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      store_catalog_list: {
        Args: {
          _category_id?: string
          _channel_id?: string
          _limit?: number
          _offset?: number
          _search?: string
          _status?: Database["public"]["Enums"]["store_product_status"]
          _stock?: string
          _store_id: string
          _visibility?: Database["public"]["Enums"]["store_product_visibility"]
        }
        Returns: {
          available_qty: number
          category_name: string
          id: string
          is_purchasable: boolean
          listing_count: number
          master_sku: string
          product_id: string
          product_name: string
          published_count: number
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_sku: string
          total_count: number
          updated_at: string
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }[]
      }
      store_catalog_summary: { Args: { _store_id: string }; Returns: Json }
      store_channel_listings: {
        Args: {
          _channel_id?: string
          _health?: string
          _limit?: number
          _offset?: number
          _search?: string
          _status?: Database["public"]["Enums"]["channel_listing_status"]
          _store_id: string
        }
        Returns: {
          available_qty: number
          channel_id: string
          channel_name: string
          channel_status: Database["public"]["Enums"]["sales_channel_status"]
          external_product_id: string
          external_url: string
          id: string
          last_success_at: string
          last_sync_error: string
          last_synced_at: string
          listing_status: Database["public"]["Enums"]["channel_listing_status"]
          product_id: string
          product_name: string
          provider: Database["public"]["Enums"]["sales_channel_provider"]
          selling_price: number
          store_product_id: string
          store_product_status: Database["public"]["Enums"]["store_product_status"]
          store_sku: string
          total_count: number
        }[]
      }
      store_list: { Args: never; Returns: Json }
      store_product_available_qty: {
        Args: { _product_id: string }
        Returns: number
      }
      supplier_summaries: {
        Args: never
        Returns: {
          primary_contact_name: string
          primary_contact_phone: string
          product_count: number
          purchase_order_count: number
          supplier_id: string
        }[]
      }
      sweep_courier_event_retries: {
        Args: { _limit?: number }
        Returns: number
      }
      sync_job_backoff: { Args: { _attempt: number }; Returns: string }
      sync_queue_health: {
        Args: { _overdue_hours?: number; _store_id?: string }
        Returns: Json
      }
      sync_queue_overview: { Args: { _store_id?: string }; Returns: Json }
      update_order_address: {
        Args: { _address: Json; _order_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "order_addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_order_customer: {
        Args: {
          _customer_email?: string
          _customer_id?: string
          _customer_name: string
          _customer_phone: string
          _order_id: string
          _reason?: string
        }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
      update_order_items: {
        Args: { _order_id: string; _payload: Json }
        Returns: {
          adjustment: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
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
          refunded_amount: number
          reservation_status: Database["public"]["Enums"]["reservation_status"]
          reserved_at: string | null
          risk_level: Database["public"]["Enums"]["verification_risk_level"]
          risk_reason: string | null
          shipping_charge: number
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
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
          actual_delivery_fee: number | null
          booked_at: string | null
          booked_delivery_fee: number | null
          booking_attempt_count: number
          booking_attempt_started_at: string | null
          booking_idempotency_key: string
          booking_last_error: string | null
          booking_outcome_unknown: boolean
          booking_snapshot: Json | null
          cancelled_at: string | null
          cash_on_delivery_amount: number
          cod_fee: number | null
          collected_amount: number | null
          courier_account_id: string | null
          created_at: string
          created_by: string | null
          declared_value: number | null
          delivered_at: string | null
          delivery_address: string
          delivery_area: string | null
          delivery_city: string | null
          delivery_outcome_fingerprint: string | null
          delivery_outcome_recorded_at: string | null
          delivery_outcome_recorded_by: string | null
          delivery_zone: string | null
          external_consignment_id: string | null
          failure_reason:
            | Database["public"]["Enums"]["shipment_failure_reason"]
            | null
          financials_recorded_at: string | null
          financials_recorded_by: string | null
          fulfillment_id: string | null
          hold_reason:
            | Database["public"]["Enums"]["shipment_hold_reason"]
            | null
          id: string
          internal_notes: string | null
          last_synced_at: string | null
          notes: string | null
          order_id: string
          other_courier_charge: number | null
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
          return_charge: number | null
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
      update_store_product: {
        Args: { _id: string; _payload: Json }
        Returns: {
          activated_at: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          description_override: string | null
          id: string
          product_id: string
          selling_price: number
          status: Database["public"]["Enums"]["store_product_status"]
          store_id: string
          store_sku: string | null
          title_override: string | null
          updated_at: string
          updated_by: string | null
          visibility: Database["public"]["Enums"]["store_product_visibility"]
        }
        SetofOptions: {
          from: "*"
          to: "store_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_external_mapping: {
        Args: {
          _account_id: string
          _entity_type: Database["public"]["Enums"]["external_entity_type"]
          _external_id: string
          _external_reference?: string
          _internal_id: string
        }
        Returns: {
          created_at: string
          entity_type: Database["public"]["Enums"]["external_entity_type"]
          external_id: string
          external_reference: string | null
          id: string
          internal_id: string
          payload_fingerprint: string | null
          sales_channel_account_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "external_entity_mappings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      variant_has_history: { Args: { _variant_id: string }; Returns: boolean }
      verification_claim_block_reason: {
        Args: { _order_id: string }
        Returns: string
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
      ai_analysis_type:
        | "operations_summary"
        | "order_review"
        | "customer_review"
        | "inventory_review"
        | "delivery_review"
        | "courier_review"
        | "procurement_review"
        | "financial_review"
      ai_insight_category:
        | "operations"
        | "order"
        | "customer"
        | "inventory"
        | "delivery"
        | "courier"
        | "procurement"
        | "financial"
        | "verification"
        | "general"
      ai_insight_severity: "info" | "low" | "medium" | "high" | "critical"
      ai_insight_status: "active" | "acknowledged" | "dismissed" | "expired"
      ai_recommendation_priority: "low" | "medium" | "high" | "urgent"
      ai_recommendation_status:
        | "pending"
        | "accepted"
        | "dismissed"
        | "executed"
        | "expired"
      ai_run_status: "queued" | "running" | "completed" | "failed" | "cancelled"
      app_role: "owner" | "admin" | "staff" | "viewer"
      automation_action_type:
        | "set_verification_priority"
        | "move_to_manual_review"
        | "assign_operational_work"
        | "create_internal_note"
      automation_condition_mode: "all" | "any"
      automation_event_origin: "human" | "system" | "automation"
      automation_execution_status:
        | "pending"
        | "running"
        | "completed"
        | "skipped"
        | "failed"
      automation_rule_priority: "low" | "normal" | "high"
      automation_rule_status: "active" | "paused" | "archived"
      automation_trigger_type:
        | "order.created"
        | "order.cancelled"
        | "verification.pending"
        | "verification.manual_review"
        | "verification.unreachable"
        | "verification.confirmed"
        | "verification.failed"
        | "fulfillment.shortage"
        | "fulfillment.qc_failed"
        | "fulfillment.on_hold"
        | "fulfillment.handover"
        | "shipment.created"
        | "shipment.on_hold"
        | "shipment.delivery_failed"
        | "shipment.delivered"
        | "shipment.returned"
        | "inventory.low_stock"
        | "inventory.out_of_stock"
        | "purchase_order.pending_approval"
        | "purchase_order.partially_received"
      brand_type: "standard" | "own_brand" | "generic"
      channel_listing_event_type:
        | "listing_created"
        | "listing_updated"
        | "listing_publish_requested"
        | "listing_published"
        | "listing_sync_failed"
        | "listing_archived"
        | "listing_readiness_checked"
        | "listing_publish_started"
        | "listing_publish_failed"
        | "listing_product_synced"
        | "listing_price_synced"
        | "listing_stock_synced"
        | "listing_status_refreshed"
        | "listing_external_missing"
        | "listing_paused"
        | "listing_unpublished"
        | "listing_sync_started"
      channel_listing_status:
        | "not_published"
        | "ready"
        | "publishing"
        | "published"
        | "update_pending"
        | "syncing"
        | "sync_failed"
        | "paused"
        | "archived"
      cost_change_source: "manual" | "purchase_receipt" | "correction"
      courier_environment: "sandbox" | "production"
      courier_event_processing_status:
        | "applied"
        | "recorded"
        | "duplicate"
        | "stale"
        | "unmatched"
        | "rejected"
        | "received"
        | "retry_scheduled"
        | "dead_letter"
      courier_provider_status: "active" | "inactive" | "disabled"
      courier_service_type:
        | "standard"
        | "express"
        | "same_day"
        | "next_day"
        | "other"
      courier_settlement_status:
        | "draft"
        | "pending"
        | "partial"
        | "settled"
        | "disputed"
        | "cancelled"
      customer_manual_flag_type:
        | "manual_attention"
        | "trusted"
        | "payment_risk"
        | "address_risk"
        | "other"
      customer_status: "active" | "inactive" | "blocked"
      entity_status: "active" | "inactive" | "archived"
      entity_visibility: "visible" | "hidden"
      external_entity_type: "order" | "product" | "variant" | "customer"
      financial_adjustment_direction: "income" | "expense"
      financial_adjustment_type:
        | "packing_cost"
        | "courier_charge"
        | "cod_fee"
        | "return_charge"
        | "damage_loss"
        | "manual_expense"
        | "manual_income"
        | "settlement_adjustment"
        | "other"
        | "refund"
        | "settlement_shortfall"
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
      goods_receipt_status: "draft" | "received" | "cancelled"
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
      inventory_adjustment_reason:
        | "stock_found"
        | "stock_missing"
        | "counting_error"
        | "damage"
        | "correction"
        | "other"
      inventory_movement_type:
        | "initial"
        | "adjustment_in"
        | "adjustment_out"
        | "damage"
        | "return_in"
        | "reservation"
        | "release_reservation"
        | "fulfillment_out"
        | "purchase_in"
        | "purchase_damaged_in"
        | "damaged_out"
        | "transfer_out"
        | "transfer_in"
        | "transfer_incoming_in"
        | "transfer_incoming_out"
        | "stocktake_in"
        | "stocktake_out"
      inventory_transfer_status:
        | "draft"
        | "pending"
        | "in_transit"
        | "received"
        | "cancelled"
      item_cost_type: "base_cost" | "additional_cost"
      operation_assignment_event_type: "assigned" | "reassigned" | "released"
      operation_source_type:
        | "order_verification"
        | "order_fulfillment"
        | "order_return"
        | "shipment_exception"
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
        | "partially_fulfilled"
        | "fulfilled"
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
      purchase_order_event_type:
        | "created"
        | "updated"
        | "submitted_for_approval"
        | "approval_returned"
        | "approved"
        | "ordered"
        | "receipt_created"
        | "receipt_cancelled"
        | "partially_received"
        | "received"
        | "receipt_reversed"
        | "cancelled"
        | "closed"
        | "note_added"
      purchase_order_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "ordered"
        | "partially_received"
        | "received"
        | "cancelled"
        | "closed"
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
      return_financial_outcome:
        | "pending"
        | "refunded"
        | "partially_refunded"
        | "retained"
      return_item_condition:
        | "unknown"
        | "good"
        | "opened"
        | "damaged"
        | "missing"
        | "unusable"
      sales_channel_environment: "production" | "sandbox"
      sales_channel_provider:
        | "manual"
        | "woocommerce"
        | "shopify"
        | "custom_api"
        | "facebook"
        | "tiktok"
        | "daraz"
        | "other"
      sales_channel_status: "active" | "disabled" | "error" | "disconnected"
      sales_channel_sync_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "partial"
      sales_channel_sync_type:
        | "orders"
        | "products"
        | "customers"
        | "full"
        | "listing_publish"
        | "listing_update"
        | "price_sync"
        | "stock_sync"
        | "status_refresh"
        | "unpublish"
      settlement_discrepancy_resolution:
        | "courier_corrected"
        | "settlement_received"
        | "merchant_adjustment"
        | "written_off"
      settlement_discrepancy_status: "open" | "resolved"
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
      stocktake_status: "draft" | "in_progress" | "completed" | "cancelled"
      store_product_status: "draft" | "active" | "archived"
      store_product_visibility: "hidden" | "visible"
      store_status: "active" | "inactive" | "archived"
      supply_model: "in_stock" | "local_sourcing" | "preorder" | "group_buy"
      sync_failure_class:
        | "transient"
        | "permanent"
        | "unknown"
        | "rate_limited"
        | "authentication"
      sync_job_status:
        | "pending"
        | "retry_wait"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "superseded"
        | "dead_letter"
      variant_status: "active" | "inactive" | "archived"
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
      ai_analysis_type: [
        "operations_summary",
        "order_review",
        "customer_review",
        "inventory_review",
        "delivery_review",
        "courier_review",
        "procurement_review",
        "financial_review",
      ],
      ai_insight_category: [
        "operations",
        "order",
        "customer",
        "inventory",
        "delivery",
        "courier",
        "procurement",
        "financial",
        "verification",
        "general",
      ],
      ai_insight_severity: ["info", "low", "medium", "high", "critical"],
      ai_insight_status: ["active", "acknowledged", "dismissed", "expired"],
      ai_recommendation_priority: ["low", "medium", "high", "urgent"],
      ai_recommendation_status: [
        "pending",
        "accepted",
        "dismissed",
        "executed",
        "expired",
      ],
      ai_run_status: ["queued", "running", "completed", "failed", "cancelled"],
      app_role: ["owner", "admin", "staff", "viewer"],
      automation_action_type: [
        "set_verification_priority",
        "move_to_manual_review",
        "assign_operational_work",
        "create_internal_note",
      ],
      automation_condition_mode: ["all", "any"],
      automation_event_origin: ["human", "system", "automation"],
      automation_execution_status: [
        "pending",
        "running",
        "completed",
        "skipped",
        "failed",
      ],
      automation_rule_priority: ["low", "normal", "high"],
      automation_rule_status: ["active", "paused", "archived"],
      automation_trigger_type: [
        "order.created",
        "order.cancelled",
        "verification.pending",
        "verification.manual_review",
        "verification.unreachable",
        "verification.confirmed",
        "verification.failed",
        "fulfillment.shortage",
        "fulfillment.qc_failed",
        "fulfillment.on_hold",
        "fulfillment.handover",
        "shipment.created",
        "shipment.on_hold",
        "shipment.delivery_failed",
        "shipment.delivered",
        "shipment.returned",
        "inventory.low_stock",
        "inventory.out_of_stock",
        "purchase_order.pending_approval",
        "purchase_order.partially_received",
      ],
      brand_type: ["standard", "own_brand", "generic"],
      channel_listing_event_type: [
        "listing_created",
        "listing_updated",
        "listing_publish_requested",
        "listing_published",
        "listing_sync_failed",
        "listing_archived",
        "listing_readiness_checked",
        "listing_publish_started",
        "listing_publish_failed",
        "listing_product_synced",
        "listing_price_synced",
        "listing_stock_synced",
        "listing_status_refreshed",
        "listing_external_missing",
        "listing_paused",
        "listing_unpublished",
        "listing_sync_started",
      ],
      channel_listing_status: [
        "not_published",
        "ready",
        "publishing",
        "published",
        "update_pending",
        "syncing",
        "sync_failed",
        "paused",
        "archived",
      ],
      cost_change_source: ["manual", "purchase_receipt", "correction"],
      courier_environment: ["sandbox", "production"],
      courier_event_processing_status: [
        "applied",
        "recorded",
        "duplicate",
        "stale",
        "unmatched",
        "rejected",
        "received",
        "retry_scheduled",
        "dead_letter",
      ],
      courier_provider_status: ["active", "inactive", "disabled"],
      courier_service_type: [
        "standard",
        "express",
        "same_day",
        "next_day",
        "other",
      ],
      courier_settlement_status: [
        "draft",
        "pending",
        "partial",
        "settled",
        "disputed",
        "cancelled",
      ],
      customer_manual_flag_type: [
        "manual_attention",
        "trusted",
        "payment_risk",
        "address_risk",
        "other",
      ],
      customer_status: ["active", "inactive", "blocked"],
      entity_status: ["active", "inactive", "archived"],
      entity_visibility: ["visible", "hidden"],
      external_entity_type: ["order", "product", "variant", "customer"],
      financial_adjustment_direction: ["income", "expense"],
      financial_adjustment_type: [
        "packing_cost",
        "courier_charge",
        "cod_fee",
        "return_charge",
        "damage_loss",
        "manual_expense",
        "manual_income",
        "settlement_adjustment",
        "other",
        "refund",
        "settlement_shortfall",
      ],
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
      goods_receipt_status: ["draft", "received", "cancelled"],
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
      inventory_adjustment_reason: [
        "stock_found",
        "stock_missing",
        "counting_error",
        "damage",
        "correction",
        "other",
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
        "purchase_in",
        "purchase_damaged_in",
        "damaged_out",
        "transfer_out",
        "transfer_in",
        "transfer_incoming_in",
        "transfer_incoming_out",
        "stocktake_in",
        "stocktake_out",
      ],
      inventory_transfer_status: [
        "draft",
        "pending",
        "in_transit",
        "received",
        "cancelled",
      ],
      item_cost_type: ["base_cost", "additional_cost"],
      operation_assignment_event_type: ["assigned", "reassigned", "released"],
      operation_source_type: [
        "order_verification",
        "order_fulfillment",
        "order_return",
        "shipment_exception",
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
        "partially_fulfilled",
        "fulfilled",
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
      purchase_order_event_type: [
        "created",
        "updated",
        "submitted_for_approval",
        "approval_returned",
        "approved",
        "ordered",
        "receipt_created",
        "receipt_cancelled",
        "partially_received",
        "received",
        "receipt_reversed",
        "cancelled",
        "closed",
        "note_added",
      ],
      purchase_order_status: [
        "draft",
        "pending_approval",
        "approved",
        "ordered",
        "partially_received",
        "received",
        "cancelled",
        "closed",
      ],
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
      return_financial_outcome: [
        "pending",
        "refunded",
        "partially_refunded",
        "retained",
      ],
      return_item_condition: [
        "unknown",
        "good",
        "opened",
        "damaged",
        "missing",
        "unusable",
      ],
      sales_channel_environment: ["production", "sandbox"],
      sales_channel_provider: [
        "manual",
        "woocommerce",
        "shopify",
        "custom_api",
        "facebook",
        "tiktok",
        "daraz",
        "other",
      ],
      sales_channel_status: ["active", "disabled", "error", "disconnected"],
      sales_channel_sync_status: [
        "pending",
        "running",
        "completed",
        "failed",
        "partial",
      ],
      sales_channel_sync_type: [
        "orders",
        "products",
        "customers",
        "full",
        "listing_publish",
        "listing_update",
        "price_sync",
        "stock_sync",
        "status_refresh",
        "unpublish",
      ],
      settlement_discrepancy_resolution: [
        "courier_corrected",
        "settlement_received",
        "merchant_adjustment",
        "written_off",
      ],
      settlement_discrepancy_status: ["open", "resolved"],
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
      stocktake_status: ["draft", "in_progress", "completed", "cancelled"],
      store_product_status: ["draft", "active", "archived"],
      store_product_visibility: ["hidden", "visible"],
      store_status: ["active", "inactive", "archived"],
      supply_model: ["in_stock", "local_sourcing", "preorder", "group_buy"],
      sync_failure_class: [
        "transient",
        "permanent",
        "unknown",
        "rate_limited",
        "authentication",
      ],
      sync_job_status: [
        "pending",
        "retry_wait",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
        "superseded",
        "dead_letter",
      ],
      variant_status: ["active", "inactive", "archived"],
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

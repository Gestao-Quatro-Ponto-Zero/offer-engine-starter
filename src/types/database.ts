// Database type definitions for G4 Offer Engine
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      offer_rules: {
        Row: {
          id: string;
          name: string;
          grades: string[];
          bus: string[];
          amount_min: number;
          amount_max: number;
          options: Json;
          restrictions: Json;
          version: number;
          is_active: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["offer_rules"]["Row"], "id" | "created_at" | "updated_at" | "version">;
        Update: Partial<Database["public"]["Tables"]["offer_rules"]["Insert"]>;
      };
      offer_rules_history: {
        Row: {
          id: string;
          rule_id: string;
          version: number;
          snapshot: Json;
          changed_by: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["offer_rules_history"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["offer_rules_history"]["Insert"]>;
      };
      offer_scores: {
        Row: {
          id: string;
          deal_id: string;
          g4_risk_score: number;
          grade: string;
          components: Json;
          credit_limit: number;
          credit_available: number;
          top_factors: Json;
          scored_at: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["offer_scores"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["offer_scores"]["Insert"]>;
      };
      offer_menus: {
        Row: {
          id: string;
          deal_id: string;
          score_id: string;
          offers: Json;
          restrictions: Json;
          smart_exits: Json | null;
          valid_until: string;
          status: string;
          selected_offer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["offer_menus"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["offer_menus"]["Insert"]>;
      };
      offer_exceptions: {
        Row: {
          id: string;
          deal_id: string;
          menu_id: string;
          seller_email: string;
          desired_conditions: string;
          justification: string;
          deal_amount: number;
          current_grade: string;
          approver_role: string;
          approver_email: string | null;
          status: string;
          decision_note: string | null;
          created_at: string;
          decided_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["offer_exceptions"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["offer_exceptions"]["Insert"]>;
      };
      offer_audit: {
        Row: {
          id: string;
          action: string;
          deal_id: string | null;
          user_email: string | null;
          details: Json;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["offer_audit"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["offer_audit"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

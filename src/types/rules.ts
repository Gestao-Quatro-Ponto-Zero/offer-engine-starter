// Rule types
import type { RiskGrade } from "@/lib/constants";
import type { OfferType } from "./offers";

export interface PaymentOptionRule {
  type: OfferType;
  label_template: string;
  installments: number;
  down_payment_pct: number;
  interest_monthly_pct: number;
  discount_pct: number;
  recommended: boolean;
}

export interface RuleRestrictions {
  requires_contract: boolean;
  requires_promissory_note: boolean;
  approval_manager_above: number | null;
  approval_director_above: number | null;
  credit_limit_max: number;
}

export interface OfferRule {
  id: string;
  name: string;
  grades: RiskGrade[];
  bus: string[];
  amount_min: number;
  amount_max: number;
  options: PaymentOptionRule[];
  restrictions: RuleRestrictions;
  version: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RuleHistoryEntry {
  id: string;
  rule_id: string;
  version: number;
  snapshot: OfferRule;
  changed_by: string;
  created_at: string;
}

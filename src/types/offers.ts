// Offer types
export type OfferType = "parcelado" | "avista" | "pix" | "estruturado";
export type OfferStatus = "pending" | "generated" | "presented" | "accepted" | "rejected";

export interface PaymentOption {
  id: string;
  type: OfferType;
  label: string;
  recommended: boolean;
  installments: number;
  down_payment_pct: number;
  down_payment_value: number;
  interest_monthly_pct: number;
  installment_value: number;
  total_value: number;
  discount_pct: number;
  requires_approval: boolean;
  requires_promissory_note: boolean;
}

export interface SmartExit {
  type: "split_contract" | "minimum_down_payment" | "structured_payment";
  label: string;
  description: string;
  params: Record<string, number | string>;
}

export interface OfferRestrictions {
  requires_contract: boolean;
  requires_promissory_note: boolean;
  approval_manager_above: number | null;
  approval_director_above: number | null;
  credit_limit_max: number;
}

export interface OfferMenu {
  id: string;
  deal_id: string;
  score_id: string;
  offers: PaymentOption[];
  restrictions: OfferRestrictions;
  smart_exits: SmartExit[] | null;
  valid_until: string;
  status: OfferStatus;
  selected_offer_id: string | null;
  created_at: string;
}

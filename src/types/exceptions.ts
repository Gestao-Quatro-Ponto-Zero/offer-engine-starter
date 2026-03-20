import type { RiskGrade } from "@/lib/constants";

export type ExceptionStatus = "pending" | "approved" | "rejected" | "expired";
export type ApproverRole = "manager" | "director" | "vp";

export interface OfferException {
  id: string;
  deal_id: string;
  menu_id: string;
  seller_email: string;
  desired_conditions: string;
  justification: string;
  deal_amount: number;
  current_grade: RiskGrade;
  approver_role: ApproverRole;
  approver_email: string | null;
  status: ExceptionStatus;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface ExceptionRequest {
  deal_id: string;
  menu_id: string;
  desired_conditions: string;
  justification: string;
  deal_amount: number;
}

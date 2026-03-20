import { supabase } from "@/lib/supabase";
import type {
  OfferException,
  ExceptionRequest,
  ExceptionStatus,
  ApproverRole,
} from "@/types/exceptions";
import type { RiskGrade } from "@/lib/constants";

function determineApproverRole(dealAmount: number): ApproverRole {
  if (dealAmount <= 100_000) return "manager";
  if (dealAmount <= 300_000) return "director";
  return "vp";
}

export async function requestException(
  request: ExceptionRequest,
  sellerEmail: string,
  currentGrade: RiskGrade
): Promise<OfferException> {
  const approverRole = determineApproverRole(request.deal_amount);

  const { data, error } = await supabase
    .from("offer_exceptions")
    .insert({
      deal_id: request.deal_id,
      menu_id: request.menu_id,
      deal_amount: request.deal_amount,
      desired_conditions: request.desired_conditions,
      justification: request.justification,
      seller_email: sellerEmail,
      current_grade: currentGrade,
      approver_role: approverRole,
      status: "pending" as ExceptionStatus,
    })
    .select()
    .single();

  if (error) throw error;

  return data as OfferException;
}

export async function approveException(
  exceptionId: string,
  approverEmail: string,
  note: string
): Promise<void> {
  const { error } = await supabase
    .from("offer_exceptions")
    .update({
      status: "approved" as ExceptionStatus,
      approver_email: approverEmail,
      decision_note: note,
      decided_at: new Date().toISOString(),
    })
    .eq("id", exceptionId);

  if (error) throw error;
}

export async function rejectException(
  exceptionId: string,
  approverEmail: string,
  note: string
): Promise<void> {
  const { error } = await supabase
    .from("offer_exceptions")
    .update({
      status: "rejected" as ExceptionStatus,
      approver_email: approverEmail,
      decision_note: note,
      decided_at: new Date().toISOString(),
    })
    .eq("id", exceptionId);

  if (error) throw error;
}

export async function getExceptions(
  status?: string
): Promise<OfferException[]> {
  let query = supabase
    .from("offer_exceptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) throw error;

  return data as OfferException[];
}

export async function getExceptionStats(): Promise<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  approval_rate: number;
}> {
  const { data, error } = await supabase
    .from("offer_exceptions")
    .select("status");

  if (error) throw error;

  const total = data.length;
  const pending = data.filter((r) => r.status === "pending").length;
  const approved = data.filter((r) => r.status === "approved").length;
  const rejected = data.filter((r) => r.status === "rejected").length;
  const decided = approved + rejected;
  const approval_rate = decided > 0 ? approved / decided : 0;

  return { total, pending, approved, rejected, approval_rate };
}

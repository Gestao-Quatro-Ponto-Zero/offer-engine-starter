// Scoring service
import { supabase } from "@/lib/supabase";
import type { RiskScoreResult } from "@/types/scoring";

export async function scoreRisk(
  dealId: string,
  dealAmount: number,
  bu: string
): Promise<RiskScoreResult> {
  const { data, error } = await supabase.functions.invoke("score", {
    body: { deal_id: dealId, deal_amount: dealAmount, bu },
  });

  if (error) throw error;

  const result = data as RiskScoreResult;

  // Cache the score in offer_scores
  const { error: insertError } = await supabase.from("offer_scores").insert({
    deal_id: dealId,
    score: result.g4_risk_score,
    grade: result.grade,
    components: result.components,
    factors: result.top_factors,
  });

  if (insertError) throw insertError;

  return result;
}

export async function getScore(dealId: string): Promise<RiskScoreResult | null> {
  const { data, error } = await supabase
    .from("offer_scores")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // no rows
    throw error;
  }

  return data as RiskScoreResult;
}

export async function getScoreDistribution(): Promise<
  { grade: string; count: number }[]
> {
  const { data, error } = await supabase
    .from("offer_scores")
    .select("grade");

  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data) {
    counts[row.grade] = (counts[row.grade] || 0) + 1;
  }

  return Object.entries(counts).map(([grade, count]) => ({ grade, count }));
}

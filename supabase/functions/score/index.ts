import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCORING_WEIGHTS = { internal: 0.5, bureau: 0.3, behavioral: 0.2 };

function getGrade(score: number): string {
  if (score >= 850) return "A+";
  if (score >= 700) return "A";
  if (score >= 500) return "B";
  if (score >= 300) return "C";
  return "D";
}

function getCreditLimit(grade: string): number {
  const limits: Record<string, number> = {
    "A+": 500000, A: 300000, B: 200000, C: 100000, D: 50000,
  };
  return limits[grade] ?? 50000;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { deal_id, deal_amount, bu } = await req.json();

    if (!deal_id) {
      return new Response(JSON.stringify({ error: "deal_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Simulate scoring (in production, call ML model + Bureau API + HubSpot)
    const internalScore = Math.min(1000, Math.max(0, 500 + Math.random() * 300 - 100));
    const bureauScore = Math.min(1000, Math.max(0, 500 + Math.random() * 400 - 200));
    const behavioralScore = Math.min(1000, Math.max(0, 500 + Math.random() * 300 - 100));

    const compositeScore = Math.round(
      internalScore * SCORING_WEIGHTS.internal +
      bureauScore * SCORING_WEIGHTS.bureau +
      behavioralScore * SCORING_WEIGHTS.behavioral
    );

    const grade = getGrade(compositeScore);
    const creditLimit = getCreditLimit(grade);

    const scoreResult = {
      deal_id,
      g4_risk_score: compositeScore,
      grade,
      components: {
        internal: { score: Math.round(internalScore), weight: 0.5, contribution: Math.round(internalScore * 0.5), source: "g4_collections_model" },
        bureau: { score: Math.round(bureauScore), weight: 0.3, contribution: Math.round(bureauScore * 0.3), source: "serasa_experian" },
        behavioral: { score: Math.round(behavioralScore), weight: 0.2, contribution: Math.round(behavioralScore * 0.2), source: "hubspot_signals" },
      },
      credit_limit: creditLimit,
      credit_available: creditLimit,
      top_factors: [
        { feature: "receita_total", impact: 120, direction: "positive", description: "Receita total acima da média" },
        { feature: "negociacoes_ganhas", impact: 85, direction: "positive", description: "Histórico de negociações positivo" },
        { feature: "tempo_relacionamento_dias", impact: 60, direction: "positive", description: "Relacionamento de longo prazo" },
        { feature: "dias_desde_ultima_compra", impact: -40, direction: "negative", description: "Tempo desde última compra acima do ideal" },
      ],
      scored_at: new Date().toISOString(),
    };

    // Save to database
    const { data, error } = await supabase
      .from("offer_scores")
      .insert(scoreResult)
      .select()
      .single();

    if (error) throw error;

    // Audit log
    await supabase.from("offer_audit").insert({
      action: "score",
      deal_id,
      details: { score: compositeScore, grade, bu, deal_amount },
    });

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

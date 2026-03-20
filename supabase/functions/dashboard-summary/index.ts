import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const [scores, menus, exceptions] = await Promise.all([
      supabase.from("offer_scores").select("id, g4_risk_score, grade", { count: "exact" }),
      supabase.from("offer_menus").select("id, status", { count: "exact" }),
      supabase.from("offer_exceptions").select("id, status", { count: "exact" }),
    ]);

    const totalScores = scores.count ?? 0;
    const totalMenus = menus.count ?? 0;
    const acceptedMenus = (menus.data ?? []).filter((m: { status: string }) => m.status === "accepted").length;
    const totalExceptions = exceptions.count ?? 0;
    const pendingExceptions = (exceptions.data ?? []).filter((e: { status: string }) => e.status === "pending").length;
    const approvedExceptions = (exceptions.data ?? []).filter((e: { status: string }) => e.status === "approved").length;

    // Score distribution
    const gradeDistribution: Record<string, number> = {};
    for (const score of scores.data ?? []) {
      const s = score as { grade: string };
      gradeDistribution[s.grade] = (gradeDistribution[s.grade] ?? 0) + 1;
    }

    // Average score
    const avgScore = totalScores > 0
      ? Math.round((scores.data ?? []).reduce((sum: number, s: { g4_risk_score: number }) => sum + s.g4_risk_score, 0) / totalScores)
      : 0;

    const summary = {
      total_scores: totalScores,
      total_offers: totalMenus,
      avg_score: avgScore,
      acceptance_rate: totalMenus > 0 ? Math.round((acceptedMenus / totalMenus) * 100) : 0,
      total_exceptions: totalExceptions,
      exceptions_pending: pendingExceptions,
      exceptions_approved: approvedExceptions,
      approval_rate: totalExceptions > 0 ? Math.round((approvedExceptions / totalExceptions) * 100) : 0,
      grade_distribution: gradeDistribution,
    };

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

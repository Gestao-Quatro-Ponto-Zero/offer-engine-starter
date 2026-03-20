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

    const url = new URL(req.url);
    const dealId = url.pathname.split("/").pop();

    if (!dealId) {
      return new Response(JSON.stringify({ error: "deal_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get latest score
    const { data: score } = await supabase
      .from("offer_scores")
      .select("*")
      .eq("deal_id", dealId)
      .order("scored_at", { ascending: false })
      .limit(1)
      .single();

    // Get latest menu
    const { data: menu } = await supabase
      .from("offer_menus")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // HubSpot CRM Card format
    const card = {
      results: [
        {
          objectId: 1,
          title: `G4 Risk Score: ${score?.g4_risk_score ?? "N/A"}`,
          properties: [
            { label: "Grade", dataType: "STRING", value: score?.grade ?? "N/A" },
            { label: "Status", dataType: "STRING", value: menu?.status ?? "pending" },
            { label: "Ofertas", dataType: "NUMERIC", value: String((menu?.offers as unknown[])?.length ?? 0) },
          ],
        },
      ],
    };

    return new Response(JSON.stringify(card), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

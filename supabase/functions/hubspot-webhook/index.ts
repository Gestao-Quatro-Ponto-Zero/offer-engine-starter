import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TRIGGER_STAGES = ["proposal", "negotiation", "qualifiedtobuy"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const events = await req.json();

    for (const event of Array.isArray(events) ? events : [events]) {
      const { subscriptionType, objectId, propertyName, propertyValue } = event;

      // Log the webhook event
      await supabase.from("offer_audit").insert({
        action: "hubspot_webhook",
        deal_id: String(objectId),
        details: { subscriptionType, propertyName, propertyValue },
      });

      // Auto-score on deal stage change to trigger stages
      if (
        subscriptionType === "deal.propertyChange" &&
        propertyName === "dealstage" &&
        TRIGGER_STAGES.includes(propertyValue)
      ) {
        // Invoke the score function
        const scoreUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/score`;
        await fetch(scoreUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            deal_id: String(objectId),
            deal_amount: 0, // Would be fetched from HubSpot in production
            bu: "Scale",
          }),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

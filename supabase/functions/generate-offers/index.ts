import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function calculateInstallmentValue(
  principal: number,
  installments: number,
  monthlyRate: number
): number {
  if (monthlyRate === 0) return principal / installments;
  const r = monthlyRate / 100;
  return (principal * r * Math.pow(1 + r, installments)) / (Math.pow(1 + r, installments) - 1);
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

    if (!deal_id || !deal_amount) {
      return new Response(
        JSON.stringify({ error: "deal_id and deal_amount required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get latest score
    const { data: score, error: scoreError } = await supabase
      .from("offer_scores")
      .select("*")
      .eq("deal_id", deal_id)
      .order("scored_at", { ascending: false })
      .limit(1)
      .single();

    if (scoreError || !score) {
      return new Response(
        JSON.stringify({ error: "Score not found. Score the deal first." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find matching rules
    const { data: rules } = await supabase
      .from("offer_rules")
      .select("*")
      .eq("is_active", true)
      .contains("grades", [score.grade]);

    const matchingRule = (rules ?? []).find(
      (r: { amount_min: number; amount_max: number; bus: string[] }) =>
        deal_amount >= r.amount_min &&
        deal_amount <= r.amount_max &&
        (r.bus.includes("*") || r.bus.includes(bu))
    ) ?? (rules ?? [])[0];

    if (!matchingRule) {
      return new Response(
        JSON.stringify({ error: "No matching rule found for this grade" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate concrete offers from rule options
    const ruleOptions = matchingRule.options as Array<{
      type: string;
      label_template: string;
      installments: number;
      down_payment_pct: number;
      interest_monthly_pct: number;
      discount_pct: number;
      recommended: boolean;
    }>;

    const offers = ruleOptions.map((opt, index: number) => {
      const discountedAmount = deal_amount * (1 - opt.discount_pct / 100);
      const downPaymentValue = discountedAmount * (opt.down_payment_pct / 100);
      const remaining = discountedAmount - downPaymentValue;

      let installmentValue = 0;
      let totalValue = discountedAmount;

      if (opt.installments > 1 && remaining > 0) {
        installmentValue = calculateInstallmentValue(
          remaining,
          opt.installments,
          opt.interest_monthly_pct
        );
        totalValue = downPaymentValue + installmentValue * opt.installments;
      } else {
        installmentValue = discountedAmount;
      }

      return {
        id: `offer_${deal_id}_${index}`,
        type: opt.type,
        label: opt.label_template,
        recommended: opt.recommended,
        installments: opt.installments,
        down_payment_pct: opt.down_payment_pct,
        down_payment_value: Math.round(downPaymentValue * 100) / 100,
        interest_monthly_pct: opt.interest_monthly_pct,
        installment_value: Math.round(installmentValue * 100) / 100,
        total_value: Math.round(totalValue * 100) / 100,
        discount_pct: opt.discount_pct,
        requires_approval: false,
        requires_promissory_note: (matchingRule.restrictions as { requires_promissory_note?: boolean }).requires_promissory_note ?? false,
      };
    });

    // Check approval requirements
    const restrictions = matchingRule.restrictions as {
      requires_contract: boolean;
      requires_promissory_note: boolean;
      approval_manager_above: number | null;
      approval_director_above: number | null;
      credit_limit_max: number;
    };

    if (restrictions.approval_manager_above !== null && deal_amount > restrictions.approval_manager_above) {
      offers.forEach((o: { requires_approval: boolean }) => { o.requires_approval = true; });
    }

    // Smart exits if exceeding credit limit
    let smartExits = null;
    if (deal_amount > restrictions.credit_limit_max) {
      smartExits = [
        {
          type: "split_contract",
          label: "Split Contract",
          description: `Dividir em ${Math.ceil(deal_amount / restrictions.credit_limit_max)} contratos de até ${restrictions.credit_limit_max}`,
          params: { contracts: Math.ceil(deal_amount / restrictions.credit_limit_max), max_per_contract: restrictions.credit_limit_max },
        },
        {
          type: "minimum_down_payment",
          label: "Entrada Mínima",
          description: `Entrada de ${Math.round(((deal_amount - restrictions.credit_limit_max) / deal_amount) * 100)}% para caber no limite`,
          params: { min_down_pct: Math.round(((deal_amount - restrictions.credit_limit_max) / deal_amount) * 100) },
        },
        {
          type: "structured_payment",
          label: "Pagamento Estruturado",
          description: "Início diferido (60 dias) + caução + promissória",
          params: { deferred_days: 60 },
        },
      ];
    }

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7);

    const menu = {
      deal_id,
      score_id: score.id,
      offers,
      restrictions,
      smart_exits: smartExits,
      valid_until: validUntil.toISOString(),
      status: "generated",
      selected_offer_id: null,
    };

    const { data: savedMenu, error: menuError } = await supabase
      .from("offer_menus")
      .insert(menu)
      .select()
      .single();

    if (menuError) throw menuError;

    // Audit log
    await supabase.from("offer_audit").insert({
      action: "generate_offers",
      deal_id,
      details: { menu_id: savedMenu.id, offers_count: offers.length, grade: score.grade, bu },
    });

    return new Response(JSON.stringify(savedMenu), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

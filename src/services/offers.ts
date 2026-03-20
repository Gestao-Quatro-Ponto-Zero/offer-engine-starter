import { supabase } from "@/lib/supabase";
import type { OfferMenu } from "@/types/offers";

export async function generateOffers(
  dealId: string,
  dealAmount: number,
  bu: string
): Promise<OfferMenu> {
  const { data, error } = await supabase.functions.invoke("generate-offers", {
    body: { deal_id: dealId, deal_amount: dealAmount, bu },
  });

  if (error) throw error;

  return data as OfferMenu;
}

export async function getOfferMenu(dealId: string): Promise<OfferMenu | null> {
  const { data, error } = await supabase
    .from("offer_menus")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return data as OfferMenu;
}

export async function selectOffer(
  menuId: string,
  offerId: string
): Promise<void> {
  const { error } = await supabase
    .from("offer_menus")
    .update({
      status: "presented",
      selected_offer_id: offerId,
    })
    .eq("id", menuId);

  if (error) throw error;
}

export async function acceptOffer(menuId: string): Promise<void> {
  const { error } = await supabase
    .from("offer_menus")
    .update({ status: "accepted" })
    .eq("id", menuId);

  if (error) throw error;
}

export async function rejectOffer(menuId: string): Promise<void> {
  const { error } = await supabase
    .from("offer_menus")
    .update({ status: "rejected" })
    .eq("id", menuId);

  if (error) throw error;
}

export async function logAudit(
  action: string,
  dealId: string | null,
  userEmail: string | null,
  details: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("offer_audit").insert({
    action,
    deal_id: dealId,
    user_email: userEmail,
    details,
  });

  if (error) throw error;
}

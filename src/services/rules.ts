import { supabase } from "@/lib/supabase";
import type { OfferRule, RuleHistoryEntry } from "@/types/rules";

export async function getRules(activeOnly?: boolean): Promise<OfferRule[]> {
  let query = supabase.from("offer_rules").select("*");

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw error;

  return data as OfferRule[];
}

export async function getRule(ruleId: string): Promise<OfferRule> {
  const { data, error } = await supabase
    .from("offer_rules")
    .select("*")
    .eq("id", ruleId)
    .single();

  if (error) throw error;

  return data as OfferRule;
}

export async function createRule(
  rule: Omit<OfferRule, "id" | "version" | "created_at" | "updated_at">
): Promise<OfferRule> {
  const { data, error } = await supabase
    .from("offer_rules")
    .insert({ ...rule, version: 1 })
    .select()
    .single();

  if (error) throw error;

  return data as OfferRule;
}

export async function updateRule(
  ruleId: string,
  updates: Partial<OfferRule>,
  changedBy: string
): Promise<OfferRule> {
  // Fetch current rule to snapshot
  const current = await getRule(ruleId);

  // Save snapshot to history
  const { error: historyError } = await supabase
    .from("offer_rules_history")
    .insert({
      rule_id: current.id,
      version: current.version,
      snapshot: current,
      changed_by: changedBy,
    });

  if (historyError) throw historyError;

  // Increment version and apply updates
  const { data, error } = await supabase
    .from("offer_rules")
    .update({
      ...updates,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .select()
    .single();

  if (error) throw error;

  return data as OfferRule;
}

export async function getRuleHistory(
  ruleId: string
): Promise<RuleHistoryEntry[]> {
  const { data, error } = await supabase
    .from("offer_rules_history")
    .select("*")
    .eq("rule_id", ruleId)
    .order("version", { ascending: false });

  if (error) throw error;

  return data as RuleHistoryEntry[];
}

export async function rollbackRule(
  ruleId: string,
  toVersion: number
): Promise<OfferRule> {
  // Find the snapshot for the target version
  const { data: snapshot, error: snapshotError } = await supabase
    .from("offer_rules_history")
    .select("*")
    .eq("rule_id", ruleId)
    .eq("version", toVersion)
    .single();

  if (snapshotError) throw snapshotError;

  const restoredData = snapshot.snapshot as OfferRule;

  // Get current rule to determine new version number
  const current = await getRule(ruleId);

  // Save current state to history before rollback
  const { error: historyError } = await supabase
    .from("offer_rules_history")
    .insert({
      rule_id: current.id,
      version: current.version,
      snapshot: current,
      changed_by: "system:rollback",
    });

  if (historyError) throw historyError;

  // Apply the snapshot with incremented version
  const { id, version, created_at, updated_at, ...fields } = restoredData;

  const { data, error } = await supabase
    .from("offer_rules")
    .update({
      ...fields,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .select()
    .single();

  if (error) throw error;

  return data as OfferRule;
}

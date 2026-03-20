import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getRules, getRule, createRule, updateRule, getRuleHistory } from "@/services/rules";
import type { OfferRule } from "@/types/rules";

export function useRules(activeOnly = true) {
  return useQuery({ queryKey: ["rules", activeOnly], queryFn: () => getRules(activeOnly) });
}

export function useRule(ruleId: string) {
  return useQuery({ queryKey: ["rules", ruleId], queryFn: () => getRule(ruleId), enabled: !!ruleId });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: Omit<OfferRule, "id" | "version" | "created_at" | "updated_at">) => createRule(rule),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, updates, changedBy }: { ruleId: string; updates: Partial<OfferRule>; changedBy: string }) =>
      updateRule(ruleId, updates, changedBy),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
}

export function useRuleHistory(ruleId: string) {
  return useQuery({ queryKey: ["rules", ruleId, "history"], queryFn: () => getRuleHistory(ruleId), enabled: !!ruleId });
}

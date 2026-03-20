import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getScoreDistribution } from "@/services/scoring";
import { getExceptionStats } from "@/services/exceptions";

interface DashboardSummary {
  total_scores: number;
  total_offers: number;
  total_exceptions: number;
  acceptance_rate: number;
  exceptions_pending: number;
}

async function getDashboardSummary(): Promise<DashboardSummary> {
  const [scores, menus, exceptions] = await Promise.all([
    supabase.from("offer_scores").select("id", { count: "exact", head: true }),
    supabase.from("offer_menus").select("id, status", { count: "exact" }),
    supabase.from("offer_exceptions").select("id, status", { count: "exact" }),
  ]);

  const totalMenus = menus.count ?? 0;
  const menuData = (menus.data ?? []) as Array<{ id: string; status: string }>;
  const acceptedMenus = menuData.filter((m) => m.status === "accepted").length;

  const exceptionData = (exceptions.data ?? []) as Array<{ id: string; status: string }>;

  return {
    total_scores: scores.count ?? 0,
    total_offers: totalMenus,
    total_exceptions: exceptions.count ?? 0,
    acceptance_rate: totalMenus > 0 ? (acceptedMenus / totalMenus) * 100 : 0,
    exceptions_pending: exceptionData.filter((e) => e.status === "pending").length,
  };
}

async function getAuditLog(limit = 50) {
  const { data, error } = await supabase
    .from("offer_audit")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export function useDashboardSummary() {
  return useQuery({ queryKey: ["dashboard", "summary"], queryFn: getDashboardSummary });
}

export function useScoreDistribution() {
  return useQuery({ queryKey: ["dashboard", "distribution"], queryFn: getScoreDistribution });
}

export function useExceptionDashboardStats() {
  return useQuery({ queryKey: ["dashboard", "exceptions"], queryFn: getExceptionStats });
}

export function useAuditLog(limit = 50) {
  return useQuery({ queryKey: ["dashboard", "audit", limit], queryFn: () => getAuditLog(limit) });
}

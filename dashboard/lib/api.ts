/**
 * G4 Offers API Client
 *
 * Tipado, com error handling e retry básico.
 */

// "" = mesma origem (backend e front no mesmo host, ex. App Runner)
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL !== undefined
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "g4-offers-2026";

async function fetchAPI<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}/v1${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error ${res.status}: ${error}`);
  }

  return res.json();
}

// =====================================================================
// TYPES (espelham os Pydantic models do backend)
// =====================================================================

export type RiskGrade = "A+" | "A" | "B" | "C" | "D";

export interface ScoreComponent {
  score: number;
  weight: number;
  contribution: number;
  source: string;
  cached: boolean;
  cache_date: string | null;
}

export interface ScoreFactor {
  feature: string;
  value: number | string;
  impact: string;
  direction: "reduz_risco" | "aumenta_risco";
}

export interface RiskScoreResult {
  deal_id: string;
  g4_risk_score: number;
  grade: RiskGrade;
  components: Record<string, ScoreComponent>;
  credit_limit: number;
  credit_available: number;
  top_factors: ScoreFactor[];
  scored_at: string;
}

export interface PaymentOption {
  id: string;
  type: "parcelado" | "avista" | "pix";
  label: string;
  recommended: boolean;
  installments: number;
  down_payment_pct: number;
  down_payment_value: number;
  interest_monthly_pct: number;
  installment_value: number;
  total_value: number;
  discount_pct: number;
  requires_approval: boolean;
  requires_promissory_note: boolean;
}

export interface OfferMenu {
  deal_id: string;
  grade: RiskGrade;
  offers: PaymentOption[];
  restrictions: {
    max_credit_limit: number;
    available_credit: number;
    approval_required_above: number | null;
    promissory_required_above: number | null;
  };
  valid_until: string;
  generated_at: string;
}

export interface OfferRule {
  id: string;
  name: string;
  grades: RiskGrade[];
  bus: string[];
  amount_min: number;
  amount_max: number;
  options: {
    type: "parcelado" | "avista" | "pix";
    label_template: string;
    installments_max: number;
    down_payment_pct: number;
    interest_monthly_pct: number;
    discount_cash_pct: number;
    recommended: boolean;
  }[];
  restrictions: {
    requires_contract: boolean;
    requires_promissory_note: boolean;
    approval_manager_above: number | null;
    approval_director_above: number | null;
    credit_limit_max: number;
  };
  version: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface DashboardSummary {
  total_scores: number;
  total_offers_generated: number;
  average_risk_score: number;
  acceptance_rate: number;
  exceptions_pending: number;
  exceptions_total: number;
}

export interface ExceptionRecord {
  id: string;
  deal_id: string;
  seller_email: string;
  desired_conditions: string;
  justification: string;
  deal_amount: number;
  current_grade: RiskGrade;
  approver_role: string;
  approver_email: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  decision_note: string;
  created_at: string;
  decided_at: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  deal_id: string;
  user: string;
  details: Record<string, unknown>;
  timestamp: string;
}

// =====================================================================
// API CALLS
// =====================================================================

// Dashboard
export const getDashboardSummary = () =>
  fetchAPI<DashboardSummary>("/dashboard/summary");

export const getDashboardDistribution = () =>
  fetchAPI<{ distribution: Record<RiskGrade, number>; total: number }>(
    "/dashboard/distribution"
  );

export const getDashboardExceptions = () =>
  fetchAPI<{
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    approval_rate: number;
  }>("/dashboard/exceptions");

export const getAuditLog = (limit = 50) =>
  fetchAPI<AuditEntry[]>(`/dashboard/audit?limit=${limit}`);

// Scoring
export const scoreDeal = (data: {
  deal_id: string;
  deal_amount: number;
  bu: string;
  company_cnpj?: string;
}) =>
  fetchAPI<RiskScoreResult>("/score", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getScore = (dealId: string) =>
  fetchAPI<RiskScoreResult>(`/score/${dealId}`);

// Offers
export const generateOffers = (data: {
  deal_id: string;
  deal_amount: number;
  bu: string;
}) =>
  fetchAPI<OfferMenu>("/offers/generate", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getOffers = (dealId: string) =>
  fetchAPI<OfferMenu>(`/offers/${dealId}`);

export const selectOffer = (dealId: string, offerId: string, email: string) =>
  fetchAPI<{ status: string }>(`/offers/${dealId}/select`, {
    method: "POST",
    body: JSON.stringify({ offer_id: offerId, seller_email: email }),
  });

export const acceptOffer = (dealId: string, offerId: string, email: string) =>
  fetchAPI<{ status: string }>(`/offers/${dealId}/accept`, {
    method: "POST",
    body: JSON.stringify({ offer_id: offerId, seller_email: email }),
  });

// Rules
export const listRules = (activeOnly = true) =>
  fetchAPI<OfferRule[]>(`/rules?active_only=${activeOnly}`);

export const getRule = (ruleId: string) =>
  fetchAPI<OfferRule>(`/rules/${ruleId}`);

export const createRule = (rule: Partial<OfferRule>) =>
  fetchAPI<OfferRule>("/rules", {
    method: "POST",
    body: JSON.stringify(rule),
  });

export const updateRule = (ruleId: string, updates: Partial<OfferRule>) =>
  fetchAPI<OfferRule>(`/rules/${ruleId}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });

export const getRuleHistory = (ruleId: string) =>
  fetchAPI<OfferRule[]>(`/rules/${ruleId}/history`);

// Health
export const getHealth = () => fetchAPI<Record<string, unknown>>("/health");

// Grade utils
export const GRADE_COLORS: Record<RiskGrade, string> = {
  "A+": "var(--risk-a-plus)",
  A: "var(--risk-a)",
  B: "var(--risk-b)",
  C: "var(--risk-c)",
  D: "var(--risk-d)",
};

export const GRADE_BG: Record<RiskGrade, string> = {
  "A+": "var(--risk-a-plus-bg)",
  A: "var(--risk-a-bg)",
  B: "var(--risk-b-bg)",
  C: "var(--risk-c-bg)",
  D: "var(--risk-d-bg)",
};

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

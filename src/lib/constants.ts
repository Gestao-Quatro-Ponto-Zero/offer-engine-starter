export type RiskGrade = "A+" | "A" | "B" | "C" | "D";

export const GRADE_COLORS: Record<RiskGrade, string> = {
  "A+": "#10b981",
  A: "#22c55e",
  B: "#eab308",
  C: "#f97316",
  D: "#ef4444",
};

export const GRADE_RANGES: Record<RiskGrade, { min: number; max: number }> = {
  "A+": { min: 850, max: 1000 },
  A: { min: 700, max: 849 },
  B: { min: 500, max: 699 },
  C: { min: 300, max: 499 },
  D: { min: 0, max: 299 },
};

export const CREDIT_LIMITS: Record<RiskGrade, number> = {
  "A+": 500000,
  A: 300000,
  B: 200000,
  C: 100000,
  D: 50000,
};

export const SCORING_WEIGHTS = {
  internal: 0.5,
  bureau: 0.3,
  behavioral: 0.2,
} as const;

export const BUS = ["Scale", "Club", "Mentores", "Tools", "Eventos"] as const;

export type BU = (typeof BUS)[number];

export function getGradeFromScore(score: number): RiskGrade {
  if (score >= 850) return "A+";
  if (score >= 700) return "A";
  if (score >= 500) return "B";
  if (score >= 300) return "C";
  return "D";
}

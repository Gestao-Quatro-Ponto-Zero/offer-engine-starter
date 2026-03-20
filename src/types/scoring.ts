import type { RiskGrade } from "@/lib/constants";

export interface ScoreComponent {
  score: number;
  weight: number;
  contribution: number;
  source: string;
}

export interface ScoreFactor {
  feature: string;
  impact: number;
  direction: "positive" | "negative";
  description: string;
}

export interface RiskScoreResult {
  id: string;
  deal_id: string;
  g4_risk_score: number;
  grade: RiskGrade;
  components: {
    internal: ScoreComponent;
    bureau: ScoreComponent;
    behavioral: ScoreComponent;
  };
  credit_limit: number;
  credit_available: number;
  top_factors: ScoreFactor[];
  scored_at: string;
}

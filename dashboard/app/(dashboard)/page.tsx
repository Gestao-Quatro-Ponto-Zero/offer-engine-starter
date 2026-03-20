"use client";

import { useEffect, useState } from "react";
import {
  type DashboardSummary,
  type RiskGrade,
  type AuditEntry,
  getDashboardSummary,
  getDashboardDistribution,
  getDashboardExceptions,
  getAuditLog,
  formatCurrency,
  formatPercent,
  GRADE_COLORS,
} from "@/lib/api";

// =====================================================================
// KPI Card
// =====================================================================

function KPICard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface-primary)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-6)",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="animate-count"
        style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Distribution Bar
// =====================================================================

function DistributionBar({
  distribution,
  total,
}: {
  distribution: Record<RiskGrade, number>;
  total: number;
}) {
  const grades: RiskGrade[] = ["A+", "A", "B", "C", "D"];

  return (
    <div
      style={{
        background: "var(--surface-primary)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-6)",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: "var(--space-4)" }}>
        Distribuição por Faixa de Risco
      </div>

      {/* Stacked bar */}
      <div
        style={{
          display: "flex",
          height: 32,
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
          marginBottom: "var(--space-4)",
        }}
      >
        {grades.map((grade) => {
          const count = distribution[grade] || 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={grade}
              title={`${grade}: ${count} deals (${pct.toFixed(0)}%)`}
              style={{
                width: `${pct}%`,
                background: GRADE_COLORS[grade],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                color: "#fff",
                minWidth: pct > 5 ? "auto" : 0,
              }}
            >
              {pct >= 8 ? `${grade}` : ""}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
        {grades.map((grade) => {
          const count = distribution[grade] || 0;
          const pct = total > 0 ? ((count / total) * 100).toFixed(0) : "0";
          return (
            <div
              key={grade}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: 12,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: GRADE_COLORS[grade],
                }}
              />
              <span style={{ fontWeight: 600 }}>{grade}</span>
              <span style={{ color: "var(--text-tertiary)" }}>
                {count} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// Exceptions Summary
// =====================================================================

function ExceptionsSummary({
  data,
}: {
  data: { total: number; approved: number; rejected: number; pending: number; approval_rate: number };
}) {
  return (
    <div
      style={{
        background: "var(--surface-primary)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-6)",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: "var(--space-4)" }}>
        Exceções
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{data.total}</div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Solicitadas</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--risk-a)" }}>
            {data.approved}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Aprovadas</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--risk-d)" }}>
            {data.rejected}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Rejeitadas</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--risk-c)" }}>
            {data.pending}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Pendentes</div>
        </div>
      </div>
      <div
        style={{
          marginTop: "var(--space-4)",
          padding: "var(--space-3)",
          background: "var(--surface-tertiary)",
          borderRadius: "var(--radius-sm)",
          fontSize: 12,
          textAlign: "center",
        }}
      >
        Taxa de aprovação: <strong>{formatPercent(data.approval_rate)}</strong>
      </div>
    </div>
  );
}

// =====================================================================
// Activity Feed
// =====================================================================

const ACTION_LABELS: Record<string, string> = {
  score: "Score calculado",
  generate_offers: "Ofertas geradas",
  select_offer: "Oferta apresentada",
  accept_offer: "Oferta aceita",
  reject_offer: "Oferta rejeitada",
  request_exception: "Exceção solicitada",
  approve_exception: "Exceção aprovada",
  reject_exception: "Exceção rejeitada",
  create_rule: "Regra criada",
  update_rule: "Regra atualizada",
};

const ACTION_ICONS: Record<string, string> = {
  score: "🎯",
  generate_offers: "📋",
  select_offer: "👆",
  accept_offer: "✅",
  reject_offer: "❌",
  request_exception: "🔓",
  approve_exception: "✅",
  reject_exception: "❌",
  create_rule: "⚙️",
  update_rule: "⚙️",
};

function ActivityFeed({ entries }: { entries: AuditEntry[] }) {
  return (
    <div
      style={{
        background: "var(--surface-primary)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-6)",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: "var(--space-4)" }}>
        Atividade Recente
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {entries.slice(0, 10).map((entry) => (
          <div
            key={entry.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-2) 0",
              borderBottom: "1px solid var(--border-subtle)",
              fontSize: 13,
            }}
          >
            <span>{ACTION_ICONS[entry.action] || "📌"}</span>
            <span style={{ flex: 1 }}>
              <strong>{ACTION_LABELS[entry.action] || entry.action}</strong>
              {entry.deal_id && (
                <span style={{ color: "var(--text-tertiary)" }}>
                  {" "}
                  — Deal {entry.deal_id}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
              {new Date(entry.timestamp).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ))}
        {entries.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", textAlign: "center", padding: "var(--space-6) 0" }}>
            Nenhuma atividade ainda
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// DASHBOARD PAGE
// =====================================================================

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [distribution, setDistribution] = useState<{
    distribution: Record<RiskGrade, number>;
    total: number;
  } | null>(null);
  const [exceptions, setExceptions] = useState<{
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    approval_rate: number;
  } | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, d, e, a] = await Promise.all([
          getDashboardSummary(),
          getDashboardDistribution(),
          getDashboardExceptions(),
          getAuditLog(20),
        ]);
        setSummary(s);
        setDistribution(d);
        setExceptions(e);
        setAudit(a);
      } catch (err) {
        console.error("Dashboard load error:", err);
        // Fallback com dados zerados
        setSummary({
          total_scores: 0,
          total_offers_generated: 0,
          average_risk_score: 0,
          acceptance_rate: 0,
          exceptions_pending: 0,
          exceptions_total: 0,
        });
        setDistribution({
          distribution: { "A+": 0, A: 0, B: 0, C: 0, D: 0 },
          total: 0,
        });
        setExceptions({
          total: 0,
          approved: 0,
          rejected: 0,
          pending: 0,
          approval_rate: 0,
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 120, borderRadius: "var(--radius-lg)" }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* Page Title */}
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Painel de Ofertas
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
          Visão geral do sistema de condições de pagamento
        </p>
      </div>

      {/* KPIs */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-4)" }}>
          <KPICard
            label="Deals Scorados"
            value={summary.total_scores.toLocaleString("pt-BR")}
          />
          <KPICard
            label="Ofertas Geradas"
            value={summary.total_offers_generated.toLocaleString("pt-BR")}
          />
          <KPICard
            label="Score Médio"
            value={summary.average_risk_score.toString()}
            subtitle="0 = alto risco, 1000 = excelente"
          />
          <KPICard
            label="Taxa de Aceitação"
            value={formatPercent(summary.acceptance_rate)}
          />
        </div>
      )}

      {/* Grid: Distribution + Exceptions */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--space-4)" }}>
        {distribution && (
          <DistributionBar
            distribution={distribution.distribution}
            total={distribution.total}
          />
        )}
        {exceptions && <ExceptionsSummary data={exceptions} />}
      </div>

      {/* Activity Feed */}
      <ActivityFeed entries={audit} />
    </div>
  );
}

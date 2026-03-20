"use client";

import { useEffect, useState } from "react";
import {
  type AuditEntry,
  type RiskGrade,
  getAuditLog,
  getDashboardExceptions,
  formatCurrency,
  GRADE_COLORS,
  GRADE_BG,
} from "@/lib/api";

// =====================================================================
// TYPES
// =====================================================================

interface ExceptionItem {
  id: string;
  deal_id: string;
  seller: string;
  conditions: string;
  justification: string;
  amount: number;
  grade: RiskGrade;
  approver_role: string;
  status: "pending" | "approved" | "rejected";
  timestamp: string;
}

// =====================================================================
// STATUS BADGE
// =====================================================================

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: "var(--risk-b-bg)", color: "var(--risk-b)", label: "Pendente" },
  approved: { bg: "var(--risk-a-bg)", color: "var(--risk-a)", label: "Aprovada" },
  rejected: { bg: "var(--risk-d-bg)", color: "var(--risk-d)", label: "Rejeitada" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 10,
        background: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </span>
  );
}

// =====================================================================
// PAGE
// =====================================================================

export default function ExceptionsPage() {
  const [summary, setSummary] = useState<{
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
        const [exc, log] = await Promise.all([
          getDashboardExceptions(),
          getAuditLog(100),
        ]);
        setSummary(exc);
        setAudit(log.filter((e) => e.action.includes("exception")));
      } catch {
        setSummary({ total: 0, approved: 0, rejected: 0, pending: 0, approval_rate: 0 });
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
          <div key={i} className="skeleton" style={{ height: 80, borderRadius: "var(--radius-lg)" }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Exceções</h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
          Solicitações de condições fora do padrão
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "var(--space-4)",
            marginBottom: "var(--space-6)",
          }}
        >
          <div
            style={{
              background: "var(--surface-primary)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4)",
              textAlign: "center",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700 }}>{summary.total}</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Total</div>
          </div>
          <div
            style={{
              background: "var(--risk-b-bg)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4)",
              textAlign: "center",
              border: "1px solid var(--risk-b)",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--risk-b)" }}>
              {summary.pending}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Pendentes</div>
          </div>
          <div
            style={{
              background: "var(--risk-a-bg)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4)",
              textAlign: "center",
              border: "1px solid var(--risk-a)",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--risk-a)" }}>
              {summary.approved}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Aprovadas</div>
          </div>
          <div
            style={{
              background: "var(--risk-d-bg)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4)",
              textAlign: "center",
              border: "1px solid var(--risk-d)",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--risk-d)" }}>
              {summary.rejected}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Rejeitadas</div>
          </div>
        </div>
      )}

      {/* Alert: high exception rate */}
      {summary && summary.total > 0 && summary.approval_rate > 0.7 && (
        <div
          style={{
            background: "var(--risk-c-bg)",
            border: "1px solid var(--risk-c)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            marginBottom: "var(--space-4)",
            fontSize: 13,
            color: "var(--risk-c)",
          }}
        >
          Taxa de aprovação alta ({(summary.approval_rate * 100).toFixed(0)}%) — considere
          flexibilizar as regras das faixas com mais exceções.
        </div>
      )}

      {/* Exception list */}
      <div
        style={{
          background: "var(--surface-primary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "var(--space-4)",
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Histórico de Exceções
        </div>

        {audit.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-8)",
              color: "var(--text-tertiary)",
              fontSize: 13,
            }}
          >
            Nenhuma exceção registrada
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "100px 1fr 1fr 120px 100px",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--surface-secondary)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <span>Data</span>
              <span>Ação</span>
              <span>Deal</span>
              <span>Usuário</span>
              <span>Status</span>
            </div>

            {/* Rows */}
            {audit.map((entry) => {
              const status = entry.action.includes("approve")
                ? "approved"
                : entry.action.includes("reject")
                ? "rejected"
                : "pending";

              return (
                <div
                  key={entry.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "100px 1fr 1fr 120px 100px",
                    padding: "var(--space-3) var(--space-4)",
                    borderBottom: "1px solid var(--border-subtle)",
                    fontSize: 13,
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                    {new Date(entry.timestamp).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </span>
                  <span>
                    {entry.action === "request_exception"
                      ? "Exceção solicitada"
                      : entry.action === "approve_exception"
                      ? "Exceção aprovada"
                      : "Exceção rejeitada"}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {entry.deal_id || "—"}
                  </span>
                  <span style={{ fontSize: 12 }}>{entry.user || "—"}</span>
                  <StatusBadge status={status} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useRules } from "@/hooks/useRules";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency } from "@/lib/utils";
import { GRADE_COLORS, type RiskGrade } from "@/lib/constants";
import { Plus, Pencil, History, ChevronRight } from "lucide-react";
import type { OfferRule } from "@/types/rules";
import RuleEditor from "@/components/rules/RuleEditor";
import RuleHistoryPanel from "@/components/rules/RuleHistoryPanel";

export default function Rules() {
  const { data: rules, isLoading } = useRules(false);
  const { isAdmin } = useAuth();
  const [editingRule, setEditingRule] = useState<OfferRule | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [historyRuleId, setHistoryRuleId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (editingRule || creatingNew) {
    return (
      <RuleEditor
        rule={editingRule}
        onClose={() => {
          setEditingRule(null);
          setCreatingNew(false);
        }}
      />
    );
  }

  if (historyRuleId) {
    return (
      <RuleHistoryPanel
        ruleId={historyRuleId}
        onClose={() => setHistoryRuleId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Regras de Condições</h2>
          <p className="text-sm text-muted-foreground">
            Configure as condições de pagamento por grade de risco
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreatingNew(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova Regra
          </button>
        )}
      </div>

      <div className="grid gap-4">
        {(rules ?? []).map((rule) => (
          <div
            key={rule.id}
            className="bg-card rounded-xl border p-6 hover:border-primary/30 transition-colors"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">{rule.name}</h3>
                  {!rule.is_active && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                      Inativa
                    </span>
                  )}
                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
                    v{rule.version}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {(rule.grades as RiskGrade[]).map((grade) => (
                    <span
                      key={grade}
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: `${GRADE_COLORS[grade]}20`,
                        color: GRADE_COLORS[grade],
                      }}
                    >
                      {grade}
                    </span>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {formatCurrency(rule.amount_min)} -{" "}
                    {formatCurrency(rule.amount_max)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHistoryRuleId(rule.id)}
                  className="p-2 rounded-md hover:bg-accent transition-colors"
                  title="Histórico"
                >
                  <History className="h-4 w-4 text-muted-foreground" />
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setEditingRule(rule)}
                    className="p-2 rounded-md hover:bg-accent transition-colors"
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* Payment options summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {((rule.options ?? []) as Array<{ type: string; label_template: string; installments: number; down_payment_pct: number; discount_pct: number; recommended: boolean }>).map(
                (opt, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 text-sm ${
                      opt.recommended ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      {opt.recommended && (
                        <ChevronRight className="h-3 w-3 text-primary" />
                      )}
                      <span className="font-medium">{opt.label_template}</span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>{opt.installments}x parcelas</p>
                      {opt.down_payment_pct > 0 && (
                        <p>Entrada: {opt.down_payment_pct}%</p>
                      )}
                      {opt.discount_pct > 0 && (
                        <p>Desconto: {opt.discount_pct}%</p>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Restrictions */}
            <div className="mt-4 pt-3 border-t flex flex-wrap gap-2">
              {(rule.restrictions as { requires_promissory_note?: boolean; approval_manager_above?: number | null; approval_director_above?: number | null; credit_limit_max?: number }).requires_promissory_note && (
                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                  Promissória obrigatória
                </span>
              )}
              {(rule.restrictions as { approval_manager_above?: number | null }).approval_manager_above != null && (
                <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
                  Manager acima de{" "}
                  {formatCurrency(
                    (rule.restrictions as { approval_manager_above: number })
                      .approval_manager_above
                  )}
                </span>
              )}
              {(rule.restrictions as { approval_director_above?: number | null }).approval_director_above != null && (
                <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                  Diretor acima de{" "}
                  {formatCurrency(
                    (rule.restrictions as { approval_director_above: number })
                      .approval_director_above
                  )}
                </span>
              )}
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                Limite:{" "}
                {formatCurrency(
                  (rule.restrictions as { credit_limit_max: number })
                    .credit_limit_max ?? 0
                )}
              </span>
            </div>
          </div>
        ))}

        {(rules ?? []).length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            Nenhuma regra cadastrada
          </div>
        )}
      </div>
    </div>
  );
}

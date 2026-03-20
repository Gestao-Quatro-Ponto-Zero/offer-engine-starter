"use client";

import { useEffect, useState, useCallback } from "react";
import {
  type OfferRule,
  type RiskGrade,
  listRules,
  createRule,
  updateRule,
  GRADE_COLORS,
  GRADE_BG,
  formatCurrency,
} from "@/lib/api";

// =====================================================================
// TYPES
// =====================================================================

interface OptionDraft {
  type: "parcelado" | "avista" | "pix";
  label_template: string;
  installments_max: number;
  down_payment_pct: number;
  interest_monthly_pct: number;
  discount_cash_pct: number;
  recommended: boolean;
}

interface RuleDraft {
  name: string;
  grades: RiskGrade[];
  bus: string[];
  amount_min: number;
  amount_max: number;
  options: OptionDraft[];
  restrictions: {
    requires_contract: boolean;
    requires_promissory_note: boolean;
    approval_manager_above: number | null;
    approval_director_above: number | null;
    credit_limit_max: number;
  };
}

const EMPTY_OPTION: OptionDraft = {
  type: "parcelado",
  label_template: "{parcelas}x sem juros",
  installments_max: 6,
  down_payment_pct: 0,
  interest_monthly_pct: 0,
  discount_cash_pct: 0,
  recommended: false,
};

const EMPTY_RULE: RuleDraft = {
  name: "",
  grades: ["B"],
  bus: ["*"],
  amount_min: 0,
  amount_max: 999999999,
  options: [{ ...EMPTY_OPTION, recommended: true }],
  restrictions: {
    requires_contract: true,
    requires_promissory_note: false,
    approval_manager_above: null,
    approval_director_above: null,
    credit_limit_max: 200000,
  },
};

const ALL_GRADES: RiskGrade[] = ["A+", "A", "B", "C", "D"];
const ALL_BUS = ["Scale", "Club", "Skills", "IM e Sprints"];

// =====================================================================
// SLIDER COMPONENT
// =====================================================================

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = "",
  formatValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  formatValue?: (v: number) => string;
}) {
  const displayValue = formatValue ? formatValue(value) : `${value}${suffix}`;
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginBottom: 4,
        }}
      >
        <span style={{ color: "var(--text-secondary)" }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{displayValue}</span>
      </div>
      <div style={{ position: "relative", height: 24, display: "flex", alignItems: "center" }}>
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: 4,
            background: "var(--surface-tertiary)",
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: `${pct}%`,
            height: 4,
            background: "var(--accent)",
            borderRadius: 2,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            position: "absolute",
            width: "100%",
            height: 24,
            opacity: 0,
            cursor: "pointer",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            transform: "translateX(-50%)",
            width: 16,
            height: 16,
            borderRadius: 8,
            background: "var(--accent)",
            border: "2px solid var(--surface-primary)",
            boxShadow: "var(--shadow-md)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

// =====================================================================
// OPTION EDITOR
// =====================================================================

function OptionEditor({
  option,
  index,
  onChange,
  onRemove,
  dealPreviewAmount,
}: {
  option: OptionDraft;
  index: number;
  onChange: (opt: OptionDraft) => void;
  onRemove: () => void;
  dealPreviewAmount: number;
}) {
  // Calcular preview
  const downValue = dealPreviewAmount * (option.down_payment_pct / 100);
  const financed = dealPreviewAmount - downValue;
  let installmentValue = 0;
  let totalValue = 0;

  if (option.type === "avista" || option.type === "pix") {
    totalValue = dealPreviewAmount * (1 - option.discount_cash_pct / 100);
    installmentValue = totalValue;
  } else {
    if (option.interest_monthly_pct <= 0) {
      installmentValue = option.installments_max > 0 ? financed / option.installments_max : financed;
    } else {
      const r = option.interest_monthly_pct / 100;
      const n = option.installments_max;
      installmentValue = financed * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }
    totalValue = downValue + installmentValue * option.installments_max;
  }

  return (
    <div
      style={{
        background: option.recommended ? "var(--accent-light)" : "var(--surface-secondary)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-4)",
        border: option.recommended ? "2px solid var(--accent)" : "1px solid var(--border)",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Opção {index + 1}</span>
          {option.recommended && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                background: "var(--accent)",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: 10,
              }}
            >
              RECOMENDADA
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            onClick={() => onChange({ ...option, recommended: !option.recommended })}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface-primary)",
              cursor: "pointer",
            }}
          >
            {option.recommended ? "Remover destaque" : "Destacar"}
          </button>
          <button
            onClick={onRemove}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--risk-d)",
              color: "var(--risk-d)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Remover
          </button>
        </div>
      </div>

      {/* Type toggle */}
      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        {(["parcelado", "pix", "avista"] as const).map((t) => (
          <button
            key={t}
            onClick={() => onChange({ ...option, type: t })}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: option.type === t ? "var(--text-primary)" : "var(--surface-primary)",
              color: option.type === t ? "#fff" : "var(--text-secondary)",
              cursor: "pointer",
              fontWeight: option.type === t ? 600 : 400,
            }}
          >
            {t === "parcelado" ? "Cartao" : t === "pix" ? "Pix" : "Boleto"}
          </button>
        ))}
      </div>

      {/* Sliders */}
      {option.type === "parcelado" ? (
        <>
          <Slider
            label="Parcelas"
            value={option.installments_max}
            onChange={(v) => onChange({ ...option, installments_max: v })}
            min={1}
            max={12}
            suffix="x"
          />
          <Slider
            label="Entrada"
            value={option.down_payment_pct}
            onChange={(v) => onChange({ ...option, down_payment_pct: v })}
            min={0}
            max={100}
            step={5}
            suffix="%"
          />
          <Slider
            label="Juros a.m."
            value={option.interest_monthly_pct}
            onChange={(v) => onChange({ ...option, interest_monthly_pct: v })}
            min={0}
            max={5}
            step={0.5}
            suffix="% a.m."
          />
        </>
      ) : (
        <Slider
          label={option.type === "pix" ? "Desconto Pix" : "Desconto boleto"}
          value={option.discount_cash_pct}
          onChange={(v) => onChange({ ...option, discount_cash_pct: v })}
          min={0}
          max={20}
          step={1}
          suffix="%"
        />
      )}

      {/* Preview */}
      <div
        style={{
          marginTop: "var(--space-3)",
          padding: "var(--space-3)",
          background: "var(--surface-primary)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-subtle)",
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--text-secondary)" }}>
          Preview (deal de {formatCurrency(dealPreviewAmount)}):
        </div>
        {option.type === "parcelado" ? (
          <div>
            <strong>{option.installments_max}x de {formatCurrency(Math.round(installmentValue))} no cartao</strong>
            {option.interest_monthly_pct > 0 ? ` com juros (${option.interest_monthly_pct}% a.m.)` : " sem juros"}
            {option.down_payment_pct > 0 && (
              <span> + entrada de {formatCurrency(Math.round(downValue))} ({option.down_payment_pct}%)</span>
            )}
            <div style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
              Total: {formatCurrency(Math.round(totalValue))}
            </div>
          </div>
        ) : (
          <div>
            <strong>{option.type === "pix" ? "Pix" : "Boleto"}: {formatCurrency(Math.round(totalValue))}</strong>
            <span style={{ color: "var(--risk-a)" }}> ({option.discount_cash_pct}% off)</span>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// RULE EDITOR
// =====================================================================

function RuleEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: OfferRule;
  onSave: (rule: RuleDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(
    initial
      ? {
          name: initial.name,
          grades: initial.grades,
          bus: initial.bus,
          amount_min: initial.amount_min,
          amount_max: initial.amount_max,
          options: initial.options,
          restrictions: initial.restrictions,
        }
      : { ...EMPTY_RULE }
  );
  const [previewAmount, setPreviewAmount] = useState(50000);

  const updateOption = (index: number, opt: OptionDraft) => {
    const options = [...draft.options];
    options[index] = opt;
    setDraft({ ...draft, options });
  };

  const removeOption = (index: number) => {
    setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) });
  };

  const addOption = () => {
    if (draft.options.length >= 3) return;
    setDraft({ ...draft, options: [...draft.options, { ...EMPTY_OPTION }] });
  };

  return (
    <div
      style={{
        background: "var(--surface-primary)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-6)",
        boxShadow: "var(--shadow-md)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Name */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
          Nome da Regra
        </label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Ex: Premium Scale - Condições Gold"
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            fontSize: 14,
            outline: "none",
          }}
        />
      </div>

      {/* Grades + BU */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            Faixas de Risco
          </label>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {ALL_GRADES.map((g) => {
              const active = draft.grades.includes(g);
              return (
                <button
                  key={g}
                  onClick={() => {
                    const grades = active
                      ? draft.grades.filter((x) => x !== g)
                      : [...draft.grades, g];
                    setDraft({ ...draft, grades });
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid",
                    borderColor: active ? GRADE_COLORS[g] : "var(--border)",
                    background: active ? GRADE_BG[g] : "transparent",
                    color: active ? GRADE_COLORS[g] : "var(--text-tertiary)",
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>
            Business Units
          </label>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button
              onClick={() => setDraft({ ...draft, bus: ["*"] })}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: draft.bus[0] === "*" ? "var(--text-primary)" : "transparent",
                color: draft.bus[0] === "*" ? "#fff" : "var(--text-secondary)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Todas
            </button>
            {ALL_BUS.map((bu) => {
              const active = draft.bus.includes(bu);
              return (
                <button
                  key={bu}
                  onClick={() => {
                    let bus: string[];
                    if (active) {
                      bus = draft.bus.filter((x) => x !== bu);
                      if (bus.length === 0) bus = ["*"];
                    } else {
                      bus = draft.bus.filter((x) => x !== "*");
                      bus.push(bu);
                    }
                    setDraft({ ...draft, bus });
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: active ? "var(--accent-light)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {bu}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Preview Amount Slider */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <Slider
          label="Valor do deal para preview"
          value={previewAmount}
          onChange={setPreviewAmount}
          min={5000}
          max={500000}
          step={5000}
          formatValue={formatCurrency}
        />
      </div>

      {/* Options */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>
          Opções de Pagamento ({draft.options.length}/3)
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {draft.options.map((opt, i) => (
            <OptionEditor
              key={i}
              option={opt}
              index={i}
              onChange={(o) => updateOption(i, o)}
              onRemove={() => removeOption(i)}
              dealPreviewAmount={previewAmount}
            />
          ))}
        </div>
        {draft.options.length < 3 && (
          <button
            onClick={addOption}
            style={{
              marginTop: "var(--space-3)",
              width: "100%",
              padding: "10px",
              borderRadius: "var(--radius-md)",
              border: "2px dashed var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            + Adicionar opção
          </button>
        )}
      </div>

      {/* Restrictions */}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>
          Restrições
        </label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-3)",
            background: "var(--surface-secondary)",
            padding: "var(--space-4)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {/* Checkboxes */}
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={draft.restrictions.requires_promissory_note}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  restrictions: { ...draft.restrictions, requires_promissory_note: e.target.checked },
                })
              }
            />
            Nota promissória obrigatória
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={draft.restrictions.requires_contract}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  restrictions: { ...draft.restrictions, requires_contract: e.target.checked },
                })
              }
            />
            Contrato obrigatório
          </label>

          {/* Numeric */}
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>
              Aprovação gerente acima de
            </div>
            <input
              type="number"
              value={draft.restrictions.approval_manager_above ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  restrictions: {
                    ...draft.restrictions,
                    approval_manager_above: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
              placeholder="Nunca"
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                fontSize: 13,
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>
              Limite de crédito máximo
            </div>
            <input
              type="number"
              value={draft.restrictions.credit_limit_max}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  restrictions: {
                    ...draft.restrictions,
                    credit_limit_max: Number(e.target.value) || 0,
                  },
                })
              }
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                fontSize: 13,
              }}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "10px 20px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            background: "var(--surface-primary)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Cancelar
        </button>
        <button
          onClick={() => onSave(draft)}
          disabled={!draft.name || draft.grades.length === 0 || draft.options.length === 0}
          style={{
            padding: "10px 24px",
            borderRadius: "var(--radius-md)",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            opacity: !draft.name || draft.grades.length === 0 ? 0.5 : 1,
          }}
        >
          Publicar Regra
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// RULES LIST PAGE
// =====================================================================

export default function RulesPage() {
  const [rules, setRules] = useState<OfferRule[]>([]);
  const [editing, setEditing] = useState(false);
  const [editingRule, setEditingRule] = useState<OfferRule | undefined>();
  const [loading, setLoading] = useState(true);

  const loadRules = useCallback(async () => {
    try {
      const data = await listRules(false);
      setRules(data);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const handleSave = async (draft: RuleDraft) => {
    try {
      if (editingRule) {
        await updateRule(editingRule.id, draft);
      } else {
        await createRule(draft as unknown as Partial<OfferRule>);
      }
      setEditing(false);
      setEditingRule(undefined);
      loadRules();
    } catch (err) {
      console.error("Save failed:", err);
    }
  };

  if (editing) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: "var(--space-4)" }}>
          {editingRule ? "Editar Regra" : "Nova Regra"}
        </h2>
        <RuleEditor
          initial={editingRule}
          onSave={handleSave}
          onCancel={() => {
            setEditing(false);
            setEditingRule(undefined);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--space-6)",
        }}
      >
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Regras de Oferta</h2>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            Configure condições de pagamento por faixa de risco
          </p>
        </div>
        <button
          onClick={() => setEditing(true)}
          style={{
            padding: "10px 20px",
            borderRadius: "var(--radius-md)",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Nova Regra
        </button>
      </div>

      {/* Default rules info */}
      <div
        style={{
          background: "var(--accent-light)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-4)",
          marginBottom: "var(--space-4)",
          fontSize: 13,
          color: "var(--accent)",
          border: "1px solid var(--accent)",
        }}
      >
        O sistema usa 5 regras default (A+ a D) quando não há regras customizadas.
        Crie regras customizadas para sobrescrever as default por faixa/BU.
      </div>

      {/* Rules list */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 80, borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "var(--space-8)",
            color: "var(--text-tertiary)",
            fontSize: 14,
          }}
        >
          Nenhuma regra customizada criada.
          <br />
          O sistema está usando as regras default.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              style={{
                background: "var(--surface-primary)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-4)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer",
              }}
              onClick={() => {
                setEditingRule(rule);
                setEditing(true);
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{rule.name}</div>
                <div
                  style={{
                    display: "flex",
                    gap: "var(--space-2)",
                    marginTop: 4,
                    alignItems: "center",
                  }}
                >
                  {rule.grades.map((g) => (
                    <span
                      key={g}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background: GRADE_BG[g],
                        color: GRADE_COLORS[g],
                        fontWeight: 600,
                      }}
                    >
                      {g}
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {rule.options.length} opções
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    v{rule.version}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <span
                  style={{
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: "var(--radius-sm)",
                    background: rule.is_active ? "var(--risk-a-bg)" : "var(--risk-d-bg)",
                    color: rule.is_active ? "var(--risk-a)" : "var(--risk-d)",
                    fontWeight: 600,
                  }}
                >
                  {rule.is_active ? "Ativa" : "Inativa"}
                </span>
                <span style={{ fontSize: 18, color: "var(--text-tertiary)" }}>›</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

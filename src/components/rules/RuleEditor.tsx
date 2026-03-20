import { useState } from "react";
import { useCreateRule, useUpdateRule } from "@/hooks/useRules";
import { useAuth } from "@/contexts/AuthContext";
import type { OfferRule, PaymentOptionRule, RuleRestrictions } from "@/types/rules";
import type { RiskGrade } from "@/lib/constants";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

const ALL_GRADES: RiskGrade[] = ["A+", "A", "B", "C", "D"];
const OFFER_TYPES = [
  { value: "parcelado", label: "Parcelado (Cartão)" },
  { value: "pix", label: "Pix" },
  { value: "avista", label: "À Vista (Boleto)" },
  { value: "estruturado", label: "Estruturado" },
] as const;

interface Props {
  rule: OfferRule | null;
  onClose: () => void;
}

export default function RuleEditor({ rule, onClose }: Props) {
  const { user } = useAuth();
  const createMutation = useCreateRule();
  const updateMutation = useUpdateRule();

  const [name, setName] = useState(rule?.name ?? "");
  const [grades, setGrades] = useState<RiskGrade[]>(
    (rule?.grades as RiskGrade[]) ?? ["B"]
  );
  const [bus] = useState<string[]>(rule?.bus ?? ["*"]);
  const [amountMin, setAmountMin] = useState(rule?.amount_min ?? 0);
  const [amountMax, setAmountMax] = useState(rule?.amount_max ?? 999999999);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [options, setOptions] = useState<PaymentOptionRule[]>(
    (rule?.options as PaymentOptionRule[]) ?? [
      {
        type: "parcelado",
        label_template: "",
        installments: 10,
        down_payment_pct: 0,
        interest_monthly_pct: 0,
        discount_pct: 0,
        recommended: true,
      },
    ]
  );
  const [restrictions, setRestrictions] = useState<RuleRestrictions>(
    (rule?.restrictions as RuleRestrictions) ?? {
      requires_contract: true,
      requires_promissory_note: false,
      approval_manager_above: null,
      approval_director_above: null,
      credit_limit_max: 200000,
    }
  );

  const toggleGrade = (g: RiskGrade) => {
    setGrades((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  };

  const addOption = () => {
    setOptions((prev) => [
      ...prev,
      {
        type: "pix",
        label_template: "",
        installments: 1,
        down_payment_pct: 100,
        interest_monthly_pct: 0,
        discount_pct: 0,
        recommended: false,
      },
    ]);
  };

  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateOption = (index: number, updates: Partial<PaymentOptionRule>) => {
    setOptions((prev) =>
      prev.map((opt, i) => (i === index ? { ...opt, ...updates } : opt))
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (grades.length === 0) {
      toast.error("Selecione ao menos uma grade");
      return;
    }

    try {
      if (rule) {
        await updateMutation.mutateAsync({
          ruleId: rule.id,
          updates: {
            name,
            grades,
            bus,
            amount_min: amountMin,
            amount_max: amountMax,
            is_active: isActive,
            options: options as unknown as OfferRule["options"],
            restrictions: restrictions as unknown as OfferRule["restrictions"],
          },
          changedBy: user?.email ?? "unknown",
        });
        toast.success("Regra atualizada");
      } else {
        await createMutation.mutateAsync({
          name,
          grades,
          bus,
          amount_min: amountMin,
          amount_max: amountMax,
          is_active: isActive,
          options: options as unknown as OfferRule["options"],
          restrictions: restrictions as unknown as OfferRule["restrictions"],
          created_by: user?.email ?? "unknown",
        });
        toast.success("Regra criada");
      }
      onClose();
    } catch {
      toast.error("Erro ao salvar regra");
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-2 rounded-md hover:bg-accent transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-xl font-bold">
          {rule ? "Editar Regra" : "Nova Regra"}
        </h2>
      </div>

      {/* Basic Info */}
      <div className="bg-card rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold text-sm">Informações Básicas</h3>

        <div>
          <label className="text-sm font-medium mb-1 block">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            placeholder="Ex: Grade A+ - Premium"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Grades</label>
          <div className="flex gap-2">
            {ALL_GRADES.map((g) => (
              <button
                key={g}
                onClick={() => toggleGrade(g)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  grades.includes(g)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-accent"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Valor Mínimo</label>
            <input
              type="number"
              value={amountMin}
              onChange={(e) => setAmountMin(Number(e.target.value))}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Valor Máximo</label>
            <input
              type="number"
              value={amountMax}
              onChange={(e) => setAmountMax(Number(e.target.value))}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded"
          />
          Regra ativa
        </label>
      </div>

      {/* Payment Options */}
      <div className="bg-card rounded-xl border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Opções de Pagamento</h3>
          <button
            onClick={addOption}
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Plus className="h-3 w-3" />
            Adicionar
          </button>
        </div>

        {options.map((opt, i) => (
          <div key={i} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Opção {i + 1}</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="radio"
                    name="recommended"
                    checked={opt.recommended}
                    onChange={() => {
                      setOptions((prev) =>
                        prev.map((o, j) => ({ ...o, recommended: j === i }))
                      );
                    }}
                  />
                  Recomendado
                </label>
                {options.length > 1 && (
                  <button
                    onClick={() => removeOption(i)}
                    className="p-1 text-red-500 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Tipo
                </label>
                <select
                  value={opt.type}
                  onChange={(e) =>
                    updateOption(i, { type: e.target.value as PaymentOptionRule["type"] })
                  }
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                >
                  {OFFER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Label
                </label>
                <input
                  type="text"
                  value={opt.label_template}
                  onChange={(e) =>
                    updateOption(i, { label_template: e.target.value })
                  }
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                  placeholder="12x sem juros"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Parcelas
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={opt.installments}
                  onChange={(e) =>
                    updateOption(i, { installments: Number(e.target.value) })
                  }
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Entrada (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={opt.down_payment_pct}
                  onChange={(e) =>
                    updateOption(i, { down_payment_pct: Number(e.target.value) })
                  }
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Juros a.m. (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={opt.interest_monthly_pct}
                  onChange={(e) =>
                    updateOption(i, {
                      interest_monthly_pct: Number(e.target.value),
                    })
                  }
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Desconto (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={opt.discount_pct}
                  onChange={(e) =>
                    updateOption(i, { discount_pct: Number(e.target.value) })
                  }
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Restrictions */}
      <div className="bg-card rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold text-sm">Restrições</h3>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={restrictions.requires_contract}
              onChange={(e) =>
                setRestrictions((r) => ({
                  ...r,
                  requires_contract: e.target.checked,
                }))
              }
              className="rounded"
            />
            Contrato obrigatório
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={restrictions.requires_promissory_note}
              onChange={(e) =>
                setRestrictions((r) => ({
                  ...r,
                  requires_promissory_note: e.target.checked,
                }))
              }
              className="rounded"
            />
            Promissória obrigatória
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Manager acima de (R$)
            </label>
            <input
              type="number"
              value={restrictions.approval_manager_above ?? ""}
              onChange={(e) =>
                setRestrictions((r) => ({
                  ...r,
                  approval_manager_above: e.target.value
                    ? Number(e.target.value)
                    : null,
                }))
              }
              className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
              placeholder="Sem limite"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Diretor acima de (R$)
            </label>
            <input
              type="number"
              value={restrictions.approval_director_above ?? ""}
              onChange={(e) =>
                setRestrictions((r) => ({
                  ...r,
                  approval_director_above: e.target.value
                    ? Number(e.target.value)
                    : null,
                }))
              }
              className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
              placeholder="Sem limite"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Limite de Crédito (R$)
            </label>
            <input
              type="number"
              value={restrictions.credit_limit_max}
              onChange={(e) =>
                setRestrictions((r) => ({
                  ...r,
                  credit_limit_max: Number(e.target.value),
                }))
              }
              className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
            />
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm border hover:bg-accent transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={createMutation.isPending || updateMutation.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Save className="h-4 w-4" />
          {rule ? "Salvar Alterações" : "Criar Regra"}
        </button>
      </div>
    </div>
  );
}

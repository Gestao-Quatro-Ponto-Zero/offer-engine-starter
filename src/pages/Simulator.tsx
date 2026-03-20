import { useState, useMemo } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  GRADE_COLORS,
  CREDIT_LIMITS,
  getGradeFromScore,
  BUS,
  type RiskGrade,
} from "@/lib/constants";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Calculator, CreditCard, Banknote, QrCode, FileText } from "lucide-react";

interface SimulatedOffer {
  type: string;
  label: string;
  icon: React.ElementType;
  installments: number;
  down_payment_pct: number;
  interest_pct: number;
  discount_pct: number;
  installment_value: number;
  total_value: number;
  recommended: boolean;
}

function getDefaultOffers(
  grade: RiskGrade,
  amount: number
): SimulatedOffer[] {
  const configs: Record<
    RiskGrade,
    Array<{
      type: string;
      label: string;
      icon: React.ElementType;
      installments: number;
      down_pct: number;
      interest: number;
      discount: number;
      recommended: boolean;
    }>
  > = {
    "A+": [
      { type: "parcelado", label: "12x sem juros", icon: CreditCard, installments: 12, down_pct: 0, interest: 0, discount: 0, recommended: true },
      { type: "pix", label: "Pix com 10% desconto", icon: QrCode, installments: 1, down_pct: 100, interest: 0, discount: 10, recommended: false },
      { type: "avista", label: "Boleto à vista", icon: Banknote, installments: 1, down_pct: 50, interest: 0, discount: 5, recommended: false },
    ],
    A: [
      { type: "parcelado", label: "10x sem juros + entrada", icon: CreditCard, installments: 10, down_pct: 10, interest: 0, discount: 0, recommended: true },
      { type: "pix", label: "Pix com 8% desconto", icon: QrCode, installments: 1, down_pct: 100, interest: 0, discount: 8, recommended: false },
    ],
    B: [
      { type: "parcelado", label: "8x sem juros + entrada 20%", icon: CreditCard, installments: 8, down_pct: 20, interest: 0, discount: 0, recommended: true },
      { type: "pix", label: "Pix com 5% desconto", icon: QrCode, installments: 1, down_pct: 100, interest: 0, discount: 5, recommended: false },
    ],
    C: [
      { type: "parcelado", label: "6x + entrada 40%", icon: CreditCard, installments: 6, down_pct: 40, interest: 0, discount: 0, recommended: true },
      { type: "pix", label: "Pix com 3% desconto", icon: QrCode, installments: 1, down_pct: 100, interest: 0, discount: 3, recommended: false },
      { type: "estruturado", label: "Estruturado 60d + caução", icon: FileText, installments: 6, down_pct: 40, interest: 1.5, discount: 0, recommended: false },
    ],
    D: [
      { type: "pix", label: "Pix com 3% desconto", icon: QrCode, installments: 1, down_pct: 100, interest: 0, discount: 3, recommended: true },
      { type: "parcelado", label: "3x + entrada 50%", icon: CreditCard, installments: 3, down_pct: 50, interest: 0, discount: 0, recommended: false },
      { type: "estruturado", label: "Estruturado c/ caução", icon: FileText, installments: 3, down_pct: 50, interest: 2, discount: 0, recommended: false },
    ],
  };

  return (configs[grade] ?? configs.D).map((c) => {
    const discountedAmount = amount * (1 - c.discount / 100);
    const downPayment = discountedAmount * (c.down_pct / 100);
    const remaining = discountedAmount - downPayment;
    let installmentVal = 0;
    if (c.installments > 1 && remaining > 0) {
      if (c.interest > 0) {
        const r = c.interest / 100;
        installmentVal =
          (remaining * r * Math.pow(1 + r, c.installments - 1)) /
          (Math.pow(1 + r, c.installments - 1) - 1);
      } else {
        installmentVal = remaining / (c.installments - (c.down_pct > 0 ? 0 : 0));
        if (c.down_pct > 0) {
          installmentVal = remaining / c.installments;
        } else {
          installmentVal = discountedAmount / c.installments;
        }
      }
    } else {
      installmentVal = discountedAmount;
    }
    const totalVal =
      c.installments > 1 && c.down_pct > 0
        ? downPayment + installmentVal * c.installments
        : installmentVal * c.installments;

    return {
      type: c.type,
      label: c.label,
      icon: c.icon,
      installments: c.installments,
      down_payment_pct: c.down_pct,
      interest_pct: c.interest,
      discount_pct: c.discount,
      installment_value: installmentVal,
      total_value: totalVal,
      recommended: c.recommended,
    };
  });
}

export default function Simulator() {
  const [score, setScore] = useState(600);
  const [amount, setAmount] = useState(100000);
  const [bu, setBu] = useState("Scale");

  const grade = useMemo(() => getGradeFromScore(score), [score]);
  const creditLimit = CREDIT_LIMITS[grade];
  const offers = useMemo(() => getDefaultOffers(grade, amount), [grade, amount]);
  const exceedsLimit = amount > creditLimit;

  const scoreBarData = [
    { label: "D", range: "0-299", min: 0, max: 299 },
    { label: "C", range: "300-499", min: 300, max: 499 },
    { label: "B", range: "500-699", min: 500, max: 699 },
    { label: "A", range: "700-849", min: 700, max: 849 },
    { label: "A+", range: "850-1000", min: 850, max: 1000 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Calculator className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl font-bold">Simulador de Condições</h2>
          <p className="text-sm text-muted-foreground">
            Ajuste o score e valor para ver as condições oferecidas
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-card rounded-xl border p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Score de Risco: {score}
            </label>
            <input
              type="range"
              min={0}
              max={1000}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0</span>
              <span>500</span>
              <span>1000</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              Valor do Deal: {formatCurrency(amount)}
            </label>
            <input
              type="range"
              min={5000}
              max={500000}
              step={5000}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>R$ 5k</span>
              <span>R$ 250k</span>
              <span>R$ 500k</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              Business Unit
            </label>
            <select
              value={bu}
              onChange={(e) => setBu(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              {BUS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Score visualization */}
        <div className="mt-6 pt-4 border-t">
          <div className="flex items-center gap-4">
            <div
              className="text-3xl font-bold"
              style={{ color: GRADE_COLORS[grade] }}
            >
              {grade}
            </div>
            <div className="flex-1">
              <div className="flex h-6 rounded-full overflow-hidden">
                {scoreBarData.map((bar) => (
                  <div
                    key={bar.label}
                    className="relative flex-1"
                    style={{
                      backgroundColor:
                        GRADE_COLORS[bar.label as RiskGrade] + "30",
                    }}
                  >
                    {score >= bar.min && score <= bar.max && (
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-foreground rounded"
                        style={{
                          left: `${((score - bar.min) / (bar.max - bar.min)) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex text-xs text-muted-foreground mt-1">
                {scoreBarData.map((bar) => (
                  <span key={bar.label} className="flex-1 text-center">
                    {bar.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Limite</p>
              <p className="font-semibold">{formatCurrency(creditLimit)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Warning for exceeding limit */}
      {exceedsLimit && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm text-yellow-800 font-medium">
            Valor excede o limite de crédito para grade {grade} (
            {formatCurrency(creditLimit)}). Condições Smart Exit seriam oferecidas:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-yellow-700">
            <li>- Split Contract: dividir em contratos menores</li>
            <li>
              - Entrada mínima de{" "}
              {formatPercent(((amount - creditLimit) / amount) * 100)} para
              caber no limite
            </li>
            <li>- Pagamento estruturado com início diferido (60 dias)</li>
          </ul>
        </div>
      )}

      {/* Generated offers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {offers.map((offer, i) => (
          <div
            key={i}
            className={`bg-card rounded-xl border p-6 ${
              offer.recommended ? "ring-2 ring-primary" : ""
            }`}
          >
            {offer.recommended && (
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded font-medium">
                Recomendado
              </span>
            )}
            <div className="flex items-center gap-2 mt-3 mb-4">
              <offer.icon className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">{offer.label}</h3>
            </div>

            <div className="space-y-3">
              {offer.discount_pct > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Desconto</span>
                  <span className="font-medium text-green-600">
                    {offer.discount_pct}%
                  </span>
                </div>
              )}
              {offer.down_payment_pct > 0 && offer.installments > 1 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Entrada</span>
                  <span className="font-medium">
                    {offer.down_payment_pct}% ={" "}
                    {formatCurrency(amount * (offer.down_payment_pct / 100))}
                  </span>
                </div>
              )}
              {offer.installments > 1 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Parcelas</span>
                  <span className="font-medium">
                    {offer.installments}x de{" "}
                    {formatCurrency(offer.installment_value)}
                  </span>
                </div>
              )}
              {offer.interest_pct > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Juros a.m.</span>
                  <span className="font-medium">{offer.interest_pct}%</span>
                </div>
              )}
              <div className="pt-3 border-t flex justify-between">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="text-lg font-bold">
                  {formatCurrency(offer.total_value)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Comparison chart */}
      <div className="bg-card rounded-xl border p-6">
        <h3 className="text-sm font-semibold mb-4">Comparação de Valores</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={offers.map((o) => ({ name: o.label.slice(0, 20), total: o.total_value }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Bar dataKey="total" fill="#3b82f6" radius={[6, 6, 0, 0]}>
              {offers.map((_, i) => (
                <Cell key={i} fill={i === 0 ? "#3b82f6" : "#94a3b8"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

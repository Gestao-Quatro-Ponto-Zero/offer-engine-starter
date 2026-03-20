import {
  useDashboardSummary,
  useScoreDistribution,
  useExceptionDashboardStats,
  useAuditLog,
} from "@/hooks/useDashboard";
import { formatDate, formatPercent } from "@/lib/utils";
import { GRADE_COLORS, type RiskGrade } from "@/lib/constants";
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
import {
  Target,
  FileText,
  AlertTriangle,
  TrendingUp,
  Clock,
} from "lucide-react";

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-card rounded-xl border p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div
          className="h-10 w-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useDashboardSummary();
  const { data: distribution, isLoading: loadingDist } = useScoreDistribution();
  const { data: exceptionStats } = useExceptionDashboardStats();
  const { data: audit, isLoading: loadingAudit } = useAuditLog(20);

  if (loadingSummary) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Scores Calculados"
          value={summary?.total_scores ?? 0}
          icon={Target}
          color="#3b82f6"
        />
        <KpiCard
          label="Ofertas Geradas"
          value={summary?.total_offers ?? 0}
          icon={FileText}
          color="#10b981"
        />
        <KpiCard
          label="Taxa de Aceite"
          value={formatPercent(summary?.acceptance_rate ?? 0)}
          icon={TrendingUp}
          color="#8b5cf6"
        />
        <KpiCard
          label="Exceções Pendentes"
          value={summary?.exceptions_pending ?? 0}
          icon={AlertTriangle}
          color="#f97316"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Grade Distribution Chart */}
        <div className="bg-card rounded-xl border p-6">
          <h3 className="text-sm font-semibold mb-4">Distribuição por Grade</h3>
          {loadingDist ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={distribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="grade" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {(distribution ?? []).map((entry) => (
                    <Cell
                      key={entry.grade}
                      fill={GRADE_COLORS[entry.grade as RiskGrade] ?? "#94a3b8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Exception Stats */}
        <div className="bg-card rounded-xl border p-6">
          <h3 className="text-sm font-semibold mb-4">Exceções</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-2xl font-bold">{exceptionStats?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-green-700">
                {exceptionStats?.approved ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Aprovadas</p>
            </div>
            <div className="bg-red-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-red-700">
                {exceptionStats?.rejected ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Rejeitadas</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-yellow-700">
                {exceptionStats?.pending ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Pendentes</p>
            </div>
          </div>
          {exceptionStats && exceptionStats.total > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Taxa de Aprovação
                </span>
                <span className="text-lg font-bold">
                  {formatPercent(exceptionStats.approval_rate)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Audit Log */}
      <div className="bg-card rounded-xl border p-6">
        <h3 className="text-sm font-semibold mb-4">Atividade Recente</h3>
        {loadingAudit ? (
          <div className="h-32 flex items-center justify-center">
            <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {(audit ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma atividade registrada
              </p>
            ) : (
              (audit ?? []).map((entry: { id: string; action: string; deal_id: string | null; user_email: string | null; created_at: string }) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 py-2 border-b last:border-0"
                >
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{entry.action}</span>
                      {entry.deal_id && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">
                          Deal {entry.deal_id}
                        </span>
                      )}
                    </div>
                    {entry.user_email && (
                      <p className="text-xs text-muted-foreground">
                        {entry.user_email}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDate(entry.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

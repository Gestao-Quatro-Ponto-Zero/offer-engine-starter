import { useState } from "react";
import { useExceptions, useApproveException, useRejectException } from "@/hooks/useExceptions";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { GRADE_COLORS, type RiskGrade } from "@/lib/constants";
import type { ExceptionStatus } from "@/types/exceptions";
import { Check, X, Clock, Filter } from "lucide-react";
import { toast } from "sonner";

const STATUS_LABELS: Record<ExceptionStatus, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Rejeitada",
  expired: "Expirada",
};

const STATUS_COLORS: Record<ExceptionStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  expired: "bg-gray-100 text-gray-800",
};

export default function Exceptions() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: exceptions, isLoading } = useExceptions(statusFilter);
  const { user, isAdmin } = useAuth();
  const approveMutation = useApproveException();
  const rejectMutation = useRejectException();
  const [actioningId, setActioningId] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    setActioningId(id);
    try {
      await approveMutation.mutateAsync({
        exceptionId: id,
        approverEmail: user?.email ?? "",
        note: "Aprovado",
      });
      toast.success("Exceção aprovada");
    } catch {
      toast.error("Erro ao aprovar exceção");
    }
    setActioningId(null);
  };

  const handleReject = async (id: string) => {
    setActioningId(id);
    try {
      await rejectMutation.mutateAsync({
        exceptionId: id,
        approverEmail: user?.email ?? "",
        note: "Rejeitado",
      });
      toast.success("Exceção rejeitada");
    } catch {
      toast.error("Erro ao rejeitar exceção");
    }
    setActioningId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Exceções</h2>
          <p className="text-sm text-muted-foreground">
            Solicitações de condições fora da política
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={statusFilter ?? ""}
            onChange={(e) => setStatusFilter(e.target.value || undefined)}
            className="text-sm border rounded-md px-3 py-1.5 bg-background"
          >
            <option value="">Todos</option>
            <option value="pending">Pendentes</option>
            <option value="approved">Aprovadas</option>
            <option value="rejected">Rejeitadas</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {(exceptions ?? []).map((exc) => (
          <div
            key={exc.id}
            className="bg-card rounded-xl border p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">Deal {exc.deal_id}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                      STATUS_COLORS[exc.status as ExceptionStatus]
                    }`}
                  >
                    {STATUS_LABELS[exc.status as ExceptionStatus]}
                  </span>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: `${GRADE_COLORS[exc.current_grade as RiskGrade]}20`,
                      color: GRADE_COLORS[exc.current_grade as RiskGrade],
                    }}
                  >
                    {exc.current_grade}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {exc.seller_email} · {formatCurrency(exc.deal_amount)} · Aprovador: {exc.approver_role}
                </p>
              </div>

              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDate(exc.created_at)}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Condições Desejadas
                </p>
                <p className="text-sm">{exc.desired_conditions}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Justificativa
                </p>
                <p className="text-sm">{exc.justification}</p>
              </div>
            </div>

            {exc.decision_note && (
              <div className="bg-muted/50 rounded-lg p-3 mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Nota da decisão ({exc.approver_email})
                </p>
                <p className="text-sm">{exc.decision_note}</p>
              </div>
            )}

            {exc.status === "pending" && isAdmin && (
              <div className="flex items-center gap-2 pt-3 border-t">
                <button
                  onClick={() => handleApprove(exc.id)}
                  disabled={actioningId === exc.id}
                  className="flex items-center gap-1 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  <Check className="h-4 w-4" />
                  Aprovar
                </button>
                <button
                  onClick={() => handleReject(exc.id)}
                  disabled={actioningId === exc.id}
                  className="flex items-center gap-1 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  <X className="h-4 w-4" />
                  Rejeitar
                </button>
              </div>
            )}
          </div>
        ))}

        {(exceptions ?? []).length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            Nenhuma exceção encontrada
          </div>
        )}
      </div>
    </div>
  );
}

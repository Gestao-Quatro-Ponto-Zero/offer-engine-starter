import { useRuleHistory } from "@/hooks/useRules";
import { formatDate } from "@/lib/utils";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { rollbackRule } from "@/services/rules";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  ruleId: string;
  onClose: () => void;
}

export default function RuleHistoryPanel({ ruleId, onClose }: Props) {
  const { data: history, isLoading } = useRuleHistory(ruleId);
  const queryClient = useQueryClient();

  const handleRollback = async (version: number) => {
    try {
      await rollbackRule(ruleId, version);
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
      toast.success(`Rollback para versão ${version} realizado`);
      onClose();
    } catch {
      toast.error("Erro ao fazer rollback");
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
        <h2 className="text-xl font-bold">Histórico da Regra</h2>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {(history ?? []).map((entry) => {
            const snapshot = entry.snapshot as unknown as Record<string, unknown>;
            return (
              <div key={entry.id} className="bg-card rounded-xl border p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Versão {entry.version}</span>
                      <span className="text-xs bg-muted px-2 py-0.5 rounded">
                        {entry.changed_by}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(entry.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRollback(entry.version)}
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Rollback
                  </button>
                </div>

                <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-auto max-h-48">
                  {JSON.stringify(snapshot, null, 2)}
                </pre>
              </div>
            );
          })}

          {(history ?? []).length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              Nenhum histórico de versão
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getExceptions, getExceptionStats, requestException, approveException, rejectException } from "@/services/exceptions";
import type { ExceptionRequest } from "@/types/exceptions";
import type { RiskGrade } from "@/lib/constants";

export function useExceptions(status?: string) {
  return useQuery({ queryKey: ["exceptions", status], queryFn: () => getExceptions(status) });
}

export function useExceptionStats() {
  return useQuery({ queryKey: ["exceptions", "stats"], queryFn: getExceptionStats });
}

export function useRequestException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ request, sellerEmail, currentGrade }: { request: ExceptionRequest; sellerEmail: string; currentGrade: RiskGrade }) =>
      requestException(request, sellerEmail, currentGrade),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exceptions"] }),
  });
}

export function useApproveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ exceptionId, approverEmail, note }: { exceptionId: string; approverEmail: string; note: string }) =>
      approveException(exceptionId, approverEmail, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exceptions"] }),
  });
}

export function useRejectException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ exceptionId, approverEmail, note }: { exceptionId: string; approverEmail: string; note: string }) =>
      rejectException(exceptionId, approverEmail, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exceptions"] }),
  });
}

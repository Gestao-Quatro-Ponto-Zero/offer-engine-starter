import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { generateOffers, getOfferMenu, selectOffer, acceptOffer, rejectOffer } from "@/services/offers";

export function useOfferMenu(dealId: string) {
  return useQuery({ queryKey: ["offers", dealId], queryFn: () => getOfferMenu(dealId), enabled: !!dealId });
}

export function useGenerateOffers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, dealAmount, bu }: { dealId: string; dealAmount: number; bu: string }) =>
      generateOffers(dealId, dealAmount, bu),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ["offers", vars.dealId] }),
  });
}

export function useSelectOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ menuId, offerId }: { menuId: string; offerId: string }) => selectOffer(menuId, offerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) => acceptOffer(menuId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
}

export function useRejectOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (menuId: string) => rejectOffer(menuId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
}

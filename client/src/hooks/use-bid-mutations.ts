import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertBidSubcontractorQuoteSchema, insertBidMaterialQuoteSchema } from "@shared/schema";
import { z } from "zod";

export const quoteFormSchema = insertBidSubcontractorQuoteSchema.omit({ bidId: true }).extend({
  quoteAmount: z.string().min(1, "Quote amount is required"),
  scopeOfWork: z.string().min(1, "Scope of work is required"),
  subcontractorName: z.string().min(1, "Subcontractor name is required"),
});
export type QuoteFormValues = z.infer<typeof quoteFormSchema>;

export const materialQuoteFormSchema = insertBidMaterialQuoteSchema.omit({ bidId: true }).extend({
  cost: z.string().min(1, "Cost is required"),
});
export type MaterialQuoteFormValues = z.infer<typeof materialQuoteFormSchema>;

export const equipmentSelectionFormSchema = z.object({
  source: z.enum(["OWNED", "RENTAL"]),
  equipmentId: z.string().optional(),
  rentalCatalogId: z.string().optional(),
  rentalVendorId: z.string().optional(),
  equipmentName: z.string().min(1, "Equipment name is required"),
  equipmentType: z.string().min(1, "Equipment type is required"),
  plannedHours: z.string().optional(),
  plannedDays: z.string().optional(),
  hourlyRate: z.string().optional(),
  dailyRate: z.string().optional(),
  weeklyRate: z.string().optional(),
  estimatedCost: z.string().optional(),
  deliveryFee: z.string().optional(),
  notes: z.string().optional(),
});
export type EquipmentSelectionFormValues = z.infer<typeof equipmentSelectionFormSchema>;

export const bidEditFormSchema = z.object({
  name: z.string(),
  clientName: z.string(),
  clientContactName: z.string().optional(),
  clientContactEmail: z.string().email().optional().or(z.literal("")),
  clientContactPhone: z.string().optional(),
  gcName: z.string().optional(),
  gcContactName: z.string().optional(),
  gcContactEmail: z.string().email().optional().or(z.literal("")),
  gcContactPhone: z.string().optional(),
  bidAmount: z.string().optional(),
  dueDate: z.string().optional(),
  locationAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  description: z.string().optional(),
  wageDecision: z.string().optional(),
}).partial();
export type BidEditFormValues = z.infer<typeof bidEditFormSchema>;

function parseEquipmentPayload(data: EquipmentSelectionFormValues) {
  return {
    source: data.source, equipmentId: data.equipmentId || null, rentalCatalogId: data.rentalCatalogId || null, rentalVendorId: data.rentalVendorId || null,
    equipmentName: data.equipmentName, equipmentType: data.equipmentType,
    plannedHours: data.plannedHours ? parseFloat(data.plannedHours) : null, plannedDays: data.plannedDays ? parseInt(data.plannedDays) : null,
    hourlyRate: data.hourlyRate ? parseFloat(data.hourlyRate) : null, dailyRate: data.dailyRate ? parseFloat(data.dailyRate) : null,
    weeklyRate: data.weeklyRate ? parseFloat(data.weeklyRate) : null, estimatedCost: data.estimatedCost ? parseFloat(data.estimatedCost) : null,
    deliveryFee: data.deliveryFee ? parseFloat(data.deliveryFee) : null, notes: data.notes || null,
  };
}

interface UseBidMutationsOptions {
  bidCode: string;
  bidId: string | undefined;
  onQuoteSuccess: () => void;
  onMaterialQuoteSuccess: () => void;
  onEquipmentSuccess: () => void;
  onBidEditSuccess: () => void;
  onEstimateCreated: () => void;
}

export function useBidMutations(opts: UseBidMutationsOptions) {
  const { toast } = useToast();
  const errHandler = (msg: string) => (error: any) => { toast({ title: "Error", description: error.message || msg, variant: "destructive" }); };

  const updateBidStatus = useMutation({
    mutationFn: async (newStatus: string) => { await apiRequest("PATCH", `/api/bids/${opts.bidCode}`, { status: newStatus }); },
    onSuccess: (_d, newStatus) => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode] }); queryClient.invalidateQueries({ queryKey: ["/api/bids"] }); toast({ title: "Status Updated", description: `Bid status changed to ${newStatus}.` }); },
    onError: errHandler("Failed to update bid status"),
  });

  const createQuote = useMutation({
    mutationFn: async (data: QuoteFormValues) => { const res = await apiRequest("POST", `/api/bids/${opts.bidCode}/quotes`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "quotes"] }); toast({ title: "Success", description: "Subcontractor quote added" }); opts.onQuoteSuccess(); },
    onError: errHandler("Failed to add quote"),
  });

  const updateQuote = useMutation({
    mutationFn: async ({ quoteId, data }: { quoteId: string; data: Partial<QuoteFormValues> }) => { const res = await apiRequest("PATCH", `/api/bids/${opts.bidCode}/quotes/${quoteId}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "quotes"] }); toast({ title: "Success", description: "Quote updated" }); opts.onQuoteSuccess(); },
    onError: errHandler("Failed to update quote"),
  });

  const deleteQuote = useMutation({
    mutationFn: async (quoteId: string) => { const res = await apiRequest("DELETE", `/api/bids/${opts.bidCode}/quotes/${quoteId}`); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "quotes"] }); toast({ title: "Success", description: "Quote deleted" }); },
    onError: errHandler("Failed to delete quote"),
  });

  const createMaterialQuote = useMutation({
    mutationFn: async (data: MaterialQuoteFormValues) => { const res = await apiRequest("POST", `/api/bids/${opts.bidCode}/material-quotes`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "material-quotes"] }); toast({ title: "Success", description: "Material quote added" }); opts.onMaterialQuoteSuccess(); },
    onError: errHandler("Failed to add material quote"),
  });

  const updateMaterialQuote = useMutation({
    mutationFn: async ({ quoteId, data }: { quoteId: string; data: Partial<MaterialQuoteFormValues> }) => { const res = await apiRequest("PATCH", `/api/bids/${opts.bidCode}/material-quotes/${quoteId}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "material-quotes"] }); toast({ title: "Success", description: "Material quote updated" }); opts.onMaterialQuoteSuccess(); },
    onError: errHandler("Failed to update material quote"),
  });

  const deleteMaterialQuote = useMutation({
    mutationFn: async (quoteId: string) => { const res = await apiRequest("DELETE", `/api/bids/${opts.bidCode}/material-quotes/${quoteId}`); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "material-quotes"] }); toast({ title: "Success", description: "Material quote deleted" }); },
    onError: errHandler("Failed to delete material quote"),
  });

  const createEquipmentSelection = useMutation({
    mutationFn: async (data: EquipmentSelectionFormValues) => apiRequest("POST", `/api/bids/${opts.bidId}/equipment`, parseEquipmentPayload(data)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidId, "equipment"] }); toast({ title: "Success", description: "Equipment added to bid" }); opts.onEquipmentSuccess(); },
    onError: errHandler("Failed to add equipment"),
  });

  const updateEquipmentSelection = useMutation({
    mutationFn: async ({ selectionId, data }: { selectionId: string; data: EquipmentSelectionFormValues }) => apiRequest("PATCH", `/api/bids/${opts.bidId}/equipment/${selectionId}`, parseEquipmentPayload(data)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidId, "equipment"] }); toast({ title: "Success", description: "Equipment updated" }); opts.onEquipmentSuccess(); },
    onError: errHandler("Failed to update equipment"),
  });

  const deleteEquipmentSelection = useMutation({
    mutationFn: async (selectionId: string) => apiRequest("DELETE", `/api/bids/${opts.bidId}/equipment/${selectionId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidId, "equipment"] }); toast({ title: "Success", description: "Equipment removed from bid" }); },
    onError: errHandler("Failed to remove equipment"),
  });

  const toggleQuoteSelection = useMutation({
    mutationFn: async ({ quoteId, isSelected }: { quoteId: string; isSelected: boolean }) => { const res = await apiRequest("PATCH", `/api/bids/${opts.bidCode}/quotes/${quoteId}`, { isSelected }); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "quotes"] }); },
    onError: errHandler("Failed to update selection"),
  });

  const toggleMaterialQuoteSelection = useMutation({
    mutationFn: async ({ quoteId, isSelected }: { quoteId: string; isSelected: boolean }) => { const res = await apiRequest("PATCH", `/api/bids/${opts.bidCode}/material-quotes/${quoteId}`, { isSelected }); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "material-quotes"] }); },
    onError: errHandler("Failed to update selection"),
  });

  const sendSubRfq = useMutation({
    mutationFn: async ({ quoteId, overrideEmail }: { quoteId: string; overrideEmail?: string }) => { const res = await apiRequest("POST", `/api/bids/${opts.bidCode}/quotes/${quoteId}/send-rfq`, overrideEmail ? { overrideEmail } : {}); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "quotes"] }); toast({ title: "RFQ Sent", description: "Request for quote email sent to subcontractor" }); },
    onError: errHandler("Failed to send RFQ"),
  });

  const sendMaterialRfq = useMutation({
    mutationFn: async (quoteId: string) => { const res = await apiRequest("POST", `/api/bids/${opts.bidCode}/material-quotes/${quoteId}/send-rfq`); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode, "material-quotes"] }); toast({ title: "RFQ Sent", description: "Request for quote email sent to supplier" }); },
    onError: errHandler("Failed to send RFQ"),
  });

  const updateBidMutation = useMutation({
    mutationFn: async (data: BidEditFormValues) => {
      const payload: any = {};
      const fields = ["name", "clientName", "clientContactName", "clientContactEmail", "clientContactPhone", "gcName", "gcContactName", "gcContactEmail", "gcContactPhone", "locationAddress", "city", "state", "description"] as const;
      fields.forEach(f => { if ((data as any)[f]) payload[f] = (data as any)[f]; });
      if (data.wageDecision !== undefined) payload.wageDecision = data.wageDecision || null;
      if (data.bidAmount) payload.bidAmount = data.bidAmount;
      if (data.dueDate) payload.dueDate = new Date(data.dueDate);
      return apiRequest("PATCH", `/api/bids/${opts.bidCode}`, payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bids", opts.bidCode] }); queryClient.invalidateQueries({ queryKey: ["/api/bids"] }); toast({ title: "Success", description: "Bid updated successfully" }); opts.onBidEditSuccess(); },
    onError: errHandler("Failed to update bid"),
  });

  const createEstimateMutation = useMutation({
    mutationFn: () => { if (!opts.bidId) throw new Error("Bid ID is required"); return apiRequest("POST", `/api/bids/${opts.bidId}/estimate`, {}); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: bidEstimateKey(opts.bidId) }); queryClient.invalidateQueries({ queryKey: ["/api/bids"] }); toast({ title: "Success", description: "Estimate created successfully" }); opts.onEstimateCreated(); },
    onError: errHandler("Failed to create estimate"),
  });

  return {
    updateBidStatus, createQuote, updateQuote, deleteQuote,
    createMaterialQuote, updateMaterialQuote, deleteMaterialQuote,
    createEquipmentSelection, updateEquipmentSelection, deleteEquipmentSelection,
    toggleQuoteSelection, toggleMaterialQuoteSelection,
    sendSubRfq, sendMaterialRfq,
    updateBidMutation, createEstimateMutation,
  };
}

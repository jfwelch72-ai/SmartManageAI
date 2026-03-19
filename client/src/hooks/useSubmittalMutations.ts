import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string;
}

export interface Subcontractor {
  id: string;
  companyName: string;
  name?: string;
}

export interface SubmittalActivity {
  id: string;
  submittalId: string;
  action: string;
  comment: string | null;
  createdAt: string;
  userName: string | null;
}

export type SubmittalCategory = "SHOP_DRAWING" | "PRODUCT_DATA" | "MATERIAL_APPROVAL" | "ENGINEERING_APPROVAL" | "SAMPLE" | "OPERATION_AND_MAINTENANCE" | "OTHER";

export const SUBMITTAL_CATEGORY_LABELS: Record<SubmittalCategory, string> = {
  SHOP_DRAWING: "Shop Drawing",
  PRODUCT_DATA: "Product Data",
  MATERIAL_APPROVAL: "Material Approval",
  ENGINEERING_APPROVAL: "Engineering Approval",
  SAMPLE: "Sample",
  OPERATION_AND_MAINTENANCE: "O&M Manual",
  OTHER: "Other",
};

export const SUBMITTAL_CATEGORIES: SubmittalCategory[] = [
  "SHOP_DRAWING",
  "PRODUCT_DATA",
  "MATERIAL_APPROVAL",
  "ENGINEERING_APPROVAL",
  "SAMPLE",
  "OPERATION_AND_MAINTENANCE",
  "OTHER",
];

export interface SubmittalItem {
  id: string;
  submittalId: string;
  itemNumber: number;
  description: string;
  submittalCategory: SubmittalCategory | null;
  specSection: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  quantity: string | null;
  unit: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmittalAttachment {
  id: string;
  submittalId: string;
  submittalItemId: string | null;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  storageKey: string;
  uploadedById: string;
  uploadedByName: string | null;
  description: string | null;
  createdAt: string;
}

export interface SubmittalReview {
  id: string;
  submittalId: string;
  organizationId: string;
  reviewerRole: string;
  reviewerId: string | null;
  reviewerName: string;
  sequenceOrder: number;
  status: string;
  comments: string | null;
  stampAction: string | null;
  dateAssigned: string | null;
  dateReviewed: string | null;
  createdAt: string;
}

export interface Submittal {
  id: string;
  projectId: string;
  submittalNumber: string;
  subject: string;
  description: string | null;
  submittalType: string;
  phase: string;
  specSection: string | null;
  category: string | null;
  submittalCategory: string | null;
  status: string;
  revision: number;
  previousRevisionId: string | null;
  subcontractorId: string | null;
  contractId: string | null;
  dateRequired: string | null;
  dateSubmitted: string | null;
  submittedById: string | null;
  submittedByName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewDate: string | null;
  reviewComments: string | null;
  stampAction: string | null;
  linkedRfiId: string | null;
  attachmentsJson: string | null;
  createdAt: string;
  updatedAt: string | null;
  project: { code: string; name: string };
  subcontractor?: { id: string; companyName: string; name?: string } | null;
  activity?: SubmittalActivity[];
}

export interface SubmittalStats {
  total: number;
  pendingReview: number;
  approved: number;
  needsAction: number;
}

export interface RFI {
  id: string;
  rfiNumber: string;
  subject: string;
}

export interface SubmittalCreateForm {
  projectId?: string;
  subject: string;
  description: string;
  submittalType: string;
  phase: string;
  specSection: string;
  submittalCategory: string;
  subcontractorId: string;
  dateRequired: string;
}

export function useSubmittalMutations(callbacks?: {
  onCreateSuccess?: () => void;
  onSubmitSuccess?: () => void;
  onStartReviewSuccess?: () => void;
  onReviewSuccess?: () => void;
  onResubmitSuccess?: () => void;
  onLinkRfiSuccess?: () => void;
  onCommentSuccess?: () => void;
  onDeleteSuccess?: () => void;
  onUpdateSuccess?: () => void;
  onAddReviewerSuccess?: () => void;
  onRemoveReviewerSuccess?: () => void;
  onStartChainSuccess?: () => void;
  onStampSuccess?: () => void;
}) {
  const { toast } = useToast();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/submittals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/submittals/stats"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: SubmittalCreateForm) => {
      const body: Record<string, unknown> = {
        subject: data.subject,
        submittalType: data.submittalType,
        phase: data.phase
      };
      if (data.projectId) body.projectId = data.projectId;
      if (data.description) body.description = data.description;
      if (data.specSection) body.specSection = data.specSection;
      if (data.submittalCategory) body.submittalCategory = data.submittalCategory;
      if (data.subcontractorId) body.subcontractorId = data.subcontractorId;
      if (data.dateRequired) body.dateRequired = data.dateRequired;
      return await apiRequest("POST", "/api/submittals", body);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Submittal created successfully" });
      callbacks?.onCreateSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create submittal", description: error.message, variant: "destructive" });
    }
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/submittals/${id}/submit`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Submittal submitted for review" });
      callbacks?.onSubmitSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to submit", description: error.message, variant: "destructive" });
    }
  });

  const startReviewMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/submittals/${id}/review`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Review started" });
      callbacks?.onStartReviewSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to start review", description: error.message, variant: "destructive" });
    }
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action, comments }: { id: string; action: string; comments: string }) => {
      return await apiRequest("POST", `/api/submittals/${id}/${action}`, { reviewComments: comments || undefined });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Review completed" });
      callbacks?.onReviewSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Review failed", description: error.message, variant: "destructive" });
    }
  });

  const resubmitMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/submittals/${id}/resubmit`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Revision created" });
      callbacks?.onResubmitSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to resubmit", description: error.message, variant: "destructive" });
    }
  });

  const linkRfiMutation = useMutation({
    mutationFn: async ({ id, rfiId }: { id: string; rfiId: string }) => {
      return await apiRequest("POST", `/api/submittals/${id}/link-rfi`, { rfiId });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI linked successfully" });
      callbacks?.onLinkRfiSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to link RFI", description: error.message, variant: "destructive" });
    }
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      return await apiRequest("POST", `/api/submittals/${id}/activity`, { comment });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Comment added" });
      callbacks?.onCommentSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to add comment", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/submittals/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Submittal deleted" });
      callbacks?.onDeleteSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return await apiRequest("PATCH", `/api/submittals/${id}`, data);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Submittal updated" });
      callbacks?.onUpdateSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    }
  });

  const addItemMutation = useMutation({
    mutationFn: async ({ submittalId, data }: { submittalId: string; data: Record<string, unknown> }) => {
      return await apiRequest("POST", `/api/submittals/${submittalId}/items`, data);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "items"] });
      toast({ title: "Item added" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add item", description: error.message, variant: "destructive" });
    }
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ submittalId, itemId, data }: { submittalId: string; itemId: string; data: Record<string, unknown> }) => {
      return await apiRequest("PATCH", `/api/submittals/${submittalId}/items/${itemId}`, data);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "items"] });
      toast({ title: "Item updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update item", description: error.message, variant: "destructive" });
    }
  });

  const deleteItemMutation = useMutation({
    mutationFn: async ({ submittalId, itemId }: { submittalId: string; itemId: string }) => {
      return await apiRequest("DELETE", `/api/submittals/${submittalId}/items/${itemId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "items"] });
      toast({ title: "Item deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete item", description: error.message, variant: "destructive" });
    }
  });

  const addAttachmentMutation = useMutation({
    mutationFn: async ({ submittalId, data }: { submittalId: string; data: Record<string, unknown> }) => {
      return await apiRequest("POST", `/api/submittals/${submittalId}/attachments`, data);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "attachments"] });
      toast({ title: "Attachment uploaded" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to upload attachment", description: error.message, variant: "destructive" });
    }
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async ({ submittalId, attachId }: { submittalId: string; attachId: string }) => {
      return await apiRequest("DELETE", `/api/submittals/${submittalId}/attachments/${attachId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "attachments"] });
      toast({ title: "Attachment deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete attachment", description: error.message, variant: "destructive" });
    }
  });

  const addReviewerMutation = useMutation({
    mutationFn: async ({ submittalId, data }: { submittalId: string; data: Record<string, unknown> }) => {
      return await apiRequest("POST", `/api/submittals/${submittalId}/reviews`, data);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "reviews"] });
      toast({ title: "Reviewer added" });
      callbacks?.onAddReviewerSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to add reviewer", description: error.message, variant: "destructive" });
    }
  });

  const removeReviewerMutation = useMutation({
    mutationFn: async ({ submittalId, reviewId }: { submittalId: string; reviewId: string }) => {
      return await apiRequest("DELETE", `/api/submittals/${submittalId}/reviews/${reviewId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "reviews"] });
      toast({ title: "Reviewer removed" });
      callbacks?.onRemoveReviewerSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to remove reviewer", description: error.message, variant: "destructive" });
    }
  });

  const startChainMutation = useMutation({
    mutationFn: async ({ submittalId, reviewId }: { submittalId: string; reviewId: string }) => {
      return await apiRequest("POST", `/api/submittals/${submittalId}/reviews/${reviewId}/start`);
    },
    onSuccess: (_data, variables) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "reviews"] });
      toast({ title: "Review chain started" });
      callbacks?.onStartChainSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to start review chain", description: error.message, variant: "destructive" });
    }
  });

  const stampMutation = useMutation({
    mutationFn: async ({ submittalId, reviewId, action, comments }: { submittalId: string; reviewId: string; action: string; comments: string }) => {
      return await apiRequest("POST", `/api/submittals/${submittalId}/reviews/${reviewId}/stamp`, { action, comments });
    },
    onSuccess: (_data, variables) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/submittals", variables.submittalId, "reviews"] });
      toast({ title: "Stamp applied" });
      callbacks?.onStampSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to stamp review", description: error.message, variant: "destructive" });
    }
  });

  return {
    createMutation,
    submitMutation,
    startReviewMutation,
    reviewMutation,
    resubmitMutation,
    linkRfiMutation,
    addCommentMutation,
    deleteMutation,
    updateMutation,
    addItemMutation,
    updateItemMutation,
    deleteItemMutation,
    addAttachmentMutation,
    deleteAttachmentMutation,
    addReviewerMutation,
    removeReviewerMutation,
    startChainMutation,
    stampMutation,
  };
}

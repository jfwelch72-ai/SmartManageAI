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
  category: string;
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
      if (data.category) body.category = data.category;
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

  return {
    createMutation,
    submitMutation,
    startReviewMutation,
    reviewMutation,
    resubmitMutation,
    linkRfiMutation,
    addCommentMutation,
    deleteMutation,
    updateMutation
  };
}

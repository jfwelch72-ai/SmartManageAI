import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  CheckCircle2,
  Clock,
  XCircle,
  Search,
  Forward,
} from "lucide-react";

export interface RFI {
  id: string;
  rfiNumber: string;
  projectId: string;
  subject: string;
  question: string;
  answer: string | null;
  priority: string;
  status: string;
  category: string | null;
  subcontractorId: string | null;
  contractId: string | null;
  drawingReference: string | null;
  specReference: string | null;
  impactDescription: string | null;
  costImpact: boolean;
  scheduleImpact: boolean;
  dateRequired: string | null;
  assignedToId: string | null;
  submittedById: string | null;
  submittedByName: string | null;
  answeredById: string | null;
  answeredByName: string | null;
  closedById: string | null;
  closedByName: string | null;
  forwardedToId: string | null;
  forwardedAt: string | null;
  linkedChangeOrderId: string | null;
  linkedTmTicketId: string | null;
  linkedSubmittalId: string | null;
  linkedSubmittalNumber: string | null;
  linkedSubmittalSubject: string | null;
  createdAt: string;
  updatedAt: string | null;
  dateSubmitted: string | null;
  dateAnswered: string | null;
  closedAt: string | null;
  project?: { code: string; name: string };
  subcontractor?: { companyName: string } | null;
  assignedTo?: { firstName: string; lastName: string } | null;
}

export interface RFIStats {
  total: number;
  open: number;
  answered: number;
  closed: number;
  overdue: number;
}

export interface ActivityEntry {
  id: string;
  action: string;
  comment: string | null;
  userName: string;
  createdAt: string;
}

export interface ChangeOrder {
  id: string;
  coNumber: string;
  title: string;
  status: string;
}

export interface RFICreateForm {
  projectId?: string;
  subject: string;
  question: string;
  priority: string;
  category: string;
  subcontractorId: string;
  assignedToId: string;
  drawingReference: string;
  specReference: string;
  dateRequired: string;
  impactDescription: string;
  costImpact: boolean;
  scheduleImpact: boolean;
}

export interface RFIEditForm {
  subject: string;
  question: string;
  priority: string;
  category: string;
  drawingReference: string;
  specReference: string;
  dateRequired: string;
  impactDescription: string;
  costImpact: boolean;
  scheduleImpact: boolean;
}

export const DEFAULT_CREATE_FORM: RFICreateForm = {
  projectId: "",
  subject: "",
  question: "",
  priority: "MEDIUM",
  category: "",
  subcontractorId: "",
  assignedToId: "",
  drawingReference: "",
  specReference: "",
  dateRequired: "",
  impactDescription: "",
  costImpact: false,
  scheduleImpact: false,
};

export const DEFAULT_EDIT_FORM: RFIEditForm = {
  subject: "",
  question: "",
  priority: "MEDIUM",
  category: "",
  drawingReference: "",
  specReference: "",
  dateRequired: "",
  impactDescription: "",
  costImpact: false,
  scheduleImpact: false,
};

export function getStatusBadge(status: string): ReactNode {
  switch (status) {
    case "DRAFT":
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
    case "SUBMITTED":
      return <Badge variant="default"><Send className="h-3 w-3 mr-1" />Submitted</Badge>;
    case "UNDER_REVIEW":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"><Search className="h-3 w-3 mr-1" />Under Review</Badge>;
    case "FORWARDED":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><Forward className="h-3 w-3 mr-1" />Forwarded</Badge>;
    case "ANSWERED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Answered</Badge>;
    case "CLOSED":
      return <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><XCircle className="h-3 w-3 mr-1" />Closed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function isRfiOverdue(rfi: { status: string; dateRequired: string | null }): boolean {
  if (!rfi.dateRequired) return false;
  if (!["SUBMITTED", "UNDER_REVIEW", "FORWARDED"].includes(rfi.status)) return false;
  return new Date(rfi.dateRequired) < new Date();
}

export function getPriorityBadge(priority: string): ReactNode {
  switch (priority) {
    case "LOW":
      return <Badge variant="secondary">Low</Badge>;
    case "MEDIUM":
      return <Badge variant="default">Medium</Badge>;
    case "HIGH":
      return <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">High</Badge>;
    case "URGENT":
      return <Badge variant="destructive">Urgent</Badge>;
    default:
      return <Badge variant="outline">{priority}</Badge>;
  }
}

interface UseRfiMutationsOptions {
  selectedRfiId: string | null;
  onCreateSuccess?: () => void;
  onDeleteSuccess?: () => void;
  onEditSuccess?: () => void;
  onAnswerSuccess?: () => void;
  onLinkCOSuccess?: () => void;
  onForwardSuccess?: () => void;
}

export function useRfiMutations(options: UseRfiMutationsOptions) {
  const { toast } = useToast();
  const { selectedRfiId, onCreateSuccess, onDeleteSuccess, onEditSuccess, onAnswerSuccess, onLinkCOSuccess, onForwardSuccess } = options;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/rfi"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rfi/stats"] });
    if (selectedRfiId) {
      queryClient.invalidateQueries({ queryKey: ["/api/rfi", selectedRfiId] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfi", selectedRfiId, "activity"] });
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: RFICreateForm & { projectId: string }) => {
      const body: Record<string, unknown> = {
        projectId: data.projectId,
        subject: data.subject,
        question: data.question,
        priority: data.priority,
        costImpact: data.costImpact,
        scheduleImpact: data.scheduleImpact,
      };
      if (data.category) body.category = data.category;
      if (data.subcontractorId) body.subcontractorId = data.subcontractorId;
      if (data.assignedToId) body.assignedToId = data.assignedToId;
      if (data.drawingReference) body.drawingReference = data.drawingReference;
      if (data.specReference) body.specReference = data.specReference;
      if (data.dateRequired) body.dateRequired = data.dateRequired;
      if (data.impactDescription) body.impactDescription = data.impactDescription;
      return await apiRequest("POST", "/api/rfi", body);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI created successfully" });
      onCreateSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create RFI", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return await apiRequest("PATCH", `/api/rfi/${id}`, data);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI updated" });
      onEditSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update RFI", description: error.message, variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/submit`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI submitted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to submit RFI", description: error.message, variant: "destructive" });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/review`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI moved to review" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to start review", description: error.message, variant: "destructive" });
    },
  });

  const forwardMutation = useMutation({
    mutationFn: async ({ id, forwardedToId }: { id: string; forwardedToId: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/forward`, { forwardedToId }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI forwarded to design team" });
      onForwardSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to forward RFI", description: error.message, variant: "destructive" });
    },
  });

  const answerMutation = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/answer`, { answer }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI answered" });
      onAnswerSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to answer RFI", description: error.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/close`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI closed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to close RFI", description: error.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("POST", `/api/rfi/${id}/reopen`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI reopened" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to reopen RFI", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("DELETE", `/api/rfi/${id}`),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "RFI deleted" });
      onDeleteSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete RFI", description: error.message, variant: "destructive" });
    },
  });

  const linkCOMutation = useMutation({
    mutationFn: async ({ id, changeOrderId }: { id: string; changeOrderId: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/link-co`, { changeOrderId }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Change order linked" });
      onLinkCOSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to link change order", description: error.message, variant: "destructive" });
    },
  });

  const linkTMMutation = useMutation({
    mutationFn: async ({ id, tmTicketId }: { id: string; tmTicketId: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/link-tm`, { tmTicketId }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "T&M ticket linked" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to link T&M ticket", description: error.message, variant: "destructive" });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      await apiRequest("POST", `/api/rfi/${id}/activity`, { comment }),
    onSuccess: () => {
      if (selectedRfiId) queryClient.invalidateQueries({ queryKey: ["/api/rfi", selectedRfiId, "activity"] });
      toast({ title: "Comment added" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add comment", description: error.message, variant: "destructive" });
    },
  });

  const linkSubmittalMutation = useMutation({
    mutationFn: async ({ id, submittalId }: { id: string; submittalId: string }) =>
      await apiRequest("PATCH", `/api/rfi/${id}`, { linkedSubmittalId: submittalId }),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Submittal linked" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to link submittal", description: error.message, variant: "destructive" });
    },
  });

  return {
    createMutation,
    updateMutation,
    submitMutation,
    reviewMutation,
    forwardMutation,
    answerMutation,
    closeMutation,
    reopenMutation,
    deleteMutation,
    linkCOMutation,
    linkTMMutation,
    linkSubmittalMutation,
    addCommentMutation,
    invalidateAll,
  };
}

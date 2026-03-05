import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface TransmittalRecipient {
  id: string;
  transmittalId: string;
  subcontractorId: string;
  subcontractorName: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface Transmittal {
  id: string;
  projectId: string;
  transmittalNumber: string;
  subject: string;
  description: string | null;
  documentType: string | null;
  revisionNumber: string | null;
  status: string;
  attachmentsJson: string | null;
  notes: string | null;
  dateSent: string | null;
  sentByName: string | null;
  createdAt: string;
  updatedAt: string | null;
  project: {
    code: string;
    name: string;
  };
  recipients?: TransmittalRecipient[];
  recipientCount?: number;
}

export interface Subcontractor {
  id: string;
  companyName: string;
  name?: string;
}

export interface CreateTransmittalForm {
  projectId?: string;
  subject: string;
  description: string;
  documentType: string;
  revisionNumber: string;
  notes: string;
  recipientSubcontractorIds: string[];
}

export interface EditTransmittalForm {
  subject: string;
  description: string;
  documentType: string;
  revisionNumber: string;
  notes: string;
}

export const DOCUMENT_TYPES = [
  "Plans",
  "Drawings",
  "Specifications",
  "Addendum",
  "Shop Drawings",
  "As-Builts",
  "Other"
];

interface UseTransmittalMutationsOptions {
  onCreateSuccess?: () => void;
  onUpdateSuccess?: () => void;
  onSendSuccess?: () => void;
  onSupersedeSuccess?: () => void;
  onDeleteSuccess?: () => void;
  onAddRecipientsSuccess?: () => void;
  selectedTransmittalId?: string | null;
}

export function useTransmittalMutations(options: UseTransmittalMutationsOptions = {}) {
  const { toast } = useToast();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/transmittals"] });
  };

  const invalidateDetail = () => {
    if (options.selectedTransmittalId) {
      queryClient.invalidateQueries({ queryKey: ["/api/transmittals", options.selectedTransmittalId] });
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: CreateTransmittalForm & { projectId: string }) => {
      const body: Record<string, unknown> = {
        projectId: data.projectId,
        subject: data.subject,
      };
      if (data.description) body.description = data.description;
      if (data.documentType) body.documentType = data.documentType;
      if (data.revisionNumber) body.revisionNumber = data.revisionNumber;
      if (data.notes) body.notes = data.notes;
      if (data.recipientSubcontractorIds.length > 0) body.recipientSubcontractorIds = data.recipientSubcontractorIds;
      return await apiRequest("POST", "/api/transmittals", body);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Transmittal created successfully" });
      options.onCreateSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EditTransmittalForm }) => {
      return await apiRequest("PATCH", `/api/transmittals/${id}`, data);
    },
    onSuccess: () => {
      invalidateAll();
      invalidateDetail();
      toast({ title: "Transmittal updated" });
      options.onUpdateSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const sendMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/transmittals/${id}/send`);
    },
    onSuccess: () => {
      invalidateAll();
      invalidateDetail();
      toast({ title: "Transmittal sent to recipients" });
      options.onSendSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to send transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const supersedeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/transmittals/${id}/supersede`);
    },
    onSuccess: () => {
      invalidateAll();
      invalidateDetail();
      toast({ title: "Transmittal marked as superseded" });
      options.onSupersedeSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to supersede transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/transmittals/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Transmittal deleted" });
      options.onDeleteSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete transmittal", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const addRecipientsMutation = useMutation({
    mutationFn: async ({ id, subcontractorIds }: { id: string; subcontractorIds: string[] }) => {
      return await apiRequest("POST", `/api/transmittals/${id}/recipients`, { subcontractorIds });
    },
    onSuccess: () => {
      invalidateAll();
      invalidateDetail();
      toast({ title: "Recipients added" });
      options.onAddRecipientsSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Failed to add recipients", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  return {
    createMutation,
    updateMutation,
    sendMutation,
    supersedeMutation,
    deleteMutation,
    addRecipientsMutation,
  };
}

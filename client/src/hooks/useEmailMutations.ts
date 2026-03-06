import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface EmailSummaryDigest {
  periodDescription: string;
  totalEmails: number;
  byClassification: Record<string, number>;
  highlights: { title: string; description: string; priority: string }[];
  actionNeeded: { title: string; description: string; dueDate?: string }[];
  summaryNarrative: string;
}

export function useSyncEmails(refetchThreads: () => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/email/sync");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Sync completed", description: data.message });
      refetchThreads();
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Could not sync emails", variant: "destructive" });
    },
  });
}

export function useDailySummary() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (): Promise<EmailSummaryDigest> => {
      const res = await apiRequest("POST", "/api/email/summary/daily");
      return res.json();
    },
    onSuccess: (data: EmailSummaryDigest) => {
      toast({ title: "Summary generated", description: `Analyzed ${data.totalEmails} emails` });
    },
    onError: () => {
      toast({ title: "Summary failed", description: "Could not generate summary", variant: "destructive" });
    },
  });
}

export function useWeeklySummary() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (): Promise<EmailSummaryDigest> => {
      const res = await apiRequest("POST", "/api/email/summary/weekly");
      return res.json();
    },
    onSuccess: (data: EmailSummaryDigest) => {
      toast({ title: "Weekly summary generated", description: `Analyzed ${data.totalEmails} emails` });
    },
    onError: () => {
      toast({ title: "Summary failed", description: "Could not generate summary", variant: "destructive" });
    },
  });
}

export function useCreateAccount(callbacks: { onSuccess: () => void }) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: {
      provider: string;
      emailAddress: string;
      displayName?: string;
      imapHost?: string;
      imapPort?: number;
      imapSecure?: boolean;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
      imapUsername?: string;
      imapPassword?: string;
    }) => {
      const res = await apiRequest("POST", "/api/email/accounts", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account added", description: "Email account linked successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
      callbacks.onSuccess();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to add account", 
        description: error.message || "Could not link email account", 
        variant: "destructive" 
      });
    },
  });
}

export function useToggleAccount() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/email/accounts/${id}`, { isActive });
      return res.json();
    },
    onSuccess: (_, { isActive }) => {
      toast({ 
        title: isActive ? "Account activated" : "Account deactivated",
        description: isActive ? "Email syncing enabled" : "Email syncing paused"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
    },
    onError: () => {
      toast({ title: "Update failed", description: "Could not update account", variant: "destructive" });
    },
  });
}

export function useDeleteAccount(callbacks: { onSuccess: () => void }) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/email/accounts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account removed", description: "Email account unlinked" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
      callbacks.onSuccess();
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not remove account", variant: "destructive" });
    },
  });
}

export function useUpdateTask() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/email/tasks/${taskId}`, { status });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/tasks"] });
    },
    onError: () => {
      toast({ title: "Failed to update task", variant: "destructive" });
    },
  });
}

export function useSummarizeThread(threadId: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/email/threads/${threadId}/summarize`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Thread summarized", description: "AI summary generated" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads", threadId] });
    },
    onError: () => {
      toast({ title: "Summary failed", variant: "destructive" });
    },
  });
}

export function useAnalyzeMessage() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("POST", `/api/email/messages/${messageId}/analyze`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Email analyzed",
        description: `Classification: ${data.analysis.classification}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
    },
    onError: () => {
      toast({ title: "Analysis failed", variant: "destructive" });
    },
  });
}

export function useSuggestReply(messageId: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/email/messages/${messageId}/suggest-reply`, { tones: ["professional", "casual"] });
      return res.json();
    },
    onError: () => {
      toast({ title: "Failed to generate suggestions", variant: "destructive" });
    },
  });
}

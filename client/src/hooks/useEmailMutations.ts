import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { EmailAccount } from "@/components/email/shared";

function extractErrorMessage(error: any, fallback: string): string {
  const msg = error?.message || "";
  const jsonMatch = msg.match(/^\d+:\s*(.+)$/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return parsed.message || parsed.error || fallback;
    } catch {
      return jsonMatch[1].substring(0, 200) || fallback;
    }
  }
  return msg || fallback;
}

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
      const details = data.details as { account: string; errors: string[] }[] | undefined;
      const accountErrors = details?.filter((d: any) => d.errors?.length > 0) || [];
      if (accountErrors.length > 0) {
        const errorSummary = accountErrors
          .map((d: any) => `${d.account}: ${d.errors[0]}`)
          .join("; ");
        toast({ 
          title: "Sync completed with issues", 
          description: errorSummary.substring(0, 200),
          variant: "destructive"
        });
      } else {
        toast({ title: "Sync completed", description: data.message });
      }
      refetchThreads();
    },
    onError: (error: any) => {
      toast({ 
        title: "Sync failed", 
        description: extractErrorMessage(error, "Could not sync emails"), 
        variant: "destructive" 
      });
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
        description: extractErrorMessage(error, "Could not link email account"), 
        variant: "destructive" 
      });
    },
  });
}

export function useTestAccount() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, overrides }: { id: string; overrides?: { imapHost?: string; imapPort?: number; imapSecure?: boolean; smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; imapUsername?: string; imapPassword?: string } }) => {
      const res = await apiRequest("POST", `/api/email/accounts/${id}/test`, overrides || {});
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      toast({ 
        title: "Connection test passed", 
        description: data.message || "Successfully connected to mail server"
      });
    },
    onError: (error: unknown) => {
      toast({ 
        title: "Connection test failed", 
        description: extractErrorMessage(error, "Could not connect to mail server. Check your settings."),
        variant: "destructive" 
      });
    },
  });
}

export function useSendEmail() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: {
      accountId: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      text?: string;
      html?: string;
      inReplyTo?: string;
      references?: string;
      replyToMessageId?: string;
    }) => {
      const res = await apiRequest("POST", "/api/email/send", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Email sent", description: "Your message was sent successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Send failed", 
        description: extractErrorMessage(error, "Could not send email. Check your account settings."),
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
      const body = await res.json();
      if (body.success !== true) {
        throw new Error(body.error || "Deletion failed on the server");
      }
      return body;
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["/api/email/accounts"] });
      const previousAccounts = queryClient.getQueryData(["/api/email/accounts"]);
      queryClient.setQueryData<EmailAccount[]>(["/api/email/accounts"], (old) =>
        old ? old.filter((account) => account.id !== id) : []
      );
      return { previousAccounts };
    },
    onSuccess: () => {
      toast({ title: "Account removed", description: "Email account removed" });
      callbacks.onSuccess();
    },
    onError: (err, _id, context) => {
      if (context?.previousAccounts) {
        queryClient.setQueryData(["/api/email/accounts"], context.previousAccounts);
      }
      let message = "Could not remove account";
      if (err instanceof Error) {
        const raw = err.message;
        const jsonStart = raw.indexOf("{");
        if (jsonStart !== -1) {
          try {
            const parsed = JSON.parse(raw.slice(jsonStart));
            message = parsed.error || raw;
          } catch {
            message = raw;
          }
        } else {
          message = raw;
        }
      }
      console.error("Delete account error:", err);
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/email/summaries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });
}

export function useUpdateAccount(callbacks: { onSuccess: () => void }) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; displayName?: string; imapHost?: string; imapPort?: number; imapSecure?: boolean; smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; imapUsername?: string; imapPassword?: string }) => {
      const res = await apiRequest("PATCH", `/api/email/accounts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account updated", description: "Email account settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
      callbacks.onSuccess();
    },
    onError: (err) => {
      const message = extractErrorMessage(err, "Could not update account");
      toast({ title: "Update failed", description: message, variant: "destructive" });
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

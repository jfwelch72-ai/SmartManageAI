import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { EmailAccount, EmailMessage, EmailThread } from "@/components/email/shared";

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

export function useResyncAccount() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/email/accounts/${id}/resync`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Resync queued", description: "Sync cursors cleared. A full re-pull will run on the next sync cycle." });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
    },
    onError: (err) => {
      toast({ title: "Resync failed", description: err instanceof Error ? err.message : "Could not queue resync", variant: "destructive" });
    },
  });
}

export function useReconnectPush() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/email/accounts/${id}/reconnect-push`);
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      toast({
        title: "Real-time push reconnected",
        description: data.message || "This inbox is now wired for instant updates.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
    },
    onError: (err) => {
      toast({
        title: "Could not reconnect push",
        description: extractErrorMessage(err, "Push subscription could not be registered. The account will continue to use polling."),
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/email/accounts"] });
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

interface UpdateMessageVars {
  messageId: string;
  isRead?: boolean;
  isArchived?: boolean;
  silent?: boolean;
}

export function useUpdateMessageState(threadId?: string) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async ({ messageId, isRead, isArchived }: UpdateMessageVars) => {
      const body: Record<string, boolean> = {};
      if (isRead !== undefined) body.isRead = isRead;
      if (isArchived !== undefined) body.isArchived = isArchived;
      const res = await apiRequest("PATCH", `/api/email/messages/${messageId}`, body);
      return res.json();
    },
    onMutate: async ({ messageId, isRead, isArchived }: UpdateMessageVars) => {
      const detailKey = threadId ? ["/api/email/threads", threadId] : null;
      if (detailKey) await queryClient.cancelQueries({ queryKey: detailKey });
      await queryClient.cancelQueries({ queryKey: ["/api/email/threads"] });

      const previousDetail = detailKey ? queryClient.getQueryData(detailKey) : undefined;
      const previousLists = queryClient.getQueriesData<EmailThread[]>({ queryKey: ["/api/email/threads"] });

      let updatedThreadId = threadId;
      let newUnread: number | null = null;

      if (detailKey) {
        queryClient.setQueryData(detailKey, (old: any) => {
          if (!old || !Array.isArray(old.messages)) return old;
          const messages = old.messages.map((m: EmailMessage) => {
            if (m.id !== messageId) return m;
            return {
              ...m,
              ...(isRead !== undefined ? { isRead } : {}),
              ...(isArchived !== undefined ? { isArchived } : {}),
            };
          });
          newUnread = messages.filter((m: EmailMessage) => !m.isRead).length;
          updatedThreadId = old.thread?.id ?? threadId;
          return {
            ...old,
            messages,
            thread: old.thread ? { ...old.thread, unreadCount: newUnread } : old.thread,
          };
        });
      }

      if (updatedThreadId && newUnread !== null) {
        previousLists.forEach(([key, list]) => {
          if (!Array.isArray(list)) return;
          queryClient.setQueryData<EmailThread[]>(key, list.map((t) =>
            t.id === updatedThreadId ? { ...t, unreadCount: newUnread as number } : t
          ));
        });
      }

      return { previousDetail, previousLists, detailKey };
    },
    onError: (error: any, _vars, context) => {
      if (context?.detailKey && context.previousDetail !== undefined) {
        queryClient.setQueryData(context.detailKey, context.previousDetail);
      }
      context?.previousLists?.forEach(([key, list]) => {
        queryClient.setQueryData(key, list);
      });
      toast({
        title: "Update failed",
        description: extractErrorMessage(error, "Could not update message"),
        variant: "destructive",
      });
    },
    onSuccess: (_data, vars) => {
      if (vars.silent) return;
      const title = vars.isArchived === true
        ? "Message archived"
        : vars.isArchived === false
        ? "Message restored"
        : vars.isRead === true
        ? "Message marked read"
        : "Message marked unread";
      const undo: Pick<UpdateMessageVars, "isRead" | "isArchived"> = {};
      if (vars.isArchived !== undefined) undo.isArchived = !vars.isArchived;
      if (vars.isRead !== undefined) undo.isRead = !vars.isRead;
      const hasUndo = Object.keys(undo).length > 0;
      const undoAction: unknown = hasUndo
        ? React.createElement(
            ToastAction,
            {
              altText: "Undo",
              onClick: () => {
                mutation.mutate({ messageId: vars.messageId, ...undo });
              },
            } as React.ComponentProps<typeof ToastAction>,
            "Undo",
          )
        : undefined;
      toast({
        title,
        action: undoAction as Parameters<typeof toast>[0]["action"],
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
    },
  });
  return mutation;
}

interface UpdateThreadVars {
  threadId: string;
  isRead?: boolean;
  isArchived?: boolean;
  silent?: boolean;
}

export function useUpdateThreadState() {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async ({ threadId, isRead, isArchived }: UpdateThreadVars) => {
      const body: Record<string, boolean> = {};
      if (isRead !== undefined) body.isRead = isRead;
      if (isArchived !== undefined) body.isArchived = isArchived;
      const res = await apiRequest("PATCH", `/api/email/threads/${threadId}`, body);
      const data = await res.json();
      return { threadId, updated: data?.messagesUpdated ?? 0 };
    },
    onMutate: async ({ threadId, isRead, isArchived }: UpdateThreadVars) => {
      await queryClient.cancelQueries({ queryKey: ["/api/email/threads"] });
      const previousLists = queryClient.getQueriesData<EmailThread[]>({ queryKey: ["/api/email/threads"] });
      previousLists.forEach(([key, list]) => {
        if (!Array.isArray(list)) return;
        queryClient.setQueryData<EmailThread[]>(
          key,
          list.map((t) => {
            if (t.id !== threadId) return t;
            const next = { ...t };
            if (isRead === true) next.unreadCount = 0;
            if (isArchived !== undefined) next.status = isArchived ? "ARCHIVED" : "OPEN";
            return next;
          }),
        );
      });
      return { previousLists };
    },
    onError: (error: any, _vars, context) => {
      context?.previousLists?.forEach(([key, list]) => {
        queryClient.setQueryData(key, list);
      });
      toast({
        title: "Update failed",
        description: extractErrorMessage(error, "Could not update thread"),
        variant: "destructive",
      });
    },
    onSuccess: (_data, vars) => {
      if (vars.silent) return;
      const title = vars.isArchived === true
        ? "Thread archived"
        : vars.isArchived === false
        ? "Thread restored"
        : vars.isRead === true
        ? "Thread marked read"
        : "Thread marked unread";
      const undo: Pick<UpdateThreadVars, "isRead" | "isArchived"> = {};
      if (vars.isArchived !== undefined) undo.isArchived = !vars.isArchived;
      if (vars.isRead !== undefined) undo.isRead = !vars.isRead;
      const hasUndo = Object.keys(undo).length > 0;
      const undoAction: unknown = hasUndo
        ? React.createElement(
            ToastAction,
            {
              altText: "Undo",
              onClick: () => {
                mutation.mutate({ threadId: vars.threadId, ...undo });
              },
            } as React.ComponentProps<typeof ToastAction>,
            "Undo",
          )
        : undefined;
      toast({
        title,
        action: undoAction as Parameters<typeof toast>[0]["action"],
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
    },
  });
  return mutation;
}

interface BulkUpdateThreadVars {
  threadIds: string[];
  isRead?: boolean;
  isArchived?: boolean;
  silent?: boolean;
}

interface BulkUpdateThreadResult {
  results: { threadId: string; success: boolean; error?: string; messagesUpdated?: number; status?: string; unreadCount?: number }[];
  successCount: number;
  failureCount: number;
  messagesUpdated: number;
}

export function useBulkUpdateThreadState() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ threadIds, isRead, isArchived }: BulkUpdateThreadVars): Promise<BulkUpdateThreadResult> => {
      const body: Record<string, unknown> = { threadIds };
      if (isRead !== undefined) body.isRead = isRead;
      if (isArchived !== undefined) body.isArchived = isArchived;
      const res = await apiRequest("PATCH", `/api/email/threads/bulk`, body);
      return res.json();
    },
    onMutate: async ({ threadIds, isRead, isArchived }: BulkUpdateThreadVars) => {
      await queryClient.cancelQueries({ queryKey: ["/api/email/threads"] });
      const previousLists = queryClient.getQueriesData<EmailThread[]>({ queryKey: ["/api/email/threads"] });
      const idSet = new Set(threadIds);
      previousLists.forEach(([key, list]) => {
        if (!Array.isArray(list)) return;
        queryClient.setQueryData<EmailThread[]>(
          key,
          list.map((t) => {
            if (!idSet.has(t.id)) return t;
            const next = { ...t };
            if (isRead === true) next.unreadCount = 0;
            if (isArchived !== undefined) next.status = isArchived ? "ARCHIVED" : "OPEN";
            return next;
          }),
        );
      });
      return { previousLists };
    },
    onError: (error: any, _vars, context) => {
      context?.previousLists?.forEach(([key, list]) => {
        queryClient.setQueryData(key, list);
      });
      toast({
        title: "Bulk update failed",
        description: extractErrorMessage(error, "Could not update threads"),
        variant: "destructive",
      });
    },
    onSuccess: (data, vars) => {
      if (vars.silent) return;
      const verb = vars.isArchived === true
        ? "archived"
        : vars.isArchived === false
        ? "restored"
        : vars.isRead === true
        ? "marked read"
        : "marked unread";
      if (data.failureCount > 0) {
        toast({
          title: `${data.successCount} ${verb}, ${data.failureCount} failed`,
          description: data.failureCount === 1 ? "1 thread could not be updated" : `${data.failureCount} threads could not be updated`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${data.successCount} thread${data.successCount === 1 ? "" : "s"} ${verb}`,
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/threads"] });
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

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, isPast, subDays } from "date-fns";
import {
  AlertTriangle,
  BarChart2,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileDown,
  Inbox,
  MessageSquare,
  MessageSquareText,
  Paperclip,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SmilePlus,
  Star,
  TicketCheck,
  X,
  Download,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Link } from "wouter";
import SupportSettingsCard from "./support-settings";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTicketStream } from "@/hooks/use-ticket-stream";
import type { SupportTicket, SupportTicketReply, SupportCannedResponse, SupportAttachment } from "@shared/schema";

type TicketWithReplyCount = SupportTicket & { replyCount: number };

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_customer", label: "Waiting on Customer" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "all", label: "All Priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
] as const;

const CATEGORY_OPTIONS = [
  { value: "all", label: "All Categories" },
  { value: "general", label: "General" },
  { value: "bids", label: "Bids" },
  { value: "payroll", label: "Payroll" },
  { value: "ai_estimator", label: "AI Estimator" },
  { value: "change_orders", label: "Change Orders" },
  { value: "documents", label: "Documents" },
] as const;

const CSAT_FILTER_OPTIONS = [
  { value: "all", label: "All CSAT" },
  { value: "rated", label: "Rated" },
  { value: "unrated", label: "Not Yet Rated" },
  { value: "high", label: "High (4-5 ★)" },
  { value: "low", label: "Low (1-3 ★)" },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  bids: "Bids",
  payroll: "Payroll",
  ai_estimator: "AI Estimator",
  change_orders: "Change Orders",
  documents: "Documents",
  general: "General",
};

function statusBadge(status: SupportTicket["status"]) {
  const map: Record<SupportTicket["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
    open: { label: "Open", variant: "default" },
    in_progress: { label: "In Progress", variant: "secondary", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
    waiting_on_customer: { label: "Waiting", variant: "secondary", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100" },
    resolved: { label: "Resolved", variant: "secondary", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" },
    closed: { label: "Closed", variant: "outline" },
  };
  const cfg = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={cfg.variant} className={cfg.className}>{cfg.label}</Badge>;
}

function priorityBadge(priority: SupportTicket["priority"]) {
  const map: Record<SupportTicket["priority"], { label: string; className: string }> = {
    urgent: { label: "Urgent", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100" },
    high: { label: "High", className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100" },
    normal: { label: "Normal", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
    low: { label: "Low", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  };
  const cfg = map[priority] ?? { label: priority, className: "" };
  return <Badge variant="secondary" className={cfg.className}>{cfg.label}</Badge>;
}

function categoryBadge(category: SupportTicket["category"]) {
  if (!category) return null;
  return (
    <Badge variant="outline" className="text-xs font-normal">
      {CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}

function tierBadge(tier: SupportTicket["tier"]) {
  const map: Record<SupportTicket["tier"], { label: string; className: string }> = {
    starter: { label: "Starter", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
    pro: { label: "Pro", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100" },
    enterprise: { label: "Enterprise", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100" },
  };
  const cfg = map[tier] ?? { label: tier, className: "" };
  return <Badge variant="secondary" className={cfg.className}>{cfg.label}</Badge>;
}

function csatStars(score: number | null | undefined) {
  if (!score) return <span className="text-xs text-muted-foreground italic">—</span>;
  return (
    <div className="flex items-center gap-0.5" data-testid="csat-stars">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-3 w-3 ${s <= score ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
        />
      ))}
      <span className="text-xs ml-1 text-muted-foreground">{score}/5</span>
    </div>
  );
}

function SlaIndicator({ ticket }: { ticket: SupportTicket }) {
  const frBreached = ticket.slaFirstResponseBreached === 1;
  const resBreached = ticket.slaResolutionBreached === 1;
  const frDue = ticket.slaFirstResponseDueAt ? new Date(ticket.slaFirstResponseDueAt) : null;
  const resDue = ticket.slaResolutionDueAt ? new Date(ticket.slaResolutionDueAt) : null;
  const frAtRisk = !frBreached && frDue && isPast(frDue);
  const resAtRisk = !resBreached && resDue && isPast(resDue);

  if (!frBreached && !resBreached && !frAtRisk && !resAtRisk) {
    return <CheckCircle2 className="h-4 w-4 text-green-500" aria-label="SLA on track" />;
  }

  return (
    <div className="flex flex-col gap-1">
      {(frBreached || frAtRisk) && (
        <Badge variant="destructive" className="text-xs gap-1 py-0">
          <AlertTriangle className="h-3 w-3" />
          FR {frBreached ? "breached" : "due"}
        </Badge>
      )}
      {(resBreached || resAtRisk) && (
        <Badge variant="destructive" className="text-xs gap-1 py-0">
          <AlertTriangle className="h-3 w-3" />
          Res {resBreached ? "breached" : "due"}
        </Badge>
      )}
    </div>
  );
}

function SlaDeadlineRow({
  label,
  due,
  breached,
}: {
  label: string;
  due: string | Date | null;
  breached: number;
}) {
  if (!due) return <p className="text-sm text-muted-foreground">{label}: —</p>;
  const d = new Date(due);
  const isBreached = breached === 1 || isPast(d);
  return (
    <div className="flex items-center gap-2">
      <Clock className={`h-4 w-4 flex-shrink-0 ${isBreached ? "text-destructive" : "text-muted-foreground"}`} />
      <span className="text-sm">
        <span className="font-medium">{label}:</span>{" "}
        <span className={isBreached ? "text-destructive font-medium" : ""}>
          {format(d, "MMM d, yyyy h:mm a")}
          {isBreached ? " (breached)" : ""}
        </span>
      </span>
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: SupportAttachment[] | null | undefined }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2" data-testid="admin-attachment-list">
      {attachments.map((att, i) => (
        <a
          key={i}
          href={`/api/support/attachments/download?key=${encodeURIComponent(att.objectKey)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1 hover:bg-muted/70 transition-colors"
          data-testid={`admin-attachment-link-${i}`}
        >
          {att.contentType.startsWith("image/") ? (
            <img
              src={`/api/support/attachments/download?key=${encodeURIComponent(att.objectKey)}`}
              alt={att.fileName}
              className="h-5 w-5 object-cover rounded"
            />
          ) : (
            <Paperclip className="h-3 w-3" />
          )}
          <span className="max-w-[120px] truncate">{att.fileName}</span>
          <Download className="h-3 w-3 text-muted-foreground" />
        </a>
      ))}
    </div>
  );
}

function ReplyThread({ ticket, onTicketUpdate }: { ticket: SupportTicket; onTicketUpdate: (t: SupportTicket) => void }) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onNewReply = useCallback(() => {
    toast({ title: "New reply received", description: "A customer replied to this ticket." });
  }, [toast]);

  const { newReplyArrived, clearNewReplyFlag, usingPolling } = useTicketStream(ticket.id, true, {
    onNewReply,
  });

  const { data: repliesData, isLoading: repliesLoading } = useQuery<{ replies: SupportTicketReply[] }>({
    queryKey: ["/api/support/tickets", ticket.id, "replies"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/support/tickets/${ticket.id}/replies`);
      return res.json();
    },
  });

  const { data: cannedData } = useQuery<{ cannedResponses: SupportCannedResponse[] }>({
    queryKey: ["/api/support/canned-responses"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/support/canned-responses");
      return res.json();
    },
  });

  const cannedResponses = cannedData?.cannedResponses ?? [];
  const replies = repliesData?.replies ?? [];
  const [cannedOpen, setCannedOpen] = useState(false);

  useEffect(() => {
    if (replies.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [replies.length]);

  useEffect(() => {
    if (newReplyArrived) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      clearNewReplyFlag();
    }
  }, [newReplyArrived, clearNewReplyFlag]);

  const replyMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/support/tickets/${ticket.id}/replies`, { body });
      const data = await res.json() as { reply: SupportTicketReply; ticket: SupportTicket };
      // Upload attachments if any
      if (pendingFiles.length > 0 && data.reply?.id) {
        const formData = new FormData();
        pendingFiles.forEach((f) => formData.append("files", f));
        await fetch(`/api/support/tickets/${ticket.id}/replies/${data.reply.id}/attachments`, {
          method: "POST",
          body: formData,
          credentials: "include",
        }).catch(() => {/* best-effort */});
      }
      return data;
    },
    onSuccess: ({ ticket: updatedTicket }) => {
      setReplyText("");
      setPendingFiles([]);
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets", ticket.id, "replies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      onTicketUpdate(updatedTicket);
      toast({ title: "Reply sent", description: "The submitter has been notified by email." });
    },
    onError: (e: Error) => toast({ title: "Reply failed", description: e.message, variant: "destructive" }),
  });

  const handleSend = () => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    replyMutation.mutate(trimmed);
  };

  const handleCannedResponseSelect = (responseId: string) => {
    if (responseId === "__none__") return;
    const found = cannedResponses.find((r) => r.id === responseId);
    if (found) setReplyText(found.body);
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-3 bg-muted/40 flex items-center gap-2 border-b">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Replies {replies.length > 0 && <span className="ml-1 normal-case font-normal">({replies.length})</span>}
        </p>
        {usingPolling && (
          <span className="ml-auto text-[10px] text-muted-foreground" data-testid="text-admin-polling-fallback">
            Refreshing every 30s
          </span>
        )}
      </div>

      <div className="p-4 space-y-3 max-h-64 overflow-y-auto">
        {repliesLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : replies.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-replies">
            No replies yet. Send the first reply below.
          </p>
        ) : (
          replies.map((reply) => {
            const replyAttachments = (reply.attachments as SupportAttachment[] | null) ?? [];
            return (
              <div key={reply.id} className="rounded-md bg-primary/5 border border-primary/10 p-3 space-y-1" data-testid={`reply-${reply.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-primary" data-testid={`reply-author-${reply.id}`}>
                    {reply.authorName || "Support Team"}
                  </span>
                  <span className="text-xs text-muted-foreground" data-testid={`reply-time-${reply.id}`}>
                    {format(new Date(reply.createdAt), "MMM d, yyyy h:mm a")}
                    {reply.emailedAt && (
                      <span className="ml-1 text-green-600 dark:text-green-400" title="Email delivered">✓ emailed</span>
                    )}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid={`reply-body-${reply.id}`}>
                  {reply.body}
                </p>
                <AttachmentList attachments={replyAttachments} />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-4 space-y-2 border-t pt-3">
        {cannedResponses.length > 0 && (
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground shrink-0" />
            <Popover open={cannedOpen} onOpenChange={setCannedOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-normal text-muted-foreground justify-start w-full"
                  data-testid="select-canned-response"
                >
                  <Search className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  Use template…
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-80" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search templates…"
                    data-testid="input-canned-response-search"
                  />
                  <CommandList>
                    <CommandEmpty>No templates found.</CommandEmpty>
                    <CommandGroup>
                      {cannedResponses.map((r) => (
                        <CommandItem
                          key={r.id}
                          value={`${r.title} ${r.body}`}
                          onSelect={() => {
                            handleCannedResponseSelect(r.id);
                            setCannedOpen(false);
                          }}
                          data-testid={`canned-response-option-${r.id}`}
                        >
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-medium text-xs truncate">{r.title}</span>
                            <span className="text-xs text-muted-foreground line-clamp-1">{r.body}</span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
        <Textarea
          placeholder="Type your reply… (will be emailed to the submitter)"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          rows={3}
          disabled={replyMutation.isPending}
          data-testid="textarea-reply"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
          }}
        />
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1" data-testid="admin-pending-files">
            {pendingFiles.map((f, i) => (
              <div key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1">
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[120px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) setPendingFiles((prev) => [...prev, ...files]);
            e.target.value = "";
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={replyMutation.isPending}
              data-testid="button-attach-reply-file"
              title="Attach file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <p className="text-xs text-muted-foreground">Ctrl+Enter · reply emailed to {ticket.submitterEmail}</p>
          </div>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!replyText.trim() || replyMutation.isPending}
            data-testid="button-send-reply"
            className="gap-1"
          >
            <Send className="h-3.5 w-3.5" />
            {replyMutation.isPending ? "Sending…" : "Send Reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TicketDetailSheet({
  ticket,
  open,
  onClose,
  onUpdate,
}: {
  ticket: SupportTicket | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (updated: SupportTicket) => void;
}) {
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, string> }) => {
      const res = await apiRequest("PATCH", `/api/support/tickets/${id}`, patch);
      return res.json() as Promise<SupportTicket>;
    },
    onSuccess: (updated: SupportTicket) => {
      onUpdate(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      toast({ title: "Ticket updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (!ticket) return null;

  const handleStatusChange = (status: string) => {
    updateMutation.mutate({ id: ticket.id, patch: { status } });
  };

  const handlePriorityChange = (priority: string) => {
    updateMutation.mutate({ id: ticket.id, patch: { priority } });
  };

  const frBreached = ticket.slaFirstResponseBreached === 1;
  const resBreached = ticket.slaResolutionBreached === 1;
  const anyBreached = frBreached || resBreached;
  const ticketAttachments = (ticket.attachments as SupportAttachment[] | null) ?? [];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-start gap-2 flex-wrap">
            <SheetTitle className="flex-1 text-base leading-snug">{ticket.subject}</SheetTitle>
            {anyBreached && (
              <Badge variant="destructive" className="gap-1 shrink-0">
                <AlertTriangle className="h-3 w-3" />
                SLA Breached
              </Badge>
            )}
          </div>
          <SheetDescription>
            Ticket #{ticket.id.slice(0, 8)} · Submitted {format(new Date(ticket.createdAt), "MMM d, yyyy h:mm a")}
            {ticket.category && (
              <span className="ml-2">{categoryBadge(ticket.category)}</span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Status</Label>
              <Select
                value={ticket.status}
                onValueChange={handleStatusChange}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger data-testid="select-ticket-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="waiting_on_customer">Waiting on Customer</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Priority</Label>
              <Select
                value={ticket.priority}
                onValueChange={handlePriorityChange}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger data-testid="select-ticket-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-2 bg-muted/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submitter</p>
            <p className="text-sm font-medium">{ticket.submitterName || "—"}</p>
            <p className="text-sm text-muted-foreground">{ticket.submitterEmail}</p>
            {ticket.organizationId && (
              <p className="text-xs text-muted-foreground">Org ID: {ticket.organizationId}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tier</p>
              {tierBadge(ticket.tier)}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Priority</p>
              {priorityBadge(ticket.priority)}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Category</p>
              {ticket.category ? categoryBadge(ticket.category) : <span className="text-xs text-muted-foreground">—</span>}
            </div>
          </div>

          {(ticket.csatScore || ticket.csatSubmittedAt) && (
            <div className="rounded-lg border p-4 space-y-2 bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer Satisfaction</p>
              <div data-testid="csat-detail">{csatStars(ticket.csatScore)}</div>
              {ticket.csatComment && (
                <p className="text-sm text-muted-foreground italic">"{ticket.csatComment}"</p>
              )}
              {ticket.csatSubmittedAt && (
                <p className="text-xs text-muted-foreground">
                  Rated {format(new Date(ticket.csatSubmittedAt), "MMM d, yyyy")}
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SLA Deadlines</p>
            <SlaDeadlineRow
              label="First Response Due"
              due={ticket.slaFirstResponseDueAt}
              breached={ticket.slaFirstResponseBreached}
            />
            <SlaDeadlineRow
              label="Resolution Due"
              due={ticket.slaResolutionDueAt}
              breached={ticket.slaResolutionBreached}
            />
            {ticket.firstResponseAt && (
              <p className="text-sm text-muted-foreground">
                First response sent: {format(new Date(ticket.firstResponseAt), "MMM d, yyyy h:mm a")}
              </p>
            )}
            {ticket.resolvedAt && (
              <p className="text-sm text-muted-foreground">
                Resolved at: {format(new Date(ticket.resolvedAt), "MMM d, yyyy h:mm a")}
              </p>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{ticket.body}</p>
            <AttachmentList attachments={ticketAttachments} />
          </div>

          <ReplyThread ticket={ticket} onTicketUpdate={onUpdate} />

          {ticket.route && (
            <div>
              <p className="text-xs text-muted-foreground">Submitted from route: <code className="text-xs bg-muted px-1 rounded">{ticket.route}</code></p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface TicketMetrics {
  windowDays: number;
  total: number;
  open: number;
  resolved: number;
  firstResponseBreached: number;
  resolutionBreached: number;
  adherence?: number;
  avgCsatScore?: number | null;
  csatResponseRate?: number;
  categoryCounts?: Record<string, number>;
}

interface CsatWeekPoint { week: string; avgScore: number; count: number; }
interface CsatDistPoint { score: number; count: number; }
interface CsatCategoryPoint { category: string; avgScore: number; count: number; }
interface CsatLowestTicket {
  id: string;
  subject: string;
  submitterName: string | null;
  submitterEmail: string;
  csatScore: number | null;
  csatComment: string | null;
  csatSubmittedAt: string | Date | null;
  category: string | null;
}
interface CsatTrendData {
  weeklyTrend: CsatWeekPoint[];
  distribution: CsatDistPoint[];
  byCategory: CsatCategoryPoint[];
  lowestScored: CsatLowestTicket[];
}

const SCORE_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#84cc16",
  5: "#22c55e",
};

const CATEGORY_LABELS_FULL: Record<string, string> = {
  bids: "Bids",
  payroll: "Payroll",
  ai_estimator: "AI Estimator",
  change_orders: "Change Orders",
  documents: "Documents",
  general: "General",
};

function CsatDashboard() {
  const [days, setDays] = useState<number>(30);

  const { data, isLoading } = useQuery<CsatTrendData>({
    queryKey: ["/api/support/csat-trend", days],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/support/csat-trend?days=${days}`);
      return res.json();
    },
    refetchInterval: 120_000,
  });

  const weeklyTrend = data?.weeklyTrend ?? [];
  const distribution = data?.distribution ?? [];
  const byCategory = data?.byCategory ?? [];
  const lowestScored = data?.lowestScored ?? [];

  const totalRated = distribution.reduce((s, d) => s + d.count, 0);
  const overallAvg =
    totalRated > 0
      ? distribution.reduce((s, d) => s + d.score * d.count, 0) / totalRated
      : null;

  const formatWeek = (w: string) => {
    try {
      const d = new Date(w + "T00:00:00Z");
      return format(d, "MMM d");
    } catch {
      return w;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="csat-dashboard-loading">
        <Skeleton className="h-48 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (totalRated === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground" data-testid="csat-dashboard-empty">
        <SmilePlus className="h-10 w-10" />
        <p className="text-sm font-medium">No CSAT ratings in the last {days} days</p>
        <p className="text-xs">Ratings are collected automatically when tickets are resolved.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="csat-dashboard">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          {overallAvg !== null && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`h-5 w-5 ${s <= Math.round(overallAvg) ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
                  />
                ))}
              </div>
              <span className="text-2xl font-bold" data-testid="csat-overall-avg">
                {overallAvg.toFixed(1)}
              </span>
              <span className="text-sm text-muted-foreground">/ 5 ({totalRated} rated)</span>
            </div>
          )}
        </div>
        <Select
          value={String(days)}
          onValueChange={(v) => setDays(Number(v))}
        >
          <SelectTrigger className="w-36" data-testid="select-csat-days">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {weeklyTrend.length > 1 && (
        <Card data-testid="csat-weekly-trend-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Average Score by Week</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weeklyTrend} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="week"
                  tickFormatter={formatWeek}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} tickLine={false} />
                <Tooltip
                  formatter={(value: number) => [`${value}/5`, "Avg Score"]}
                  labelFormatter={(label: string) => `Week of ${formatWeek(label)}`}
                />
                <Line
                  type="monotone"
                  dataKey="avgScore"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#6366f1" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="csat-distribution-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Score Distribution</CardTitle>
            <CardDescription className="text-xs">{totalRated} total ratings</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={distribution} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="score"
                  tickFormatter={(v) => `${"★".repeat(v)}`}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} />
                <Tooltip
                  formatter={(value: number) => [value, "Tickets"]}
                  labelFormatter={(label: number) => `${label} star${label === 1 ? "" : "s"}`}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {distribution.map((entry) => (
                    <Cell key={entry.score} fill={SCORE_COLORS[entry.score] ?? "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {byCategory.length > 0 && (
          <Card data-testid="csat-by-category-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Avg Score by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={byCategory.map((b) => ({ ...b, label: CATEGORY_LABELS_FULL[b.category] ?? b.category }))}
                  layout="vertical"
                  margin={{ top: 4, right: 40, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} tickLine={false} width={90} />
                  <Tooltip
                    formatter={(value: number, _: string, props: { payload?: CsatCategoryPoint }) => [
                      `${value}/5 (${props.payload?.count ?? 0} rated)`,
                      "Avg Score",
                    ]}
                  />
                  <Bar dataKey="avgScore" radius={[0, 4, 4, 0]}>
                    {byCategory.map((entry) => (
                      <Cell
                        key={entry.category}
                        fill={entry.avgScore >= 4 ? "#22c55e" : entry.avgScore >= 3 ? "#eab308" : "#ef4444"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {lowestScored.length > 0 && (
        <Card data-testid="csat-lowest-tickets-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Lowest-Scoring Tickets</CardTitle>
            <CardDescription className="text-xs">Recent tickets with score ≤ 3 — review these for quality improvements</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead className="hidden sm:table-cell">Submitter</TableHead>
                    <TableHead className="hidden sm:table-cell">Category</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="hidden md:table-cell">Comment</TableHead>
                    <TableHead className="hidden md:table-cell">Rated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowestScored.map((t) => (
                    <TableRow key={t.id} data-testid={`csat-low-row-${t.id}`}>
                      <TableCell className="font-medium max-w-[180px] truncate" data-testid={`csat-low-subject-${t.id}`}>
                        {t.subject}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground max-w-[120px] truncate">
                        {t.submitterName || t.submitterEmail}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {t.category ? (
                          <Badge variant="outline" className="text-xs font-normal">
                            {CATEGORY_LABELS_FULL[t.category] ?? t.category}
                          </Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell data-testid={`csat-low-score-${t.id}`}>
                        {csatStars(t.csatScore)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[200px] truncate">
                        {t.csatComment || <span className="italic">No comment</span>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {t.csatSubmittedAt ? format(new Date(t.csatSubmittedAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCards({ metrics, isLoading }: { metrics: TicketMetrics | undefined; isLoading: boolean }) {
  const breachedCount = (metrics?.firstResponseBreached ?? 0) + (metrics?.resolutionBreached ?? 0);
  const adherencePct = metrics?.adherence !== undefined ? Math.round(metrics.adherence * 100) : null;
  const csatDisplay = metrics?.avgCsatScore != null
    ? `${metrics.avgCsatScore}/5`
    : "—";

  const cards = [
    {
      label: "Total (7d)",
      value: metrics?.total ?? 0,
      icon: <TicketCheck className="h-5 w-5 text-muted-foreground" />,
      className: "",
      testId: "metric-total",
    },
    {
      label: "Open",
      value: metrics?.open ?? 0,
      icon: <Clock className="h-5 w-5 text-blue-500" />,
      className: "",
      testId: "metric-open",
    },
    {
      label: "Resolved",
      value: metrics?.resolved ?? 0,
      icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
      className: "",
      testId: "metric-resolved",
    },
    {
      label: "SLA Adherence",
      value: adherencePct !== null ? `${adherencePct}%` : "—",
      icon: <ShieldCheck className="h-5 w-5 text-indigo-500" />,
      className: "",
      testId: "metric-adherence",
    },
    {
      label: "SLA Breached",
      value: breachedCount,
      icon: <ShieldAlert className={`h-5 w-5 ${breachedCount > 0 ? "text-destructive" : "text-muted-foreground"}`} />,
      className: breachedCount > 0 ? "border-destructive/50 bg-destructive/5" : "",
      testId: "metric-breached",
    },
    {
      label: "Avg CSAT",
      value: csatDisplay,
      icon: <Star className={`h-5 w-5 ${metrics?.avgCsatScore != null ? "text-yellow-500 fill-yellow-400" : "text-muted-foreground"}`} />,
      className: "",
      testId: "metric-csat",
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <Card key={card.label} className={card.className} data-testid={card.testId}>
          <CardContent className="p-4">
            {isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {card.label}
                  </span>
                  {card.icon}
                </div>
                <span
                  className={`text-2xl font-bold leading-none ${
                    card.testId === "metric-breached" && breachedCount > 0
                      ? "text-destructive"
                      : ""
                  }`}
                  data-testid={`${card.testId}-value`}
                >
                  {card.value}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Analytics types ──────────────────────────────────────────────────────────

interface VolumeSeries { day: string; total: number; resolved: number; open: number; }
interface SlaSeries { day: string; adherence: number; }
interface MedianTierStats { medianFirstResponseMin: number | null; medianResolutionMin: number | null; }
interface CategoryBreakdown { category: string; count: number; }
interface AgentStat {
  agentId: string; name: string; email: string;
  ticketsAssigned: number; ticketsResolved: number;
  avgFirstResponseMin: number | null; avgResolutionMin: number | null;
  avgCsat: number | null;
}
interface AgeBucket { bucket: string; count: number; }

interface AnalyticsData {
  from: string; to: string; granularity: string;
  volumeSeries: VolumeSeries[];
  slaSeries: SlaSeries[];
  medianByTier: Record<string, MedianTierStats>;
  categoryBreakdown: CategoryBreakdown[];
  agentPerformance: AgentStat[];
  ageBuckets: AgeBucket[];
}

const RANGE_OPTIONS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

const CHART_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#f97316"];

function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function KpiCard({ label, value, sub, testId }: { label: string; value: string | number; sub?: string; testId?: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function VolumeBarChart({ data }: { data: VolumeSeries[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">No data in range</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => format(new Date(v), "MMM d")} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip labelFormatter={(v) => format(new Date(v as string), "MMM d, yyyy")} />
        <Legend />
        <Bar dataKey="open" name="Open" stackId="a" fill="#6366f1" />
        <Bar dataKey="resolved" name="Resolved" stackId="a" fill="#22c55e" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SlaAdherenceLineChart({ data }: { data: SlaSeries[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">No data in range</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => format(new Date(v), "MMM d")} />
        <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
        <Tooltip labelFormatter={(v) => format(new Date(v as string), "MMM d, yyyy")} formatter={(v: number) => [`${v}%`, "Adherence"]} />
        <Line type="monotone" dataKey="adherence" name="SLA Adherence %" stroke="#6366f1" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function CategoryDonutChart({ data }: { data: CategoryBreakdown[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">No data in range</p>;
  const LABELS: Record<string, string> = {
    bids: "Bids", payroll: "Payroll", ai_estimator: "AI Estimator",
    change_orders: "Change Orders", documents: "Documents", general: "General",
  };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="category" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={entry.category} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number, name: string) => [v, LABELS[name] ?? name]} />
        <Legend formatter={(v) => LABELS[v] ?? v} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TicketAgeHistogram({ data }: { data: AgeBucket[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">No open tickets in range</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" name="Open Tickets" fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AgentPerformanceTable({ agents }: { agents: AgentStat[] }) {
  if (!agents.length) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No assigned tickets in the selected range
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Assigned</TableHead>
            <TableHead className="text-right">Resolved</TableHead>
            <TableHead className="text-right hidden sm:table-cell">Avg First Response</TableHead>
            <TableHead className="text-right hidden sm:table-cell">Avg Resolution</TableHead>
            <TableHead className="text-right hidden md:table-cell">Avg CSAT</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow key={agent.agentId} data-testid={`agent-row-${agent.agentId}`}>
              <TableCell>
                <p className="font-medium text-sm">{agent.name}</p>
                <p className="text-xs text-muted-foreground">{agent.email}</p>
              </TableCell>
              <TableCell className="text-right font-mono">{agent.ticketsAssigned}</TableCell>
              <TableCell className="text-right font-mono">{agent.ticketsResolved}</TableCell>
              <TableCell className="text-right font-mono hidden sm:table-cell">
                {fmtMinutes(agent.avgFirstResponseMin)}
              </TableCell>
              <TableCell className="text-right font-mono hidden sm:table-cell">
                {fmtMinutes(agent.avgResolutionMin)}
              </TableCell>
              <TableCell className="text-right hidden md:table-cell">
                {agent.avgCsat != null ? (
                  <span className="flex items-center justify-end gap-1">
                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    {agent.avgCsat.toFixed(1)}
                  </span>
                ) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AnalyticsTab() {
  const [rangeDays, setRangeDays] = useState(30);
  const [granularity, setGranularity] = useState<"day" | "week">("day");

  const toDate = new Date();
  const fromDate = subDays(toDate, rangeDays);

  const params = new URLSearchParams({
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    granularity,
  });

  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/support/analytics", rangeDays, granularity],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/support/analytics?${params}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const overall = data?.medianByTier?.overall;

  const handleExport = () => {
    const exportParams = new URLSearchParams({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    });
    window.open(`/api/support/analytics/export?${exportParams}`, "_blank");
  };

  return (
    <div className="space-y-6" data-testid="analytics-tab">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/40">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setRangeDays(opt.days)}
              data-testid={`range-btn-${opt.days}`}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                rangeDays === opt.days
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/40">
          {(["day", "week"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              data-testid={`gran-btn-${g}`}
              className={`px-3 py-1 rounded-md text-sm font-medium capitalize transition-colors ${
                granularity === g
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2" data-testid="button-export-csv">
            <FileDown className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            label="Median First Response"
            value={fmtMinutes(overall?.medianFirstResponseMin)}
            sub="Overall"
            testId="kpi-median-fr"
          />
          <KpiCard
            label="Median Resolution"
            value={fmtMinutes(overall?.medianResolutionMin)}
            sub="Overall"
            testId="kpi-median-res"
          />
          <KpiCard
            label="Total Tickets"
            value={data?.volumeSeries.reduce((s, d) => s + d.total, 0) ?? 0}
            sub={`${rangeDays}-day window`}
            testId="kpi-total"
          />
          <KpiCard
            label="Avg SLA Adherence"
            value={
              data?.slaSeries.length
                ? `${Math.round(data.slaSeries.reduce((s, d) => s + d.adherence, 0) / data.slaSeries.length)}%`
                : "—"
            }
            sub="Across selected range"
            testId="kpi-sla"
          />
        </div>
      )}

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Volume Trend</CardTitle>
            <CardDescription>Daily open vs resolved ticket counts</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : <VolumeBarChart data={data?.volumeSeries ?? []} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">SLA Adherence Trend</CardTitle>
            <CardDescription>Daily % of tickets meeting SLA targets</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : <SlaAdherenceLineChart data={data?.slaSeries ?? []} />}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Category Breakdown</CardTitle>
            <CardDescription>Ticket volume by category</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : <CategoryDonutChart data={data?.categoryBreakdown ?? []} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ticket Age Distribution</CardTitle>
            <CardDescription>How long open tickets have been waiting</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : <TicketAgeHistogram data={data?.ageBuckets ?? []} />}
          </CardContent>
        </Card>
      </div>

      {/* Median by tier */}
      {!isLoading && data && Object.keys(data.medianByTier).filter((k) => k !== "overall").length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Median Response Times by Tier</CardTitle>
            <CardDescription>First response and resolution median (minutes) broken down by support tier</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Median First Response</TableHead>
                    <TableHead className="text-right">Median Resolution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(["starter", "pro", "enterprise"] as const)
                    .filter((t) => data.medianByTier[t])
                    .map((tier) => {
                      const stats = data.medianByTier[tier];
                      return (
                        <TableRow key={tier} data-testid={`median-row-${tier}`}>
                          <TableCell className="capitalize font-medium">{tier}</TableCell>
                          <TableCell className="text-right font-mono">{fmtMinutes(stats.medianFirstResponseMin)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtMinutes(stats.medianResolutionMin)}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Agent Performance</CardTitle>
          <CardDescription>Per-agent ticket counts, response times, and satisfaction scores</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map((i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <AgentPerformanceTable agents={data?.agentPerformance ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSupportTicketsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [csatFilter, setCsatFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (priorityFilter !== "all") queryParams.set("priority", priorityFilter);
  if (categoryFilter !== "all") queryParams.set("category", categoryFilter);
  if (csatFilter !== "all") queryParams.set("csat", csatFilter);
  queryParams.set("limit", "200");
  const queryString = queryParams.toString();

  const { data: metricsData, isLoading: metricsLoading } = useQuery<TicketMetrics>({
    queryKey: ["/api/support/tickets/metrics"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/support/tickets/metrics");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data, isLoading } = useQuery<{ tickets: TicketWithReplyCount[] }>({
    queryKey: ["/api/support/tickets", statusFilter, priorityFilter, categoryFilter, csatFilter, "admin-200"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/support/tickets?${queryString}`);
      return res.json();
    },
  });

  const tickets = useMemo(() => {
    let list = data?.tickets ?? [];
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          (t.submitterName ?? "").toLowerCase().includes(q) ||
          t.submitterEmail.toLowerCase().includes(q),
      );
    }
    return list;
  }, [data?.tickets, searchText]);

  const breachedCount = tickets.filter(
    (t) => t.slaFirstResponseBreached === 1 || t.slaResolutionBreached === 1,
  ).length;

  const openTicket = (t: SupportTicket) => {
    setSelectedTicket(t);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
  };

  const handleTicketUpdate = (updated: SupportTicket) => {
    setSelectedTicket(updated);
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="gap-1" data-testid="link-back-admin">
              <ChevronLeft className="h-4 w-4" />
              Admin
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="heading-support-tickets">
              <TicketCheck className="h-6 w-6" />
              Support Tickets
            </h1>
            <p className="text-muted-foreground text-sm">All submitted support tickets across every organization</p>
          </div>
          <Link href="/admin/support-canned-responses">
            <Button variant="outline" size="sm" className="gap-1" data-testid="link-canned-responses">
              <MessageSquareText className="h-4 w-4" />
              Canned Responses
            </Button>
          </Link>
        </div>

        <MetricCards metrics={metricsData} isLoading={metricsLoading} />

        <Tabs defaultValue="tickets" data-testid="support-tabs">
          <TabsList data-testid="support-tabs-list">
            <TabsTrigger value="tickets" className="gap-1.5" data-testid="tab-tickets">
              <TicketCheck className="h-4 w-4" />
              Tickets
            </TabsTrigger>
            <TabsTrigger value="satisfaction" className="gap-1.5" data-testid="tab-satisfaction">
              <Star className="h-4 w-4" />
              Satisfaction
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5" data-testid="tab-analytics">
              <BarChart2 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5" data-testid="tab-settings">
              <Settings className="h-4 w-4" />
              Support Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tickets" className="space-y-4 mt-4">
            {breachedCount > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="alert-sla-breached">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span><strong>{breachedCount}</strong> ticket{breachedCount === 1 ? "" : "s"} with SLA breaches</span>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Filter &amp; Search</CardTitle>
                <CardDescription>Narrow down tickets by status, priority, category, or keyword</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  <div className="flex-1 min-w-[160px]">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger data-testid="select-status-filter">
                        <SelectValue placeholder="All Statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} data-testid={`status-option-${o.value}`}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 min-w-[160px]">
                    <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                      <SelectTrigger data-testid="select-priority-filter">
                        <SelectValue placeholder="All Priorities" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} data-testid={`priority-option-${o.value}`}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 min-w-[160px]">
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger data-testid="select-category-filter">
                        <SelectValue placeholder="All Categories" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} data-testid={`category-option-${o.value}`}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 min-w-[160px]">
                    <Select value={csatFilter} onValueChange={setCsatFilter}>
                      <SelectTrigger data-testid="select-csat-filter">
                        <SelectValue placeholder="All CSAT" />
                      </SelectTrigger>
                      <SelectContent>
                        {CSAT_FILTER_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} data-testid={`csat-option-${o.value}`}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 min-w-[240px] relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      className="pl-9"
                      placeholder="Search subject, name, or email…"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      data-testid="input-ticket-search"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-6 space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : tickets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground" data-testid="empty-state-tickets">
                    <Inbox className="h-10 w-10" />
                    <p className="text-sm font-medium">No tickets found</p>
                    <p className="text-xs">Try adjusting your filters</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Subject</TableHead>
                          <TableHead className="hidden md:table-cell">Submitter</TableHead>
                          <TableHead className="hidden lg:table-cell">Category</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="hidden sm:table-cell">Priority</TableHead>
                          <TableHead className="hidden sm:table-cell">Tier</TableHead>
                          <TableHead className="hidden sm:table-cell">Replies</TableHead>
                          <TableHead className="hidden md:table-cell">CSAT</TableHead>
                          <TableHead>SLA</TableHead>
                          <TableHead className="hidden md:table-cell">Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tickets.map((ticket) => {
                          const anyBreached =
                            ticket.slaFirstResponseBreached === 1 ||
                            ticket.slaResolutionBreached === 1;
                          return (
                            <TableRow
                              key={ticket.id}
                              className={`cursor-pointer hover:bg-muted/50 ${anyBreached ? "bg-destructive/5" : ""}`}
                              onClick={() => openTicket(ticket)}
                              data-testid={`row-ticket-${ticket.id}`}
                            >
                              <TableCell className="font-medium max-w-[200px] truncate" data-testid={`text-ticket-subject-${ticket.id}`}>
                                {ticket.subject}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[140px] truncate" data-testid={`text-ticket-submitter-${ticket.id}`}>
                                {ticket.submitterName || ticket.submitterEmail}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell" data-testid={`badge-ticket-category-${ticket.id}`}>
                                {categoryBadge(ticket.category)}
                              </TableCell>
                              <TableCell data-testid={`badge-ticket-status-${ticket.id}`}>
                                {statusBadge(ticket.status)}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell" data-testid={`badge-ticket-priority-${ticket.id}`}>
                                {priorityBadge(ticket.priority)}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell" data-testid={`badge-ticket-tier-${ticket.id}`}>
                                {tierBadge(ticket.tier)}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell" data-testid={`badge-reply-count-${ticket.id}`}>
                                {ticket.replyCount > 0 ? (
                                  <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                                    <MessageSquare className="h-3 w-3" />
                                    {ticket.replyCount}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">No reply</span>
                                )}
                              </TableCell>
                              <TableCell className="hidden md:table-cell" data-testid={`csat-ticket-${ticket.id}`}>
                                {csatStars(ticket.csatScore)}
                              </TableCell>
                              <TableCell data-testid={`sla-ticket-${ticket.id}`}>
                                <SlaIndicator ticket={ticket} />
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-xs text-muted-foreground" data-testid={`text-ticket-created-${ticket.id}`}>
                                {format(new Date(ticket.createdAt), "MMM d, yyyy")}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground text-right" data-testid="text-ticket-count">
              Showing {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
            </p>
          </TabsContent>

          <TabsContent value="satisfaction" className="mt-4">
            <CsatDashboard />
          </TabsContent>

          <TabsContent value="analytics" className="mt-4">
            <AnalyticsTab />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <SupportSettingsCard />
          </TabsContent>
        </Tabs>
      </main>

      <TicketDetailSheet
        ticket={selectedTicket}
        open={sheetOpen}
        onClose={closeSheet}
        onUpdate={handleTicketUpdate}
      />
    </div>
  );
}

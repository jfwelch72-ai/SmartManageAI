import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, isPast } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Inbox,
  MessageSquare,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTicketStream } from "@/hooks/use-ticket-stream";
import type { SupportTicket, SupportTicketReply } from "@shared/schema";

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

function tierBadge(tier: SupportTicket["tier"]) {
  const map: Record<SupportTicket["tier"], { label: string; className: string }> = {
    starter: { label: "Starter", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
    pro: { label: "Pro", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100" },
    enterprise: { label: "Enterprise", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100" },
  };
  const cfg = map[tier] ?? { label: tier, className: "" };
  return <Badge variant="secondary" className={cfg.className}>{cfg.label}</Badge>;
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

function ReplyThread({ ticket, onTicketUpdate }: { ticket: SupportTicket; onTicketUpdate: (t: SupportTicket) => void }) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const replies = repliesData?.replies ?? [];

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
      return res.json() as Promise<{ reply: SupportTicketReply; ticket: SupportTicket }>;
    },
    onSuccess: ({ ticket: updatedTicket }) => {
      setReplyText("");
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
          replies.map((reply) => (
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
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-4 space-y-2 border-t pt-3">
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
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Ctrl+Enter to send · reply is emailed to {ticket.submitterEmail}</p>
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
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              {statusBadge(ticket.status)}
            </div>
          </div>

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
}

function MetricCards({ metrics, isLoading }: { metrics: TicketMetrics | undefined; isLoading: boolean }) {
  const breachedCount = (metrics?.firstResponseBreached ?? 0) + (metrics?.resolutionBreached ?? 0);
  const adherencePct = metrics?.adherence !== undefined ? Math.round(metrics.adherence * 100) : null;

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
  ] as const;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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

export default function AdminSupportTicketsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const queryParams = new URLSearchParams();
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  if (priorityFilter !== "all") queryParams.set("priority", priorityFilter);
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
    queryKey: ["/api/support/tickets", statusFilter, priorityFilter, "admin-200"],
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
  }, [data?.tickets, priorityFilter, searchText]);

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
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" className="gap-1" data-testid="link-back-admin">
              <ChevronLeft className="h-4 w-4" />
              Admin
            </Button>
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="heading-support-tickets">
              <TicketCheck className="h-6 w-6" />
              Support Tickets
            </h1>
            <p className="text-muted-foreground text-sm">All submitted support tickets across every organization</p>
          </div>
        </div>

        <MetricCards metrics={metricsData} isLoading={metricsLoading} />

        {breachedCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="alert-sla-breached">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span><strong>{breachedCount}</strong> ticket{breachedCount === 1 ? "" : "s"} with SLA breaches</span>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Filter &amp; Search</CardTitle>
            <CardDescription>Narrow down tickets by status, priority, or keyword</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[180px]">
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

              <div className="flex-1 min-w-[180px]">
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
                      <TableHead className="hidden lg:table-cell">Org</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Priority</TableHead>
                      <TableHead className="hidden sm:table-cell">Tier</TableHead>
                      <TableHead className="hidden sm:table-cell">Replies</TableHead>
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
                          <TableCell className="font-medium max-w-[240px] truncate" data-testid={`text-ticket-subject-${ticket.id}`}>
                            {ticket.subject}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[160px] truncate" data-testid={`text-ticket-submitter-${ticket.id}`}>
                            {ticket.submitterName || ticket.submitterEmail}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[120px] truncate" data-testid={`text-ticket-org-${ticket.id}`}>
                            {ticket.organizationId ? ticket.organizationId.slice(0, 8) : "—"}
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

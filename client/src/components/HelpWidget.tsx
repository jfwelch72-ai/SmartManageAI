import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  HelpCircle,
  Search,
  X,
  ExternalLink,
  Loader2,
  Send,
  CheckCircle2,
  Activity,
  ChevronLeft,
  MessageSquare,
  Clock,
  Paperclip,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTicketStream } from "@/hooks/use-ticket-stream";
import type { SupportTicket, SupportTicketReply, SupportAttachment } from "@shared/schema";

const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "bids", label: "Bids" },
  { value: "payroll", label: "Payroll" },
  { value: "ai_estimator", label: "AI Estimator" },
  { value: "change_orders", label: "Change Orders" },
  { value: "documents", label: "Documents" },
] as const;

interface HelpSummary {
  slug: string;
  title: string;
  module: string;
  tags: string[];
  routes: string[];
  excerpt: string;
}

interface HelpArticle extends HelpSummary {
  body: string;
}

function ArticleView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { data, isLoading } = useQuery<HelpArticle>({ queryKey: ["/api/support/help/articles", slug] });
  return (
    <div className="space-y-3" data-testid="help-article-view">
      <button
        type="button"
        className="text-xs text-muted-foreground hover:underline"
        onClick={onBack}
        data-testid="button-help-article-back"
      >
        ← Back to articles
      </button>
      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <article className="prose prose-sm dark:prose-invert max-w-none">
          <h2 className="text-base font-semibold mb-2">{data.title}</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-transparent p-0">{data.body}</pre>
        </article>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<SupportTicket["status"], string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  in_progress: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  waiting_on_customer: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  closed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const STATUS_LABELS: Record<SupportTicket["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting_on_customer: "Awaiting Reply",
  resolved: "Resolved",
  closed: "Closed",
};

function AttachmentList({ attachments }: { attachments: SupportAttachment[] | null | undefined }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2" data-testid="attachment-list">
      {attachments.map((att, i) => (
        <a
          key={i}
          href={`/api/support/attachments/download?key=${encodeURIComponent(att.objectKey)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1 hover:bg-muted/70 transition-colors"
          data-testid={`attachment-link-${i}`}
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

function FilePickerButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-muted-foreground"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        data-testid="button-attach-file"
        title="Attach file"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  );
}

function TicketThreadView({
  ticket,
  onBack,
  currentUserId,
}: {
  ticket: SupportTicket;
  onBack: () => void;
  currentUserId: string;
}) {
  const { toast } = useToast();
  const [replyBody, setReplyBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const repliesQuery = useQuery<{ replies: SupportTicketReply[] }>({
    queryKey: ["/api/support/my-tickets", ticket.id, "replies"],
    queryFn: () => apiRequest("GET", `/api/support/my-tickets/${ticket.id}/replies`).then((r) => r.json()),
  });

  const { newReplyArrived, clearNewReplyFlag, usingPolling } = useTicketStream(ticket.id, false, {
    onNewReply: () => {
      toast({ title: "New reply received", description: "The support team has replied to your ticket." });
    },
  });

  useEffect(() => {
    if (newReplyArrived) clearNewReplyFlag();
  }, [newReplyArrived, clearNewReplyFlag]);

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/support/my-tickets/${ticket.id}/replies`, {
        body: replyBody,
      });
      const data = await res.json();
      // If there are files, upload them attached to this reply
      if (pendingFiles.length > 0 && data.reply?.id) {
        const formData = new FormData();
        pendingFiles.forEach((f) => formData.append("files", f));
        await fetch(`/api/support/tickets/${ticket.id}/replies/${data.reply.id}/attachments`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
      }
      return data;
    },
    onSuccess: () => {
      setReplyBody("");
      setPendingFiles([]);
      queryClient.invalidateQueries({ queryKey: ["/api/support/my-tickets", ticket.id, "replies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/my-tickets"] });
      toast({ title: "Reply sent", description: "Your reply has been sent to the support team." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not send reply", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const replies = repliesQuery.data?.replies ?? [];
  const isClosedOrResolved = ticket.status === "resolved" || ticket.status === "closed";
  const ticketAttachments = (ticket.attachments as SupportAttachment[] | null) ?? [];

  return (
    <div className="space-y-3" data-testid="ticket-thread-view">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
          onClick={onBack}
          data-testid="button-ticket-back"
        >
          <ChevronLeft className="h-3 w-3" /> Back to my tickets
        </button>
        {usingPolling && (
          <span className="text-[10px] text-muted-foreground" data-testid="text-polling-fallback">
            Refreshing every 30s
          </span>
        )}
      </div>

      <div className="rounded-md border border-border p-3 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold leading-snug">{ticket.subject}</div>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_COLORS[ticket.status]}`}
            data-testid="text-ticket-status"
          >
            {STATUS_LABELS[ticket.status]}
          </span>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {new Date(ticket.createdAt).toLocaleDateString()}
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap mt-2 pt-2 border-t border-border">
          {ticket.body}
        </div>
        <AttachmentList attachments={ticketAttachments} />
      </div>

      {repliesQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading replies…
        </div>
      ) : replies.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-3">
          No replies yet — we'll respond within your plan's SLA window.
        </div>
      ) : (
        <div className="space-y-2" data-testid="ticket-replies-list">
          {replies.map((reply) => {
            const isCustomer = reply.authorId === currentUserId;
            const replyAttachments = (reply.attachments as SupportAttachment[] | null) ?? [];
            return (
              <div
                key={reply.id}
                className={`rounded-md p-3 text-sm ${
                  isCustomer
                    ? "bg-primary/10 ml-4"
                    : "bg-muted mr-4"
                }`}
                data-testid={`ticket-reply-${reply.id}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-xs">
                    {isCustomer ? "You" : "Support Team"}
                  </span>
                  {!isCustomer && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                      Support
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(reply.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="whitespace-pre-wrap">{reply.body}</div>
                <AttachmentList attachments={replyAttachments} />
              </div>
            );
          })}
        </div>
      )}

      {!isClosedOrResolved && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!replyBody.trim()) return;
            replyMutation.mutate();
          }}
          className="space-y-2 pt-2 border-t border-border"
        >
          <Label htmlFor="reply-body" className="text-xs">Reply to Support Team</Label>
          <Textarea
            id="reply-body"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Type your reply…"
            rows={3}
            required
            minLength={1}
            data-testid="input-ticket-reply-body"
          />
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-1" data-testid="pending-files-list">
              {pendingFiles.map((f, i) => (
                <div key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1">
                  <Paperclip className="h-3 w-3" />
                  <span className="max-w-[100px] truncate">{f.name}</span>
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
          <div className="flex gap-2 items-center">
            <FilePickerButton
              onFiles={(files) => setPendingFiles((prev) => [...prev, ...files])}
              disabled={replyMutation.isPending}
            />
            <Button
              type="submit"
              size="sm"
              disabled={replyMutation.isPending || !replyBody.trim()}
              className="flex-1"
              data-testid="button-ticket-reply-submit"
            >
              {replyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-3 w-3 mr-1" /> Send Reply
                </>
              )}
            </Button>
          </div>
        </form>
      )}

      {isClosedOrResolved && (
        <div className="text-xs text-center text-muted-foreground py-2">
          This ticket is {STATUS_LABELS[ticket.status].toLowerCase()}. Open a new ticket if you need further help.
        </div>
      )}
    </div>
  );
}

function MyTicketsTab({ currentUserId }: { currentUserId: string }) {
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);

  const ticketsQuery = useQuery<{ tickets: SupportTicket[] }>({
    queryKey: ["/api/support/my-tickets"],
    queryFn: () => apiRequest("GET", "/api/support/my-tickets").then((r) => r.json()),
  });

  const tickets = ticketsQuery.data?.tickets ?? [];

  if (selectedTicket) {
    return (
      <TicketThreadView
        ticket={selectedTicket}
        onBack={() => setSelectedTicket(null)}
        currentUserId={currentUserId}
      />
    );
  }

  if (ticketsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your tickets…
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="text-center py-8 space-y-2" data-testid="my-tickets-empty">
        <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto" />
        <div className="text-sm text-muted-foreground">No tickets yet.</div>
        <div className="text-xs text-muted-foreground">Submit a ticket via the "Contact us" tab.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="my-tickets-list">
      {tickets.map((ticket) => (
        <button
          key={ticket.id}
          type="button"
          onClick={() => setSelectedTicket(ticket)}
          className="w-full text-left rounded-md border border-border p-3 hover:bg-muted/50 transition-colors space-y-1"
          data-testid={`ticket-item-${ticket.id}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium leading-snug line-clamp-1">{ticket.subject}</div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_COLORS[ticket.status]}`}
            >
              {STATUS_LABELS[ticket.status]}
            </span>
          </div>
          <div className="text-xs text-muted-foreground line-clamp-2">{ticket.body}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(ticket.createdAt).toLocaleDateString()}
          </div>
        </button>
      ))}
    </div>
  );
}

export default function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>("articles");
  const [query, setQuery] = useState("");
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const enabled = open;
  const articlesQuery = useQuery<{ articles: HelpSummary[] }>({
    queryKey: ["/api/support/help/articles", { q: query, route: location }],
    enabled,
  });

  const contextual = useMemo(() => {
    const all = articlesQuery.data?.articles ?? [];
    const byRoute = all.filter((a) => a.routes.some((r) => location.startsWith(r)));
    return byRoute.length > 0 ? byRoute.slice(0, 5) : all.slice(0, 5);
  }, [articlesQuery.data, location]);

  const allResults = articlesQuery.data?.articles ?? [];

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [newTicketId, setNewTicketId] = useState<string | null>(null);

  const ticketMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/tickets", {
        subject,
        body,
        priority,
        category,
        submitterEmail: user?.email,
        submitterName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined,
        route: location,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        metadata: { url: typeof window !== "undefined" ? window.location.href : undefined },
      });
      const data = await res.json();
      // Upload attachments if any
      if (pendingFiles.length > 0 && data.id) {
        const formData = new FormData();
        pendingFiles.forEach((f) => formData.append("files", f));
        await fetch(`/api/support/tickets/${data.id}/attachments`, {
          method: "POST",
          body: formData,
          credentials: "include",
        }).catch(() => {/* best-effort */});
      }
      return data;
    },
    onSuccess: (data) => {
      setSubmitted(true);
      setNewTicketId(data.id ?? null);
      setSubject("");
      setBody("");
      setPendingFiles([]);
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/my-tickets"] });
      toast({ title: "Ticket submitted", description: "Our team will respond per your plan SLA." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not submit ticket", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!open) {
      setActiveSlug(null);
      setSubmitted(false);
    }
  }, [open]);

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-3 hover:bg-primary/90"
        aria-label="Open help"
        data-testid="button-open-help-widget"
      >
        <HelpCircle className="h-5 w-5" />
        <span className="text-sm font-medium hidden sm:inline">Help</span>
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-5 z-50 w-[380px] max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
          data-testid="help-widget-panel"
        >
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Help & Support</span>
            </div>
            <div className="flex items-center gap-1">
              <a
                href="/status"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
                data-testid="link-help-status"
              >
                <Activity className="h-3 w-3" /> Status
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close help"
                data-testid="button-close-help-widget"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="p-3 max-h-[70vh] overflow-y-auto">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="articles" data-testid="tab-help-articles">Articles</TabsTrigger>
                <TabsTrigger value="ticket" data-testid="tab-help-ticket">Contact us</TabsTrigger>
                <TabsTrigger value="my-tickets" data-testid="tab-help-my-tickets">My Tickets</TabsTrigger>
              </TabsList>

              <TabsContent value="articles" className="space-y-3 mt-3">
                {activeSlug ? (
                  <ArticleView slug={activeSlug} onBack={() => setActiveSlug(null)} />
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search the help center"
                        className="pl-8"
                        data-testid="input-help-search"
                      />
                    </div>
                    {!query && contextual.length > 0 && (
                      <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">For this page</div>
                        <ul className="space-y-1">
                          {contextual.map((a) => (
                            <li key={a.slug}>
                              <button
                                type="button"
                                onClick={() => setActiveSlug(a.slug)}
                                className="text-left text-sm hover:underline"
                                data-testid={`link-help-contextual-${a.slug}`}
                              >
                                {a.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                        {query ? `Results (${allResults.length})` : "All articles"}
                      </div>
                      {articlesQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                        </div>
                      ) : allResults.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No articles found.</div>
                      ) : (
                        <ul className="space-y-2">
                          {allResults.slice(0, 30).map((a) => (
                            <li key={a.slug} className="border-b border-border pb-2 last:border-0">
                              <button
                                type="button"
                                onClick={() => setActiveSlug(a.slug)}
                                className="text-left w-full"
                                data-testid={`link-help-article-${a.slug}`}
                              >
                                <div className="text-sm font-medium">{a.title}</div>
                                <div className="text-xs text-muted-foreground">{a.module}</div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <a
                      href="/help"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      data-testid="link-help-open-center"
                    >
                      Open the full help center <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </TabsContent>

              <TabsContent value="ticket" className="mt-3 space-y-3">
                {submitted ? (
                  <div className="text-center py-6 space-y-2" data-testid="help-ticket-success">
                    <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
                    <div className="text-sm font-medium">We've got your ticket.</div>
                    <p className="text-xs text-muted-foreground">
                      You'll get an email reply within your plan's SLA window.{" "}
                      <a href="/sla" target="_blank" rel="noreferrer" className="underline">
                        See SLA
                      </a>
                    </p>
                    <div className="flex gap-2 justify-center flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => setSubmitted(false)} data-testid="button-help-ticket-new">
                        Submit another ticket
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setTab("my-tickets"); setSubmitted(false); }}
                        data-testid="button-help-view-tickets"
                      >
                        View my tickets
                      </Button>
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!subject.trim() || !body.trim()) return;
                      ticketMutation.mutate();
                    }}
                    className="space-y-3"
                  >
                    <div>
                      <Label htmlFor="help-category" className="text-xs">Category</Label>
                      <select
                        id="help-category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full rounded-md border border-input bg-background text-sm px-2 py-1.5"
                        data-testid="select-help-ticket-category"
                      >
                        {CATEGORY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="help-subject" className="text-xs">Subject</Label>
                      <Input
                        id="help-subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="Briefly describe the issue"
                        required
                        minLength={3}
                        data-testid="input-help-ticket-subject"
                      />
                    </div>
                    <div>
                      <Label htmlFor="help-body" className="text-xs">Details</Label>
                      <Textarea
                        id="help-body"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="What happened? What did you expect?"
                        rows={4}
                        required
                        minLength={5}
                        data-testid="input-help-ticket-body"
                      />
                    </div>
                    <div>
                      <Label htmlFor="help-priority" className="text-xs">Priority</Label>
                      <select
                        id="help-priority"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as typeof priority)}
                        className="w-full rounded-md border border-input bg-background text-sm px-2 py-1.5"
                        data-testid="select-help-ticket-priority"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Attachments (optional)</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <FilePickerButton
                          onFiles={(files) => setPendingFiles((prev) => [...prev, ...files])}
                          disabled={ticketMutation.isPending}
                        />
                        <span className="text-xs text-muted-foreground">Images, PDFs, Office docs up to 25 MB each</span>
                      </div>
                      {pendingFiles.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2" data-testid="ticket-pending-files">
                          {pendingFiles.map((f, i) => (
                            <div key={i} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1">
                              <Paperclip className="h-3 w-3" />
                              <span className="max-w-[100px] truncate">{f.name}</span>
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
                    </div>
                    <div className="text-xs text-muted-foreground">
                      We'll attach this page ({location}), your user, and your organization automatically.
                    </div>
                    <Button
                      type="submit"
                      disabled={ticketMutation.isPending}
                      className="w-full"
                      data-testid="button-help-ticket-submit"
                    >
                      {ticketMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" /> Submit ticket
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </TabsContent>

              <TabsContent value="my-tickets" className="mt-3">
                <MyTicketsTab currentUserId={user.id} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </>
  );
}

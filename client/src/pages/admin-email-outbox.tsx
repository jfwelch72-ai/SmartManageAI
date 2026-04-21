import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Inbox, Loader2, Trash2, Mail, FilterX } from "lucide-react";
import { format } from "date-fns";
import NotFound from "@/pages/not-found";

interface CapturedEmail {
  to: string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  source: "resend" | "smtp";
  capturedAt: string;
}

interface OutboxResponse {
  transport: "noop";
  messages: CapturedEmail[];
}

const QUERY_KEY = ["/api/admin/dev/email-outbox"];

export default function AdminEmailOutboxPage() {
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery<OutboxResponse>({
    queryKey: QUERY_KEY,
    refetchInterval: 5000,
    retry: false,
  });

  const [recipientFilter, setRecipientFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "resend" | "smtp">("all");

  const messages = data?.messages ?? [];

  const filteredMessages = useMemo(() => {
    const recipient = recipientFilter.trim().toLowerCase();
    const subject = subjectFilter.trim().toLowerCase();
    return messages.filter((msg) => {
      if (sourceFilter !== "all" && msg.source !== sourceFilter) return false;
      if (subject && !(msg.subject ?? "").toLowerCase().includes(subject)) return false;
      if (recipient) {
        const haystack = [
          ...(msg.to ?? []),
          ...(msg.cc ?? []),
          ...(msg.bcc ?? []),
        ]
          .join(",")
          .toLowerCase();
        if (!haystack.includes(recipient)) return false;
      }
      return true;
    });
  }, [messages, recipientFilter, subjectFilter, sourceFilter]);

  const filtersActive =
    recipientFilter.trim() !== "" ||
    subjectFilter.trim() !== "" ||
    sourceFilter !== "all";

  const clearFilters = () => {
    setRecipientFilter("");
    setSubjectFilter("");
    setSourceFilter("all");
  };

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/admin/dev/email-outbox");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Outbox cleared", description: "All captured test emails were removed." });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to clear outbox",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    // When EMAIL_TRANSPORT=noop is not set (e.g. production) the API
    // returns 404. Mirror that on the client so the page is effectively
    // hidden — render the standard NotFound page rather than a banner.
    return <NotFound />;
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="heading-email-outbox">
            <Inbox className="h-6 w-6" />
            Test Email Outbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Captured outbound emails while <code className="px-1 py-0.5 rounded bg-muted">EMAIL_TRANSPORT=noop</code>.
            Nothing was actually delivered.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending || messages.length === 0}
          data-testid="button-clear-outbox"
        >
          {clearMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          Clear outbox
        </Button>
      </div>

      <Card data-testid="card-filters">
        <CardContent className="py-4 grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="filter-recipient" className="text-xs">Recipient</Label>
            <Input
              id="filter-recipient"
              placeholder="email or domain…"
              value={recipientFilter}
              onChange={(e) => setRecipientFilter(e.target.value)}
              data-testid="input-filter-recipient"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-subject" className="text-xs">Subject contains</Label>
            <Input
              id="filter-subject"
              placeholder="search subject…"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              data-testid="input-filter-subject"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-source" className="text-xs">Source</Label>
            <Select
              value={sourceFilter}
              onValueChange={(v) => setSourceFilter(v as "all" | "resend" | "smtp")}
            >
              <SelectTrigger id="filter-source" data-testid="select-filter-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-source-all">All sources</SelectItem>
                <SelectItem value="resend" data-testid="option-source-resend">Resend</SelectItem>
                <SelectItem value="smtp" data-testid="option-source-smtp">SMTP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            onClick={clearFilters}
            disabled={!filtersActive}
            data-testid="button-clear-filters"
          >
            <FilterX className="h-4 w-4 mr-2" />
            Reset
          </Button>
        </CardContent>
      </Card>

      <div className="text-sm text-muted-foreground" data-testid="text-message-count">
        {filtersActive ? (
          <>
            Showing {filteredMessages.length} of {messages.length}{" "}
            {messages.length === 1 ? "message" : "messages"}
          </>
        ) : (
          <>
            {messages.length} captured {messages.length === 1 ? "message" : "messages"}
          </>
        )}
      </div>

      {messages.length === 0 ? (
        <Card data-testid="card-empty-outbox">
          <CardContent className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
            <Mail className="h-10 w-10" />
            <div>No captured emails yet. Trigger a flow such as password reset to populate the outbox.</div>
          </CardContent>
        </Card>
      ) : filteredMessages.length === 0 ? (
        <Card data-testid="card-empty-filtered">
          <CardContent className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
            <FilterX className="h-10 w-10" />
            <div>No messages match the current filters.</div>
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              data-testid="button-clear-filters-empty"
            >
              Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredMessages
            .slice()
            .reverse()
            .map((msg, idx) => {
              const realIndex = messages.indexOf(msg);
              return (
                <Card key={`${msg.capturedAt}-${realIndex}`} data-testid={`card-email-${realIndex}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate" data-testid={`text-subject-${realIndex}`}>
                          {msg.subject || "(no subject)"}
                        </CardTitle>
                        <CardDescription className="mt-1 space-y-0.5">
                          <div data-testid={`text-from-${realIndex}`}>
                            <span className="font-medium">From:</span> {msg.from}
                          </div>
                          <div data-testid={`text-to-${realIndex}`}>
                            <span className="font-medium">To:</span> {msg.to.join(", ")}
                          </div>
                          {msg.cc && msg.cc.length > 0 && (
                            <div>
                              <span className="font-medium">Cc:</span> {msg.cc.join(", ")}
                            </div>
                          )}
                          {msg.bcc && msg.bcc.length > 0 && (
                            <div>
                              <span className="font-medium">Bcc:</span> {msg.bcc.join(", ")}
                            </div>
                          )}
                          {msg.replyTo && (
                            <div>
                              <span className="font-medium">Reply-To:</span> {msg.replyTo}
                            </div>
                          )}
                        </CardDescription>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="secondary" data-testid={`badge-source-${realIndex}`}>
                          {msg.source}
                        </Badge>
                        <span className="text-xs text-muted-foreground" data-testid={`text-captured-${realIndex}`}>
                          {format(new Date(msg.capturedAt), "PPpp")}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue={msg.html ? "html" : "text"}>
                      <TabsList>
                        {msg.html && (
                          <TabsTrigger value="html" data-testid={`tab-html-${realIndex}`}>
                            HTML
                          </TabsTrigger>
                        )}
                        {msg.text && (
                          <TabsTrigger value="text" data-testid={`tab-text-${realIndex}`}>
                            Text
                          </TabsTrigger>
                        )}
                        {msg.html && (
                          <TabsTrigger value="html-source" data-testid={`tab-html-source-${realIndex}`}>
                            HTML source
                          </TabsTrigger>
                        )}
                      </TabsList>
                      {msg.html && (
                        <TabsContent value="html">
                          <ScrollArea className="h-[300px] rounded-md border bg-white">
                            <iframe
                              title={`email-${realIndex}`}
                              srcDoc={msg.html}
                              sandbox=""
                              className="w-full h-[300px]"
                              data-testid={`iframe-html-${realIndex}`}
                            />
                          </ScrollArea>
                        </TabsContent>
                      )}
                      {msg.text && (
                        <TabsContent value="text">
                          <ScrollArea className="h-[300px] rounded-md border p-3">
                            <pre
                              className="text-xs whitespace-pre-wrap font-mono"
                              data-testid={`pre-text-${realIndex}`}
                            >
                              {msg.text}
                            </pre>
                          </ScrollArea>
                        </TabsContent>
                      )}
                      {msg.html && (
                        <TabsContent value="html-source">
                          <ScrollArea className="h-[300px] rounded-md border p-3">
                            <pre
                              className="text-xs whitespace-pre-wrap font-mono"
                              data-testid={`pre-html-source-${realIndex}`}
                            >
                              {msg.html}
                            </pre>
                          </ScrollArea>
                        </TabsContent>
                      )}
                    </Tabs>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}
    </div>
  );
}

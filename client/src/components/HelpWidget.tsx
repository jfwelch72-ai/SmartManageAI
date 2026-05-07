import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { HelpCircle, Search, X, ExternalLink, Loader2, Send, CheckCircle2, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [submitted, setSubmitted] = useState(false);

  const ticketMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/support/tickets", {
        subject,
        body,
        priority,
        submitterEmail: user?.email,
        submitterName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined,
        route: location,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        metadata: { url: typeof window !== "undefined" ? window.location.href : undefined },
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      setSubject("");
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
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
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-3 hover:bg-primary/90"
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
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="articles" data-testid="tab-help-articles">Articles</TabsTrigger>
                <TabsTrigger value="ticket" data-testid="tab-help-ticket">Contact us</TabsTrigger>
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
                    <Button size="sm" variant="outline" onClick={() => setSubmitted(false)} data-testid="button-help-ticket-new">
                      Submit another ticket
                    </Button>
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
                        rows={5}
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
            </Tabs>
          </div>
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCcw, Database, Sparkles, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AccessRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  enabled: boolean;
  canTrain: boolean;
  enabledAt: string | null;
}

interface IngestRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  bidsIngested: number;
  estimatesIngested: number;
  takeoffsIngested: number;
  costPostingsIngested: number;
  ratesUpdated: number;
  trigger: string;
  errorMessage: string | null;
}

interface LearnedRate {
  id: string;
  costCode: string;
  metric: string;
  unit: string;
  sampleSize: number;
  mean: string | null;
  median: string | null;
  p25: string | null;
  p75: string | null;
  lastUpdatedAt: string;
}

interface FeedbackRow {
  id: string;
  createdAt: string;
  surface: string;
  outcome: string;
  costCode: string | null;
  comment: string | null;
}

interface FeedbackStats {
  totalEvents: number;
  acceptanceRate: number | null;
  bySurface: Record<string, { ACCEPTED: number; EDITED: number; REJECTED: number; THUMBS_UP: number; THUMBS_DOWN: number }>;
}

export default function AiEstimatorAdminPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("access");

  const accessQuery = useQuery<{ users: AccessRow[] }>({ queryKey: ["/api/ai-estimator/admin/access"] });
  const runsQuery = useQuery<{ runs: IngestRun[] }>({ queryKey: ["/api/ai-estimator/admin/ingest-runs"] });
  const ratesQuery = useQuery<{ rates: LearnedRate[] }>({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
  const feedbackQuery = useQuery<{ stats: FeedbackStats; recent: FeedbackRow[] }>({ queryKey: ["/api/ai-estimator/admin/feedback"] });

  const updateAccess = useMutation({
    mutationFn: async (vars: { userId: string; enabled: boolean; canTrain?: boolean }) =>
      apiRequest("PUT", "/api/ai-estimator/admin/access", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/access"] });
      toast({ title: "Access updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const triggerIngest = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/ai-estimator/admin/ingest", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/ingest-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/admin/learned-rates"] });
      toast({ title: "Ingestion started", description: "Re-trained from your historical data." });
    },
    onError: (err: Error) => toast({ title: "Ingestion failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-ai-estimator-admin">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> AI Estimator Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control which estimators can use the workspace, monitor learned cost-rate health, and review feedback.
          </p>
        </div>
        <Button
          onClick={() => triggerIngest.mutate()}
          disabled={triggerIngest.isPending}
          data-testid="button-trigger-ingest"
        >
          {triggerIngest.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
          Re-train from history
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="access" data-testid="tab-access">User access</TabsTrigger>
          <TabsTrigger value="ingest" data-testid="tab-ingest">Training runs</TabsTrigger>
          <TabsTrigger value="rates" data-testid="tab-rates">Learned rates</TabsTrigger>
          <TabsTrigger value="feedback" data-testid="tab-feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Per-user enablement</CardTitle>
              <CardDescription>
                The AI Estimator is opt-in. Enable individual users below — only enabled users will see drafts, the chat panel, and inline suggestions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accessQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead>Can contribute to training</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessQuery.data?.users.map((u) => (
                      <TableRow key={u.userId} data-testid={`row-access-${u.userId}`}>
                        <TableCell>
                          <div className="font-medium">{u.name || u.email}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{u.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={u.enabled}
                            onCheckedChange={(v) => updateAccess.mutate({ userId: u.userId, enabled: v, canTrain: u.canTrain })}
                            data-testid={`switch-enabled-${u.userId}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={u.canTrain}
                            disabled={!u.enabled}
                            onCheckedChange={(v) => updateAccess.mutate({ userId: u.userId, enabled: u.enabled, canTrain: v })}
                            data-testid={`switch-train-${u.userId}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ingest">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" /> Historical training runs
              </CardTitle>
              <CardDescription>
                Each run scans your bids, estimates, takeoffs, and historical-cost data to refresh the learned rates store.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runsQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Bids</TableHead>
                      <TableHead>Estimates</TableHead>
                      <TableHead>Takeoffs</TableHead>
                      <TableHead>Rates updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runsQuery.data?.runs.map((r) => (
                      <TableRow key={r.id} data-testid={`row-run-${r.id}`}>
                        <TableCell className="whitespace-nowrap">{new Date(r.startedAt).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "SUCCESS" ? "default" : r.status === "FAILED" ? "destructive" : "secondary"}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{r.trigger}</TableCell>
                        <TableCell>{r.bidsIngested}</TableCell>
                        <TableCell>{r.estimatesIngested}</TableCell>
                        <TableCell>{r.takeoffsIngested}</TableCell>
                        <TableCell>{r.ratesUpdated}</TableCell>
                      </TableRow>
                    ))}
                    {runsQuery.data?.runs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                          No training runs yet. Click <strong>Re-train from history</strong> above to seed the rates store.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates">
          <Card>
            <CardHeader>
              <CardTitle>Learned cost rates</CardTitle>
              <CardDescription>Per cost code / metric / unit, derived only from this organization's data.</CardDescription>
            </CardHeader>
            <CardContent>
              {ratesQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <ScrollArea className="h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cost code</TableHead>
                        <TableHead>Metric</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>n</TableHead>
                        <TableHead>Median</TableHead>
                        <TableHead>P25 – P75</TableHead>
                        <TableHead>Updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ratesQuery.data?.rates.map((r) => (
                        <TableRow key={r.id} data-testid={`row-rate-${r.id}`}>
                          <TableCell className="font-mono text-xs">{r.costCode}</TableCell>
                          <TableCell>{r.metric}</TableCell>
                          <TableCell>{r.unit}</TableCell>
                          <TableCell>{r.sampleSize}</TableCell>
                          <TableCell>{r.median ?? r.mean ?? "—"}</TableCell>
                          <TableCell>{r.p25 && r.p75 ? `${r.p25} – ${r.p75}` : "—"}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{new Date(r.lastUpdatedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                      {ratesQuery.data?.rates.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                            No rates learned yet — run training to seed.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Feedback signals</CardTitle>
              <CardDescription>How estimators are reacting to AI suggestions in the last 30 days.</CardDescription>
            </CardHeader>
            <CardContent>
              {feedbackQuery.isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Total events</div>
                      <div className="text-2xl font-bold" data-testid="text-feedback-total">{feedbackQuery.data?.stats.totalEvents ?? 0}</div>
                    </div>
                    <div className="rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">Acceptance rate</div>
                      <div className="text-2xl font-bold" data-testid="text-acceptance-rate">
                        {feedbackQuery.data?.stats.acceptanceRate != null
                          ? `${(feedbackQuery.data.stats.acceptanceRate * 100).toFixed(0)}%`
                          : "—"}
                      </div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Surface</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Cost code</TableHead>
                        <TableHead>Comment</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {feedbackQuery.data?.recent.map((f) => (
                        <TableRow key={f.id} data-testid={`row-feedback-${f.id}`}>
                          <TableCell className="whitespace-nowrap text-xs">{new Date(f.createdAt).toLocaleString()}</TableCell>
                          <TableCell>{f.surface}</TableCell>
                          <TableCell>
                            <Badge variant={f.outcome === "ACCEPTED" || f.outcome === "THUMBS_UP" ? "default" : f.outcome === "REJECTED" || f.outcome === "THUMBS_DOWN" ? "destructive" : "secondary"}>
                              {f.outcome}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{f.costCode ?? "—"}</TableCell>
                          <TableCell className="text-xs">{f.comment ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

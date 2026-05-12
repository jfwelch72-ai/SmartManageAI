import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, ColoredAvatarFallback } from "@/components/ui/avatar";
import { CrmActivityTimeline } from "@/components/crm/CrmActivityTimeline";
import { LogCallDialog } from "@/components/crm/LogCallDialog";
import { CrmCustomFieldsDisplay } from "@/components/crm/CrmCustomFieldsForm";
import { EnrollSequenceDialog } from "@/components/crm/EnrollSequenceDialog";
import {
  ArrowLeft,
  Building2,
  User,
  Calendar,
  MapPin,
  Mail,
  Phone,
  DollarSign,
  Trophy,
  AlertCircle,
  Brain,
  Target,
  ChevronRight,
  FileText,
  CheckSquare,
  TrendingUp,
  Clock,
  Edit,
  FolderOpen,
  Plus,
  MessageSquare,
  FileSignature,
} from "lucide-react";
import { format, formatDistanceToNowStrict, differenceInDays } from "date-fns";

const STAGES = [
  {
    key: "LEAD",
    label: "Lead",
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    probability: 10,
  },
  {
    key: "QUALIFIED",
    label: "Qualified",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    probability: 25,
  },
  {
    key: "ESTIMATING",
    label: "Estimating",
    color:
      "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
    probability: 40,
  },
  {
    key: "BID_SUBMITTED",
    label: "Bid Submitted",
    color:
      "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    probability: 60,
  },
  {
    key: "NEGOTIATION",
    label: "Negotiation",
    color:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    probability: 75,
  },
  {
    key: "WON",
    label: "Won",
    color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    probability: 100,
  },
  {
    key: "LOST",
    label: "Lost",
    color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    probability: 0,
  },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

interface Opportunity {
  id: string;
  name: string;
  stage: StageKey;
  dealValue: string | null;
  probability: number | null;
  aiWinProbability: number | null;
  aiWinProbabilityRationale: string | null;
  crmOrganisationId: string | null;
  contactId: string | null;
  assignedToId: string | null;
  projectType: string | null;
  projectLocation: string | null;
  expectedCloseDate: string | null;
  source: string | null;
  notes: string | null;
  lostReason: string | null;
  lostCategory: string | null;
  leadScore: number | null;
  wonAt: string | null;
  lostAt: string | null;
  createdAt: string;
  updatedAt: string;
  crmOrgName?: string | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  assignedFirstName?: string | null;
  assignedLastName?: string | null;
  customFields?: Record<string, unknown>;
}

function formatCurrency(value: number | string | null | undefined): string {
  if (!value) return "$0";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "$0";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function staleness(updatedAt: string): { dot: string; label: string } {
  const days = differenceInDays(new Date(), new Date(updatedAt));
  if (days <= 3) return { dot: "bg-green-500", label: `Active — ${days}d` };
  if (days <= 14)
    return { dot: "bg-yellow-500", label: `${days}d since update` };
  return { dot: "bg-red-500", label: `Stale — ${days}d` };
}

export default function CrmDealDetailPage() {
  const [, params] = useRoute("/crm/deals/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const id = params?.id ?? "";
  const canEdit = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"].includes(
    user?.role ?? "",
  );

  const [lostOpen, setLostOpen] = useState(false);
  const [lostForm, setLostForm] = useState({
    lostCategory: "PRICE",
    lostReason: "",
  });
  const [activityOpen, setActivityOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({
    activityType: "NOTE",
    description: "",
    scheduledAt: "",
  });

  const { data: opp, isLoading } = useQuery<Opportunity>({
    queryKey: ["/api/crm/opportunities", id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/opportunities/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load opportunity");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: oppQuotes = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/quotes", { opportunityId: id }],
    queryFn: async () => {
      const res = await fetch(`/api/crm/quotes?opportunityId=${id}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id,
  });
  const { data: tasks = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/tasks", { opportunityId: id }],
    queryFn: async () => {
      const res = await fetch(`/api/crm/tasks?opportunityId=${id}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id,
  });

  const openTasks = tasks.filter((t: any) => t.status !== "DONE");

  const stageMutation = useMutation({
    mutationFn: (stage: StageKey) =>
      apiRequest("PATCH", `/api/crm/opportunities/${id}`, { stage }),
    onSuccess: (_, stage) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/opportunities", id, "activities"],
      });
      toast({
        title: `Moved to ${STAGES.find((s) => s.key === stage)?.label}`,
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to move stage",
        description: e.message,
        variant: "destructive",
      }),
  });

  const markLost = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/crm/opportunities/${id}`, {
        stage: "LOST",
        lostCategory: lostForm.lostCategory,
        lostReason: lostForm.lostReason || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/opportunities", id, "activities"],
      });
      setLostOpen(false);
      setLostForm({ lostCategory: "PRICE", lostReason: "" });
      toast({ title: "Marked as Lost" });
    },
    onError: (e: Error) =>
      toast({
        title: "Failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const logActivity = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/crm/opportunities/${id}/activities`,
        activityForm,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/opportunities", id, "activities"],
      });
      setActivityOpen(false);
      setActivityForm({
        activityType: "NOTE",
        description: "",
        scheduledAt: "",
      });
      toast({ title: "Activity logged" });
    },
    onError: () =>
      toast({ title: "Failed to log activity", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-full px-4 py-6 space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="lg:col-span-2 h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (!opp) {
    return (
      <div className="container mx-auto max-w-full px-4 py-12 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground" data-testid="text-not-found">
          Opportunity not found.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/crm")}
          data-testid="button-back-to-crm"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to CRM
        </Button>
      </div>
    );
  }

  const stage = STAGES.find((s) => s.key === opp.stage) ?? STAGES[0];
  const stale = staleness(opp.updatedAt);
  const ageDays = differenceInDays(new Date(), new Date(opp.createdAt));
  const ownerInitials =
    `${opp.assignedFirstName?.[0] ?? ""}${opp.assignedLastName?.[0] ?? ""}`.toUpperCase() ||
    "—";
  const closeIn = opp.expectedCloseDate
    ? differenceInDays(new Date(opp.expectedCloseDate), new Date())
    : null;

  return (
    <div className="min-h-screen bg-muted/20">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 bg-background border-b shadow-sm"
        data-testid="header-deal-detail"
      >
        <div className="container mx-auto max-w-full px-4 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Link
              href="/crm"
              className="hover:text-foreground flex items-center gap-1"
              data-testid="link-back-crm"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> CRM
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span>Pipeline</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span
              className="text-foreground truncate"
              data-testid="text-breadcrumb-name"
            >
              {opp.name}
            </span>
          </div>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1
                  className="text-2xl font-bold leading-tight"
                  data-testid="heading-deal-name"
                >
                  {opp.name}
                </h1>
                <Badge
                  className={`${stage.color} border-0`}
                  data-testid="badge-stage"
                >
                  {stage.label}
                </Badge>
                {opp.leadScore != null && (
                  <Badge
                    variant="outline"
                    className={
                      opp.leadScore >= 70
                        ? "border-green-500 text-green-700 dark:text-green-400"
                        : opp.leadScore >= 40
                          ? "border-yellow-500 text-yellow-700 dark:text-yellow-400"
                          : "border-slate-400 text-slate-600 dark:text-slate-400"
                    }
                    data-testid="badge-lead-score"
                  >
                    <Target className="w-3 h-3 mr-1" /> Score {opp.leadScore}
                  </Badge>
                )}
                <span
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  data-testid="text-staleness"
                >
                  <span className={`w-2 h-2 rounded-full ${stale.dot}`} />
                  {stale.label}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-2 flex-wrap text-sm">
                <span
                  className="flex items-center gap-1.5 font-semibold text-primary"
                  data-testid="text-deal-value"
                >
                  <DollarSign className="w-4 h-4" />
                  {formatCurrency(opp.dealValue)}
                </span>
                {opp.crmOrgName && (
                  <span
                    className="flex items-center gap-1.5 text-muted-foreground"
                    data-testid="text-org"
                  >
                    <Building2 className="w-4 h-4" />
                    {opp.crmOrgName}
                  </span>
                )}
                {opp.expectedCloseDate && (
                  <span
                    className="flex items-center gap-1.5 text-muted-foreground"
                    data-testid="text-close-date"
                  >
                    <Calendar className="w-4 h-4" />
                    Closes{" "}
                    {format(new Date(opp.expectedCloseDate), "MMM d, yyyy")}
                    {closeIn != null && (
                      <span
                        className={
                          closeIn < 0
                            ? "text-red-600 dark:text-red-400"
                            : closeIn < 7
                              ? "text-orange-600 dark:text-orange-400"
                              : ""
                        }
                      >
                        (
                        {closeIn < 0
                          ? `${-closeIn}d overdue`
                          : `in ${closeIn}d`}
                        )
                      </span>
                    )}
                  </span>
                )}
                <span
                  className="flex items-center gap-1.5 text-muted-foreground"
                  data-testid="text-age"
                >
                  <Clock className="w-4 h-4" />
                  Open {ageDays}d
                </span>
              </div>
            </div>
            {canEdit && opp.stage !== "WON" && opp.stage !== "LOST" && (
              <div className="flex items-center gap-2 flex-wrap">
                <EnrollSequenceDialog opportunityId={opp.id} />
                <Select
                  value={opp.stage}
                  onValueChange={(v) => {
                    if (v === "LOST") {
                      setLostOpen(true);
                      return;
                    }
                    stageMutation.mutate(v as StageKey);
                  }}
                >
                  <SelectTrigger
                    className="w-44"
                    data-testid="select-stage-move"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => stageMutation.mutate("WON")}
                  disabled={stageMutation.isPending}
                  data-testid="button-mark-won"
                >
                  <Trophy className="w-4 h-4 mr-1" /> Mark as Won
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setLostOpen(true)}
                  data-testid="button-mark-lost"
                >
                  Mark as Lost
                </Button>
              </div>
            )}
          </div>

          {/* Stage stepper */}
          <div
            className="mt-4 flex items-center gap-1 overflow-x-auto pb-1"
            data-testid="stage-stepper"
          >
            {STAGES.filter((s) => s.key !== "LOST").map((s, i) => {
              const isPast = STAGES.findIndex((x) => x.key === opp.stage) >= i;
              const isCurrent = s.key === opp.stage;
              return (
                <div
                  key={s.key}
                  className="flex items-center gap-1 flex-shrink-0"
                >
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                      isCurrent
                        ? s.color
                        : isPast
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                    data-testid={`stepper-${s.key}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${isPast ? "bg-current" : "bg-current opacity-30"}`}
                    />
                    {s.label}
                  </div>
                  {i < STAGES.length - 2 && (
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="container mx-auto max-w-full px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-4">
            {opp.aiWinProbability != null && (
              <Card data-testid="card-ai-prob">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Brain className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">
                        AI Win Probability
                      </span>
                    </div>
                    <span
                      className={`text-2xl font-bold ${
                        opp.aiWinProbability >= 60
                          ? "text-green-600"
                          : opp.aiWinProbability >= 30
                            ? "text-yellow-600"
                            : "text-red-600"
                      }`}
                      data-testid="text-ai-probability"
                    >
                      {opp.aiWinProbability}%
                    </span>
                  </div>
                  {opp.aiWinProbabilityRationale && (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="text-ai-rationale"
                    >
                      {opp.aiWinProbabilityRationale}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <Tabs defaultValue="timeline" className="w-full">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="timeline" data-testid="tab-timeline">
                  <MessageSquare className="w-4 h-4 mr-1" /> Timeline
                </TabsTrigger>
                <TabsTrigger value="emails" data-testid="tab-emails">
                  <MessageSquare className="w-4 h-4 mr-1" /> Emails
                </TabsTrigger>
                <TabsTrigger value="quotes" data-testid="tab-quotes">
                  <FileSignature className="w-4 h-4 mr-1" /> Quotes{" "}
                  <Badge
                    variant="secondary"
                    className="ml-1.5 text-[10px] px-1.5"
                  >
                    {oppQuotes.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="tasks" data-testid="tab-tasks">
                  <CheckSquare className="w-4 h-4 mr-1" /> Tasks{" "}
                  <Badge
                    variant="secondary"
                    className="ml-1.5 text-[10px] px-1.5"
                  >
                    {openTasks.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="notes" data-testid="tab-notes">
                  <FileText className="w-4 h-4 mr-1" /> Notes
                </TabsTrigger>
              </TabsList>

              <TabsContent value="emails" className="mt-4">
                <OpportunityEmailsPanel opportunityId={id} />
              </TabsContent>

              <TabsContent value="timeline" className="mt-4 space-y-3">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCallOpen(true)}
                    data-testid="button-log-call"
                  >
                    <Phone className="w-4 h-4 mr-1" /> Log Call
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActivityOpen(true)}
                    data-testid="button-log-activity"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Log Activity
                  </Button>
                </div>
                <CrmActivityTimeline
                  opportunityId={id}
                  urlSync
                  stickyKey={`deal:${user?.id ?? "anon"}`}
                />
              </TabsContent>

              <TabsContent value="quotes" className="mt-4">
                <Card>
                  <CardContent className="p-4">
                    {oppQuotes.length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        <FileSignature className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p>No quotes for this deal yet.</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          asChild
                          data-testid="button-go-quotes"
                        >
                          <Link href="/crm">Create from Quotes tab</Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="divide-y">
                        {oppQuotes.map((q: any) => (
                          <div
                            key={q.id}
                            className="py-3 flex items-center justify-between gap-3"
                            data-testid={`row-quote-${q.id}`}
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {q.title}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {q.quoteNumber}
                              </p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <Badge variant="outline" className="text-xs">
                                {q.status}
                              </Badge>
                              <span className="font-mono text-sm">
                                {formatCurrency(q.total ?? q.totalAmount)}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                asChild
                                data-testid={`button-quote-pdf-${q.id}`}
                              >
                                <a
                                  href={`/api/crm/quotes/${q.id}/pdf`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  PDF
                                </a>
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="tasks" className="mt-4">
                <Card>
                  <CardContent className="p-4">
                    {tasks.length === 0 ? (
                      <div className="text-center py-8 text-sm text-muted-foreground">
                        <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p>No tasks for this deal yet.</p>
                      </div>
                    ) : (
                      <div className="divide-y">
                        {tasks.map((t: any) => (
                          <div
                            key={t.id}
                            className="py-3 flex items-start justify-between gap-3"
                            data-testid={`row-task-${t.id}`}
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <CheckSquare
                                className={`w-4 h-4 mt-0.5 shrink-0 ${t.status === "DONE" ? "text-green-600" : "text-muted-foreground"}`}
                              />
                              <div className="min-w-0">
                                <p
                                  className={`text-sm ${t.status === "DONE" ? "line-through text-muted-foreground" : ""}`}
                                >
                                  {t.title}
                                </p>
                                {t.dueDate && (
                                  <p className="text-xs text-muted-foreground">
                                    Due {format(new Date(t.dueDate), "MMM d")}
                                  </p>
                                )}
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className="text-xs shrink-0"
                            >
                              {t.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <Card>
                  <CardContent className="p-4">
                    {opp.notes ? (
                      <p
                        className="text-sm whitespace-pre-wrap"
                        data-testid="text-notes"
                      >
                        {opp.notes}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No notes yet.
                      </p>
                    )}
                    {opp.lostReason && (
                      <div
                        className="mt-4 pt-4 border-t"
                        data-testid="section-lost-reason"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400 mb-1">
                          Lost — {opp.lostCategory ?? "Unknown"}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">
                          {opp.lostReason}
                        </p>
                      </div>
                    )}
                    {opp.customFields && (
                      <div className="mt-4 pt-4 border-t">
                        <CrmCustomFieldsDisplay
                          entityType="OPPORTUNITY"
                          values={opp.customFields}
                          testIdPrefix="opp-"
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card data-testid="card-deal-meta">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Deal Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <SidebarRow
                  icon={DollarSign}
                  label="Value"
                  value={formatCurrency(opp.dealValue)}
                  accent
                />
                <SidebarRow
                  icon={TrendingUp}
                  label="Probability"
                  value={`${opp.probability ?? stage.probability}%`}
                />
                <SidebarRow
                  icon={Calendar}
                  label="Expected Close"
                  value={
                    opp.expectedCloseDate
                      ? format(new Date(opp.expectedCloseDate), "MMM d, yyyy")
                      : "—"
                  }
                />
                <SidebarRow
                  icon={FolderOpen}
                  label="Source"
                  value={opp.source ?? "—"}
                />
                <SidebarRow
                  icon={Target}
                  label="Project Type"
                  value={opp.projectType ?? "—"}
                />
                <SidebarRow
                  icon={MapPin}
                  label="Location"
                  value={opp.projectLocation ?? "—"}
                />
                {opp.wonAt && (
                  <SidebarRow
                    icon={Trophy}
                    label="Won At"
                    value={format(new Date(opp.wonAt), "MMM d, yyyy")}
                  />
                )}
                {opp.lostAt && (
                  <SidebarRow
                    icon={AlertCircle}
                    label="Lost At"
                    value={format(new Date(opp.lostAt), "MMM d, yyyy")}
                  />
                )}
                <div className="pt-2 mt-2 border-t text-xs text-muted-foreground">
                  Created {formatDistanceToNowStrict(new Date(opp.createdAt))}{" "}
                  ago
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-deal-people">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">People</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Owner
                  </p>
                  {opp.assignedFirstName ? (
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <ColoredAvatarFallback
                          className="text-xs"
                          name={`${opp.assignedFirstName ?? ""} ${opp.assignedLastName ?? ""}`}
                        />
                      </Avatar>
                      <div className="text-sm">
                        <p className="font-medium" data-testid="text-owner">
                          {opp.assignedFirstName} {opp.assignedLastName}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Unassigned</p>
                  )}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Organization
                  </p>
                  {opp.crmOrgName && opp.crmOrganisationId ? (
                    <Link
                      href={`/crm-organisations/${opp.crmOrganisationId}`}
                      className="text-sm flex items-center gap-1.5 text-primary hover:underline"
                      data-testid="link-org"
                    >
                      <Building2 className="w-4 h-4" /> {opp.crmOrgName}
                    </Link>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Primary Contact
                  </p>
                  {opp.contactFirstName || opp.contactLastName ? (
                    <div className="space-y-1 text-sm">
                      <div
                        className="flex items-center gap-1.5"
                        data-testid="text-contact"
                      >
                        <User className="w-4 h-4 text-muted-foreground" />
                        {opp.contactFirstName} {opp.contactLastName}
                      </div>
                      {opp.contactEmail && (
                        <a
                          href={`mailto:${opp.contactEmail}`}
                          className="flex items-center gap-1.5 text-primary hover:underline text-xs"
                          data-testid="link-contact-email"
                        >
                          <Mail className="w-3.5 h-3.5" /> {opp.contactEmail}
                        </a>
                      )}
                      {opp.contactPhone && (
                        <a
                          href={`tel:${opp.contactPhone}`}
                          className="flex items-center gap-1.5 text-primary hover:underline text-xs"
                          data-testid="link-contact-phone"
                        >
                          <Phone className="w-3.5 h-3.5" /> {opp.contactPhone}
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-quick-actions">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setActivityOpen(true)}
                  data-testid="button-quick-activity"
                >
                  <MessageSquare className="w-4 h-4 mr-2" /> Log Activity
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  asChild
                  data-testid="button-quick-quote"
                >
                  <Link href="/crm">
                    <FileSignature className="w-4 h-4 mr-2" /> Create Quote
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  asChild
                  data-testid="button-quick-task"
                >
                  <Link href="/crm">
                    <CheckSquare className="w-4 h-4 mr-2" /> Add Task
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Lost Capture Dialog */}
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent data-testid="dialog-mark-lost">
          <DialogHeader>
            <DialogTitle>Mark as Lost</DialogTitle>
            <DialogDescription>
              Record why this deal was lost so analytics can spot patterns.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Lost Category *</Label>
              <Select
                value={lostForm.lostCategory}
                onValueChange={(v) =>
                  setLostForm((f) => ({ ...f, lostCategory: v }))
                }
              >
                <SelectTrigger data-testid="select-lost-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "PRICE",
                    "TIMING",
                    "COMPETITOR",
                    "SCOPE",
                    "RELATIONSHIP",
                    "NO_DECISION",
                    "OTHER",
                  ].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason / Notes</Label>
              <Textarea
                value={lostForm.lostReason}
                onChange={(e) =>
                  setLostForm((f) => ({ ...f, lostReason: e.target.value }))
                }
                rows={3}
                placeholder="What happened? (competitor, price gap, etc.)"
                data-testid="textarea-lost-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLostOpen(false)}
              data-testid="button-lost-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => markLost.mutate()}
              disabled={markLost.isPending}
              data-testid="button-lost-confirm"
            >
              {markLost.isPending ? "Saving..." : "Mark as Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Activity Dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent data-testid="dialog-log-activity">
          <DialogHeader>
            <DialogTitle>Log Activity</DialogTitle>
            <DialogDescription>
              Record a call, email, meeting, or note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Activity Type</Label>
              <Select
                value={activityForm.activityType}
                onValueChange={(v) =>
                  setActivityForm((f) => ({ ...f, activityType: v }))
                }
              >
                <SelectTrigger data-testid="select-activity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ["CALL", "Call"],
                    ["EMAIL", "Email"],
                    ["MEETING", "Meeting"],
                    ["NOTE", "Note"],
                    ["FOLLOW_UP", "Follow-up"],
                    ["SITE_VISIT", "Site Visit"],
                  ].map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description *</Label>
              <Textarea
                value={activityForm.description}
                onChange={(e) =>
                  setActivityForm((f) => ({
                    ...f,
                    description: e.target.value,
                  }))
                }
                rows={3}
                placeholder="What happened or was discussed?"
                data-testid="textarea-activity-description"
              />
            </div>
            <div>
              <Label>Scheduled (optional)</Label>
              <Input
                type="datetime-local"
                value={activityForm.scheduledAt}
                onChange={(e) =>
                  setActivityForm((f) => ({
                    ...f,
                    scheduledAt: e.target.value,
                  }))
                }
                data-testid="input-activity-scheduled"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActivityOpen(false)}
              data-testid="button-activity-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => logActivity.mutate()}
              disabled={!activityForm.description || logActivity.isPending}
              data-testid="button-activity-save"
            >
              {logActivity.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LogCallDialog
        open={callOpen}
        onOpenChange={setCallOpen}
        opportunityId={id}
        contactId={opp?.contactId ?? undefined}
        crmOrganisationId={opp?.crmOrganisationId ?? undefined}
        invalidateKeys={[
          [
            "/api/crm/activity",
            {
              opportunityId: id,
              contactId: undefined,
              crmOrganisationId: undefined,
            },
          ],
          ["/api/crm/calls"],
          ["/api/crm/opportunities", id, "activities"],
        ]}
      />
    </div>
  );
}

function SidebarRow({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </span>
      <span
        className={`text-sm ${accent ? "font-semibold text-primary" : ""}`}
        data-testid={`sidebar-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {value}
      </span>
    </div>
  );
}

interface OppEmailRow {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromAddress: string;
  toAddresses: string | null;
  subject: string;
  snippet: string | null;
  sentAt: string;
  providerDeepLink?: string | null;
  provider?: string | null;
}

function OpportunityEmailsPanel({ opportunityId }: { opportunityId: string }) {
  const { data, isLoading, error } = useQuery<OppEmailRow[]>({
    queryKey: ["/api/crm/opportunities", opportunityId, "emails"],
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/opportunities/${opportunityId}/emails`,
        { credentials: "include" },
      );
      if (res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to load emails");
      return res.json();
    },
  });
  if (isLoading)
    return <p className="text-xs text-muted-foreground">Loading emails…</p>;
  if (error)
    return (
      <p className="text-xs text-muted-foreground">Unable to load emails.</p>
    );
  if (!data || data.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="text-no-opportunity-emails"
      >
        No emails logged for this opportunity yet. Configure CRM Email Logging
        in Settings to enable automatic capture.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {data.map((m) => (
        <div
          key={m.id}
          className="border rounded p-3"
          data-testid={`row-opportunity-email-${m.id}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Badge
                variant={m.direction === "INBOUND" ? "secondary" : "outline"}
                data-testid={`badge-direction-${m.id}`}
              >
                {m.direction === "INBOUND" ? "← In" : "Out →"}
              </Badge>
              <span className="font-medium truncate">
                {m.subject || "(no subject)"}
              </span>
            </div>
            {m.providerDeepLink && (
              <a
                href={m.providerDeepLink}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
                data-testid={`link-source-${m.id}`}
              >
                Open in {m.provider === "OUTLOOK" ? "Outlook" : "Gmail"}
              </a>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 truncate">
            {m.direction === "INBOUND" ? m.fromAddress : m.toAddresses}
          </div>
          {m.snippet && (
            <div className="text-sm text-muted-foreground mt-2 line-clamp-2">
              {m.snippet}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-2">
            {new Date(m.sentAt).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

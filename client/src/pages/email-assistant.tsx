import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  Inbox,
  Tag,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Loader2,
  LayoutList,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AlertCircle } from "lucide-react";
import { EmailThreadList } from "@/components/email/EmailThreadList";
import { EmailThreadDetail, TaskCard } from "@/components/email/EmailThreadDetail";
import { EmailAccountsDialog } from "@/components/email/EmailAccountsDialog";
import { ClassificationBadge, PriorityBadge } from "@/components/email/shared";
import type { EmailThread, EmailTask, EmailAccount } from "@/components/email/shared";
import type { EmailSummaryDigest } from "@/hooks/useEmailMutations";
import { useSyncEmails, useDailySummary, useWeeklySummary } from "@/hooks/useEmailMutations";

export default function EmailAssistantPage() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "overview">("list");
  const [filterClassification, setFilterClassification] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("OPEN");
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("threadId");
  });
  const [showSummarySheet, setShowSummarySheet] = useState(false);
  const [summaryType, setSummaryType] = useState<"daily" | "weekly">("daily");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const success = params.get("success");
    if (error) {
      const errorMessages: Record<string, string> = {
        oauth_init_failed: "Failed to start email connection. Please try again or contact your administrator.",
        oauth_denied: "Email account connection was denied. Please try again and grant the required permissions.",
        missing_params: "Email connection failed due to missing parameters. Please try again.",
        invalid_state: "Email connection failed due to an invalid session. Please try again.",
        state_expired: "Email connection session expired. Please try again.",
        token_exchange_failed: "Failed to complete email connection. Please try again or contact your administrator.",
        user_info_failed: "Failed to retrieve email account information. Please try again.",
        callback_failed: "Email connection failed unexpectedly. Please try again or contact your administrator.",
      };
      toast({
        title: "Email Connection Error",
        description: errorMessages[error] || "Email connection failed. Please try again.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/email-assistant");
    } else if (success) {
      const successMessages: Record<string, string> = {
        gmail_connected: "Gmail account connected successfully.",
        outlook_connected: "Outlook account connected successfully.",
      };
      toast({
        title: "Email Connected",
        description: successMessages[success] || "Email account connected successfully.",
      });
      window.history.replaceState({}, "", "/email-assistant");
    }
  }, [toast]);

  const { data: threads, isLoading: threadsLoading, refetch: refetchThreads } = useQuery<EmailThread[]>({
    queryKey: ["/api/email/threads", { status: filterStatus, classification: filterClassification !== "all" ? filterClassification : undefined }],
  });

  const { data: accounts, isLoading: accountsLoading } = useQuery<EmailAccount[]>({
    queryKey: ["/api/email/accounts"],
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery<EmailTask[]>({
    queryKey: ["/api/email/tasks", { status: "PENDING" }],
  });

  const syncMutation = useSyncEmails(refetchThreads);
  const dailySummaryMutation = useDailySummary();
  const weeklySummaryMutation = useWeeklySummary();

  useEffect(() => {
    if (pendingThreadId && threads && threads.length > 0) {
      const match = threads.find((t) => t.id === pendingThreadId);
      if (match) {
        setSelectedThread(match);
        setPendingThreadId(null);
      }
    }
  }, [pendingThreadId, threads]);

  const currentSummary = summaryType === "daily" ? dailySummaryMutation.data : weeklySummaryMutation.data;
  const isSummaryLoading = dailySummaryMutation.isPending || weeklySummaryMutation.isPending;

  const handleDailySummary = () => {
    setSummaryType("daily");
    dailySummaryMutation.mutate(undefined, { onSuccess: () => setShowSummarySheet(true) });
  };

  const handleWeeklySummary = () => {
    setSummaryType("weekly");
    weeklySummaryMutation.mutate(undefined, { onSuccess: () => setShowSummarySheet(true) });
  };

  return (
    <div className="flex flex-col h-full" data-testid="page-email-assistant">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Mail className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-xl font-semibold">Email Assistant</h1>
              <p className="text-sm text-muted-foreground">
                AI-powered email management for construction projects
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="button-sync-emails"
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sync
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDailySummary}
              disabled={isSummaryLoading}
              data-testid="button-daily-summary"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Daily Summary
            </Button>
            <EmailAccountsDialog accounts={accounts} accountsLoading={accountsLoading} />
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {isMobile && selectedThread ? (
          <EmailThreadDetail thread={selectedThread} onClose={() => setSelectedThread(null)} />
        ) : (
          <>
            <div className={`${isMobile ? "flex-1" : "w-80"} border-r flex flex-col`}>
              {isMobile && (
                <div className="flex border-b">
                  <button
                    onClick={() => setMobileView("list")}
                    className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${mobileView === "list" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
                    data-testid="button-mobile-inbox"
                  >
                    <Inbox className="w-4 h-4 inline-block mr-1.5" />
                    Inbox
                  </button>
                  <button
                    onClick={() => setMobileView("overview")}
                    className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${mobileView === "overview" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
                    data-testid="button-mobile-overview"
                  >
                    <LayoutList className="w-4 h-4 inline-block mr-1.5" />
                    Overview
                  </button>
                </div>
              )}
              {(!isMobile || mobileView === "list") && (
                <EmailThreadList
                  threads={threads}
                  threadsLoading={threadsLoading}
                  selectedThread={selectedThread}
                  onSelectThread={setSelectedThread}
                  filterStatus={filterStatus}
                  onFilterStatusChange={setFilterStatus}
                  filterClassification={filterClassification}
                  onFilterClassificationChange={setFilterClassification}
                />
              )}
              {isMobile && mobileView === "overview" && (
                <MobileOverview
                  threads={threads}
                  accounts={accounts}
                  tasks={tasks}
                  tasksLoading={tasksLoading}
                  isSummaryLoading={isSummaryLoading}
                  dailySummaryPending={dailySummaryMutation.isPending}
                  weeklySummaryPending={weeklySummaryMutation.isPending}
                  onDailySummary={handleDailySummary}
                  onWeeklySummary={handleWeeklySummary}
                />
              )}
            </div>

            {!isMobile && (
              <div className="flex-1 flex flex-col">
                {selectedThread ? (
                  <EmailThreadDetail thread={selectedThread} onClose={() => setSelectedThread(null)} />
                ) : (
                  <DesktopOverview
                    threads={threads}
                    accounts={accounts}
                    tasks={tasks}
                    tasksLoading={tasksLoading}
                    isSummaryLoading={isSummaryLoading}
                    dailySummaryPending={dailySummaryMutation.isPending}
                    weeklySummaryPending={weeklySummaryMutation.isPending}
                    onDailySummary={handleDailySummary}
                    onWeeklySummary={handleWeeklySummary}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <SummarySheet
        open={showSummarySheet}
        onOpenChange={setShowSummarySheet}
        summaryType={summaryType}
        currentSummary={currentSummary}
      />
    </div>
  );
}

interface OverviewProps {
  threads: EmailThread[] | undefined;
  accounts: EmailAccount[] | undefined;
  tasks: EmailTask[] | undefined;
  tasksLoading: boolean;
  isSummaryLoading: boolean;
  dailySummaryPending: boolean;
  weeklySummaryPending: boolean;
  onDailySummary: () => void;
  onWeeklySummary: () => void;
}

function MobileOverview({ threads, accounts, tasks, tasksLoading, isSummaryLoading, dailySummaryPending, weeklySummaryPending, onDailySummary, onWeeklySummary }: OverviewProps) {
  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-4 self-start">
          <TabsTrigger value="overview" data-testid="tab-mobile-overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-mobile-tasks">Tasks</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex-1 p-4 overflow-auto">
          <div className="grid gap-4 grid-cols-1">
            <InboxSummaryCard threads={threads} accounts={accounts} />
            <PendingTasksCard tasks={tasks} tasksLoading={tasksLoading} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  AI Insights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SummaryButtons
                  isSummaryLoading={isSummaryLoading}
                  dailySummaryPending={dailySummaryPending}
                  weeklySummaryPending={weeklySummaryPending}
                  onDailySummary={onDailySummary}
                  onWeeklySummary={onWeeklySummary}
                  dailyTestId="button-mobile-daily-summary"
                  weeklyTestId="button-mobile-weekly-summary"
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="tasks" className="flex-1 p-4 overflow-auto">
          <TasksSection tasks={tasks} tasksLoading={tasksLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DesktopOverview({ threads, accounts, tasks, tasksLoading, isSummaryLoading, dailySummaryPending, weeklySummaryPending, onDailySummary, onWeeklySummary }: OverviewProps) {
  return (
    <div className="flex-1 flex flex-col">
      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <TabsList className="mx-6 mt-4 self-start">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 p-6 overflow-auto">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <InboxSummaryCard threads={threads} accounts={accounts} />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  By Classification
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {threads && Object.entries(
                    threads.reduce((acc, t) => {
                      const cls = t.primaryClassification || "OTHER";
                      acc[cls] = (acc[cls] || 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)
                  ).slice(0, 5).map(([cls, count]) => (
                    <div key={cls} className="flex items-center justify-between">
                      <ClassificationBadge classification={cls} />
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <PendingTasksCard tasks={tasks} tasksLoading={tasksLoading} />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Insights
              </CardTitle>
              <CardDescription>
                Generate AI-powered summaries of your email activity
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SummaryButtons
                isSummaryLoading={isSummaryLoading}
                dailySummaryPending={dailySummaryPending}
                weeklySummaryPending={weeklySummaryPending}
                onDailySummary={onDailySummary}
                onWeeklySummary={onWeeklySummary}
                dailyTestId="button-generate-daily-summary"
                weeklyTestId="button-generate-weekly-summary"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="flex-1 p-6 overflow-auto">
          <TasksSection tasks={tasks} tasksLoading={tasksLoading} showDescription />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InboxSummaryCard({ threads, accounts }: { threads: EmailThread[] | undefined; accounts: EmailAccount[] | undefined }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Inbox className="w-4 h-4" />
          Inbox Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Total Threads</span>
            <span className="font-medium">{threads?.length || 0}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Unread</span>
            <span className="font-medium text-primary">
              {threads?.reduce((sum, t) => sum + t.unreadCount, 0) || 0}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Linked Accounts</span>
            <span className="font-medium">{accounts?.length || 0}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingTasksCard({ tasks, tasksLoading }: { tasks: EmailTask[] | undefined; tasksLoading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Pending Tasks
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tasksLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : tasks && tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.slice(0, 3).map((task) => (
              <div key={task.id} className="flex items-center justify-between p-2 rounded border">
                <span className="text-sm line-clamp-1">{task.title}</span>
                <PriorityBadge priority={task.priority} />
              </div>
            ))}
            {tasks.length > 3 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                +{tasks.length - 3} more tasks
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No pending tasks
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryButtons({ isSummaryLoading, dailySummaryPending, weeklySummaryPending, onDailySummary, onWeeklySummary, dailyTestId, weeklyTestId }: {
  isSummaryLoading: boolean;
  dailySummaryPending: boolean;
  weeklySummaryPending: boolean;
  onDailySummary: () => void;
  onWeeklySummary: () => void;
  dailyTestId: string;
  weeklyTestId: string;
}) {
  return (
    <div className="flex gap-4">
      <Button
        variant="outline"
        onClick={onDailySummary}
        disabled={isSummaryLoading}
        className="flex-1"
        data-testid={dailyTestId}
      >
        {dailySummaryPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Calendar className="w-4 h-4 mr-2" />
        )}
        Daily Summary
      </Button>
      <Button
        variant="outline"
        onClick={onWeeklySummary}
        disabled={isSummaryLoading}
        className="flex-1"
        data-testid={weeklyTestId}
      >
        {weeklySummaryPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <LayoutList className="w-4 h-4 mr-2" />
        )}
        Weekly Summary
      </Button>
    </div>
  );
}

function TasksSection({ tasks, tasksLoading, showDescription }: { tasks: EmailTask[] | undefined; tasksLoading: boolean; showDescription?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" />
          Email-Generated Tasks
        </CardTitle>
        {showDescription && (
          <CardDescription>
            Tasks automatically created from email analysis
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {tasksLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : tasks && tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No tasks from emails yet</p>
            <p className="text-sm mt-1">
              AI will create tasks when it detects action items in your emails
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummarySheet({ open, onOpenChange, summaryType, currentSummary }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaryType: "daily" | "weekly";
  currentSummary: EmailSummaryDigest | undefined;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            {summaryType === "daily" ? "Daily" : "Weekly"} Email Summary
          </SheetTitle>
          <SheetDescription>
            {currentSummary?.periodDescription || "AI-generated insights from your emails"}
          </SheetDescription>
        </SheetHeader>
        {currentSummary && (
          <div className="mt-6 space-y-6">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm">{currentSummary.summaryNarrative}</p>
            </div>

            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Highlights
              </h4>
              <div className="space-y-2">
                {currentSummary.highlights.map((h, i) => (
                  <div key={i} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{h.title}</span>
                      <PriorityBadge priority={h.priority} />
                    </div>
                    <p className="text-sm text-muted-foreground">{h.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {currentSummary.actionNeeded.length > 0 && (
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Action Needed
                </h4>
                <div className="space-y-2">
                  {currentSummary.actionNeeded.map((a, i) => (
                    <div key={i} className="p-3 border rounded-lg">
                      <span className="font-medium text-sm">{a.title}</span>
                      <p className="text-sm text-muted-foreground">{a.description}</p>
                      {a.dueDate && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Due: {a.dueDate}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="font-medium mb-3">Classification Breakdown</h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(currentSummary.byClassification).map(([cls, count]) => (
                  <div key={cls} className="flex items-center justify-between p-2 border rounded">
                    <ClassificationBadge classification={cls} />
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

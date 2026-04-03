import { Suspense, lazy, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { NavigationConfig } from "@/lib/rbac";
import type { FeaturePerms } from "@/lib/rbac";

const HiringDashboardContent = lazy(() => import("@/pages/hiring/dashboard"));
const HiringJobsContent = lazy(() => import("@/pages/hiring/jobs"));
const HiringCandidatesContent = lazy(() => import("@/pages/hiring/candidates"));
const HiringPipelineContent = lazy(() => import("@/pages/hiring/pipeline"));
const HiringInterviewsContent = lazy(() => import("@/pages/hiring/interviews"));
const HiringTasksContent = lazy(() => import("@/pages/hiring/tasks"));
const HiringAnalyticsContent = lazy(() => import("@/pages/hiring/analytics"));
const HiringSettingsContent = lazy(() => import("@/pages/hiring/settings"));

interface TabDef {
  key: string;
  label: string;
  testId: string;
  content: React.LazyExoticComponent<React.ComponentType>;
}

const ALL_TABS: TabDef[] = [
  { key: "dashboard", label: "Dashboard", testId: "tab-hiring-dashboard", content: HiringDashboardContent },
  { key: "jobs", label: "Jobs", testId: "tab-hiring-jobs", content: HiringJobsContent },
  { key: "candidates", label: "Candidates", testId: "tab-hiring-candidates", content: HiringCandidatesContent },
  { key: "pipeline", label: "Pipeline", testId: "tab-hiring-pipeline", content: HiringPipelineContent },
  { key: "interviews", label: "Interviews", testId: "tab-hiring-interviews", content: HiringInterviewsContent },
  { key: "tasks", label: "Tasks", testId: "tab-hiring-tasks", content: HiringTasksContent },
  { key: "analytics", label: "Analytics", testId: "tab-hiring-analytics", content: HiringAnalyticsContent },
  { key: "settings", label: "Settings", testId: "tab-hiring-settings", content: HiringSettingsContent },
];

const TAB_KEY_TO_HREF: Record<string, string> = {
  dashboard: "/hiring",
  jobs: "/hiring/jobs",
  candidates: "/hiring/candidates",
  pipeline: "/hiring/pipeline",
  interviews: "/hiring/interviews",
  tasks: "/hiring/tasks",
  analytics: "/hiring/analytics",
  settings: "/hiring/settings",
};

function TabFallback() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function HiringPage() {
  const { user } = useAuth();
  const { permissions: featurePerms } = useDashboardCustomization();
  const searchString = useSearch();
  const [, navigate] = useLocation();

  const role = user?.effectiveRole || user?.role;
  const perms: FeaturePerms = featurePerms;

  const visibleTabs = useMemo(() => {
    return ALL_TABS.filter((tab) => {
      const menuItem = NavigationConfig.hiringMenu.find(
        (m) => m.href === TAB_KEY_TO_HREF[tab.key]
      );
      if (!menuItem) return tab.key === "dashboard";
      return menuItem.visible(role, perms);
    });
  }, [role, perms]);

  const params = new URLSearchParams(searchString);
  const tabParam = params.get("tab") ?? "dashboard";
  const activeTab = visibleTabs.find((t) => t.key === tabParam) ? tabParam : "dashboard";

  function handleTabChange(value: string) {
    navigate(`/hiring?tab=${value}`, { replace: true });
  }

  if (visibleTabs.length === 0) {
    return (
      <div className="p-6">
        <div className="p-8 text-center text-muted-foreground">
          You do not have permission to access the Hiring module.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} data-testid="hiring-tabs">
        <TabsList className="flex-wrap h-auto gap-1" data-testid="hiring-tab-list">
          {visibleTabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} data-testid={tab.testId}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleTabs.map((tab) => {
          const Content = tab.content;
          return (
            <TabsContent key={tab.key} value={tab.key}>
              <Suspense fallback={<TabFallback />}>
                <Content />
              </Suspense>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

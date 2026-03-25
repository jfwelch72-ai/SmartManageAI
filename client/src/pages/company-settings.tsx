import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Wrench, Image, Shield, FileText, Clock, Users, Code, Link2, Globe, DollarSign, BarChart3, Loader2, Lock, Settings, Bot, Layers } from "lucide-react";
import { CompanyTradeConfigTab } from "@/components/settings/CompanyTradeConfigTab";
import { CompanyProfileTab } from "@/components/settings/CompanyProfileTab";
import { CompanyNotificationsTab } from "@/components/settings/CompanyNotificationsTab";
import { CompanyUserInviteTab } from "@/components/settings/CompanyUserInviteTab";
import type { LucideIcon } from "lucide-react";

const CostCodesPage = lazy(() => import("@/pages/cost-codes"));
const UsersPage = lazy(() => import("@/pages/users"));
const IntegrationsPage = lazy(() => import("@/pages/integrations"));
const WebsiteBuilderPage = lazy(() => import("@/pages/website-builder"));
const OverheadCostsPage = lazy(() => import("@/pages/overhead-costs"));
const ProductionRatesPage = lazy(() => import("@/pages/production-rates"));
const DailyReportLocksPage = lazy(() => import("@/pages/daily-report-locks"));
const ScopeSettingsPage = lazy(() => import("@/pages/scope-settings"));
const AISettingsPage = lazy(() => import("@/pages/ai-settings"));
const AIGovernancePage = lazy(() => import("@/pages/ai-governance"));

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

interface SubTab {
  value: string;
  label: string;
  icon: LucideIcon;
}

interface TabGroup {
  parent: string;
  label: string;
  icon: LucideIcon;
  subTabs: SubTab[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    parent: "trade",
    label: "Trade",
    icon: Wrench,
    subTabs: [],
  },
  {
    parent: "company-profile",
    label: "Company Profile",
    icon: Building2,
    subTabs: [
      { value: "branding", label: "Branding", icon: Image },
      { value: "insurance", label: "Insurance", icon: Shield },
      { value: "compliance", label: "Compliance", icon: FileText },
    ],
  },
  {
    parent: "financial",
    label: "Financial",
    icon: DollarSign,
    subTabs: [
      { value: "payroll", label: "Payroll", icon: Clock },
      { value: "cost-codes", label: "Cost Codes", icon: Code },
      { value: "overhead-costs", label: "Overhead Costs", icon: DollarSign },
      { value: "production-rates", label: "Production Rates", icon: BarChart3 },
    ],
  },
  {
    parent: "people",
    label: "People",
    icon: Users,
    subTabs: [
      { value: "hustler", label: "Hustler Oversight", icon: Users },
      { value: "users", label: "Users & Roles", icon: Users },
    ],
  },
  {
    parent: "operations",
    label: "Operations",
    icon: Settings,
    subTabs: [
      { value: "report-locks", label: "Report Locks", icon: Lock },
      { value: "scope-settings", label: "Scope Settings", icon: Layers },
    ],
  },
  {
    parent: "ai-admin",
    label: "AI Administration",
    icon: Bot,
    subTabs: [
      { value: "ai-settings", label: "AI Settings", icon: Settings },
      { value: "ai-governance", label: "AI Governance", icon: Bot },
    ],
  },
  {
    parent: "integrations",
    label: "Integrations",
    icon: Link2,
    subTabs: [],
  },
  {
    parent: "website",
    label: "Website",
    icon: Globe,
    subTabs: [],
  },
];

const VALID_TABS = [
  "trade", "branding", "insurance", "compliance", "payroll", "hustler",
  "cost-codes", "users", "integrations", "website", "overhead-costs", "production-rates",
  "report-locks", "scope-settings", "ai-settings", "ai-governance",
];

function getParentForTab(tab: string): string {
  for (const group of TAB_GROUPS) {
    if (group.subTabs.length === 0 && group.parent === tab) return group.parent;
    for (const sub of group.subTabs) {
      if (sub.value === tab) return group.parent;
    }
  }
  return TAB_GROUPS[0].parent;
}

function getEffectiveTab(group: TabGroup): string {
  if (group.subTabs.length === 0) return group.parent;
  return group.subTabs[0].value;
}

export default function CompanySettings() {
  const { user } = useAuth();
  const { permissions: featurePerms } = useDashboardCustomization();
  const isMobile = useIsMobile();

  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && VALID_TABS.includes(tab)) return tab;
    return VALID_TABS[0];
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentTab = params.get("tab");
    if (activeTab === VALID_TABS[0] && !currentTab) return;
    if (currentTab !== activeTab) {
      const url = new URL(window.location.href);
      if (activeTab === VALID_TABS[0]) {
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("tab", activeTab);
      }
      window.history.replaceState({}, "", url.toString());
    }
  }, [activeTab]);

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to view company settings</p>
      </div>
    );
  }

  const isOrgAdmin = user.role === "SUPER_ADMIN" || user.role === "ADMIN";
  const canViewCoreTabs = isOrgAdmin;
  const canViewCostCodes = isOrgAdmin;
  const canViewUsers = isOrgAdmin;
  const canViewIntegrations = isOrgAdmin;
  const canViewWebsite = isOrgAdmin || featurePerms?.canManageWebsite === true;
  const canViewOverhead = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "OFFICE_MANAGER";
  const canViewProductionRates = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "ESTIMATOR" || user.role === "SUPERINTENDENT" || user.role === "OFFICE_MANAGER" || featurePerms?.canAccessReports === true;
  const canViewReportLocks = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "SUPERINTENDENT";
  const canViewScopeSettings = isOrgAdmin || user.role === "MANAGER" || user.role === "ESTIMATOR";
  const canViewAISettings = isOrgAdmin;
  const canViewAIGovernance = isOrgAdmin;

  const tabPermissions: Record<string, boolean> = {
    trade: canViewCoreTabs, branding: canViewCoreTabs, insurance: canViewCoreTabs,
    compliance: canViewCoreTabs, payroll: canViewCoreTabs, hustler: canViewCoreTabs,
    "cost-codes": canViewCostCodes, users: canViewUsers, integrations: canViewIntegrations,
    website: canViewWebsite, "overhead-costs": canViewOverhead, "production-rates": canViewProductionRates,
    "report-locks": canViewReportLocks, "scope-settings": canViewScopeSettings,
    "ai-settings": canViewAISettings, "ai-governance": canViewAIGovernance,
  };

  const allowedTabs = VALID_TABS.filter(t => tabPermissions[t]);

  const visibleGroups = useMemo(() => {
    return TAB_GROUPS.map(group => {
      if (group.subTabs.length === 0) {
        return tabPermissions[group.parent] ? group : null;
      }
      const visibleSubs = group.subTabs.filter(sub => tabPermissions[sub.value]);
      if (visibleSubs.length === 0) return null;
      return { ...group, subTabs: visibleSubs };
    }).filter((g): g is TabGroup => g !== null);
  }, [canViewCoreTabs, canViewCostCodes, canViewUsers, canViewIntegrations, canViewWebsite, canViewOverhead, canViewProductionRates, canViewReportLocks, canViewScopeSettings, canViewAISettings, canViewAIGovernance]);

  const activeParent = getParentForTab(activeTab);

  const activeGroup = visibleGroups.find(g => g.parent === activeParent);

  useEffect(() => {
    if (visibleGroups.length > 0 && !tabPermissions[activeTab]) {
      const firstGroup = visibleGroups[0];
      setActiveTab(getEffectiveTab(firstGroup));
    }
  }, [activeTab, visibleGroups]);

  if (allowedTabs.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have permission to access company settings</p>
      </div>
    );
  }

  const handleParentTabClick = (parentKey: string) => {
    const group = visibleGroups.find(g => g.parent === parentKey);
    if (!group) return;
    if (group.subTabs.length === 0) {
      setActiveTab(group.parent);
    } else {
      if (activeParent === parentKey) return;
      const firstAllowed = group.subTabs.find(s => tabPermissions[s.value]);
      if (firstAllowed) setActiveTab(firstAllowed.value);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Building2 className="h-8 w-8 text-primary" />
            Company Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your organization's configuration, branding, and integrations
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {isMobile ? (
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="mb-4" data-testid="select-company-settings-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibleGroups.map(group => {
                if (group.subTabs.length === 0) {
                  return (
                    <SelectItem key={group.parent} value={group.parent} data-testid={`select-item-${group.parent}`}>
                      {group.label}
                    </SelectItem>
                  );
                }
                return (
                  <SelectGroup key={group.parent}>
                    <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" data-testid={`select-group-${group.parent}`}>
                      {group.label}
                    </SelectLabel>
                    {group.subTabs.map(sub => (
                      <SelectItem key={sub.value} value={sub.value} className="pl-6" data-testid={`select-item-${sub.value}`}>
                        {sub.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1 border-b pb-2" data-testid="tabs-company-settings">
              {visibleGroups.map(group => {
                const Icon = group.icon;
                const isActive = activeParent === group.parent;
                return (
                  <button
                    key={group.parent}
                    type="button"
                    onClick={() => handleParentTabClick(group.parent)}
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    data-testid={`tab-parent-${group.parent}`}
                  >
                    <Icon className="h-4 w-4" />
                    {group.label}
                  </button>
                );
              })}
            </div>

            {activeGroup && activeGroup.subTabs.length > 0 && (
              <TabsList className="h-auto gap-1 bg-muted/50 p-1" data-testid="tabs-sub-navigation">
                {activeGroup.subTabs.map(sub => {
                  const SubIcon = sub.icon;
                  return (
                    <TabsTrigger
                      key={sub.value}
                      value={sub.value}
                      data-testid={`tab-${sub.value}`}
                    >
                      <SubIcon className="h-4 w-4 mr-2" />
                      {sub.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            )}
          </div>
        )}

        {canViewCoreTabs && (
          <TabsContent value="trade" className="mt-6">
            <CompanyTradeConfigTab />
          </TabsContent>
        )}

        {canViewCoreTabs && (
          <TabsContent value="branding" className="mt-6">
            <CompanyProfileTab activeDocTab="branding" />
          </TabsContent>
        )}

        {canViewCoreTabs && (
          <TabsContent value="insurance" className="mt-6">
            <CompanyProfileTab activeDocTab="insurance" />
          </TabsContent>
        )}

        {canViewCoreTabs && (
          <TabsContent value="compliance" className="mt-6">
            <CompanyProfileTab activeDocTab="compliance" />
          </TabsContent>
        )}

        {canViewCoreTabs && (
          <TabsContent value="payroll" className="mt-6">
            <CompanyNotificationsTab />
          </TabsContent>
        )}

        {canViewCoreTabs && (
          <TabsContent value="hustler" className="mt-6">
            <CompanyUserInviteTab />
          </TabsContent>
        )}

        {canViewCostCodes && (
          <TabsContent value="cost-codes" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <CostCodesPage embedded />
            </Suspense>
          </TabsContent>
        )}

        {canViewUsers && (
          <TabsContent value="users" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <UsersPage embedded />
            </Suspense>
          </TabsContent>
        )}

        {canViewIntegrations && (
          <TabsContent value="integrations" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <IntegrationsPage embedded />
            </Suspense>
          </TabsContent>
        )}

        {canViewWebsite && (
          <TabsContent value="website" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <WebsiteBuilderPage embedded />
            </Suspense>
          </TabsContent>
        )}

        {canViewOverhead && (
          <TabsContent value="overhead-costs" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <OverheadCostsPage embedded />
            </Suspense>
          </TabsContent>
        )}

        {canViewProductionRates && (
          <TabsContent value="production-rates" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <ProductionRatesPage embedded />
            </Suspense>
          </TabsContent>
        )}

        {canViewReportLocks && (
          <TabsContent value="report-locks" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <DailyReportLocksPage />
            </Suspense>
          </TabsContent>
        )}

        {canViewScopeSettings && (
          <TabsContent value="scope-settings" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <ScopeSettingsPage />
            </Suspense>
          </TabsContent>
        )}

        {canViewAISettings && (
          <TabsContent value="ai-settings" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <AISettingsPage />
            </Suspense>
          </TabsContent>
        )}

        {canViewAIGovernance && (
          <TabsContent value="ai-governance" className="mt-6">
            <Suspense fallback={<TabLoader />}>
              <AIGovernancePage />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

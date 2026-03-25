import { useState, useEffect, lazy, Suspense } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Wrench, Image, Shield, FileText, Clock, Users, Code, Link2, Globe, DollarSign, BarChart3, Loader2 } from "lucide-react";
import { CompanyTradeConfigTab } from "@/components/settings/CompanyTradeConfigTab";
import { CompanyProfileTab } from "@/components/settings/CompanyProfileTab";
import { CompanyNotificationsTab } from "@/components/settings/CompanyNotificationsTab";
import { CompanyUserInviteTab } from "@/components/settings/CompanyUserInviteTab";

const CostCodesPage = lazy(() => import("@/pages/cost-codes"));
const UsersPage = lazy(() => import("@/pages/users"));
const IntegrationsPage = lazy(() => import("@/pages/integrations"));
const WebsiteBuilderPage = lazy(() => import("@/pages/website-builder"));
const OverheadCostsPage = lazy(() => import("@/pages/overhead-costs"));
const ProductionRatesPage = lazy(() => import("@/pages/production-rates"));

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

const VALID_TABS = [
  "trade", "branding", "insurance", "compliance", "payroll", "hustler",
  "cost-codes", "users", "integrations", "website", "overhead-costs", "production-rates",
];

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

  const tabPermissions: Record<string, boolean> = {
    trade: canViewCoreTabs, branding: canViewCoreTabs, insurance: canViewCoreTabs,
    compliance: canViewCoreTabs, payroll: canViewCoreTabs, hustler: canViewCoreTabs,
    "cost-codes": canViewCostCodes, users: canViewUsers, integrations: canViewIntegrations,
    website: canViewWebsite, "overhead-costs": canViewOverhead, "production-rates": canViewProductionRates,
  };

  const allowedTabs = VALID_TABS.filter(t => tabPermissions[t]);

  useEffect(() => {
    if (allowedTabs.length > 0 && !tabPermissions[activeTab]) {
      setActiveTab(allowedTabs[0]);
    }
  }, [activeTab, allowedTabs.join(",")]);

  if (allowedTabs.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have permission to access company settings</p>
      </div>
    );
  }

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
              {canViewCoreTabs && <SelectItem value="trade">Trade</SelectItem>}
              {canViewCoreTabs && <SelectItem value="branding">Branding</SelectItem>}
              {canViewCoreTabs && <SelectItem value="insurance">Insurance</SelectItem>}
              {canViewCoreTabs && <SelectItem value="compliance">Compliance</SelectItem>}
              {canViewCoreTabs && <SelectItem value="payroll">Payroll</SelectItem>}
              {canViewCoreTabs && <SelectItem value="hustler">Hustler Oversight</SelectItem>}
              {canViewCostCodes && <SelectItem value="cost-codes">Cost Codes</SelectItem>}
              {canViewUsers && <SelectItem value="users">Users & Roles</SelectItem>}
              {canViewIntegrations && <SelectItem value="integrations">Integrations</SelectItem>}
              {canViewWebsite && <SelectItem value="website">Website</SelectItem>}
              {canViewOverhead && <SelectItem value="overhead-costs">Overhead Costs</SelectItem>}
              {canViewProductionRates && <SelectItem value="production-rates">Production Rates</SelectItem>}
            </SelectContent>
          </Select>
        ) : (
          <TabsList className="flex flex-wrap h-auto gap-1" data-testid="tabs-company-settings">
            {canViewCoreTabs && (
              <TabsTrigger value="trade" data-testid="tab-trade">
                <Wrench className="h-4 w-4 mr-2" /> Trade
              </TabsTrigger>
            )}
            {canViewCoreTabs && (
              <TabsTrigger value="branding" data-testid="tab-branding">
                <Image className="h-4 w-4 mr-2" /> Branding
              </TabsTrigger>
            )}
            {canViewCoreTabs && (
              <TabsTrigger value="insurance" data-testid="tab-insurance">
                <Shield className="h-4 w-4 mr-2" /> Insurance
              </TabsTrigger>
            )}
            {canViewCoreTabs && (
              <TabsTrigger value="compliance" data-testid="tab-compliance">
                <FileText className="h-4 w-4 mr-2" /> Compliance
              </TabsTrigger>
            )}
            {canViewCoreTabs && (
              <TabsTrigger value="payroll" data-testid="tab-payroll">
                <Clock className="h-4 w-4 mr-2" /> Payroll
              </TabsTrigger>
            )}
            {canViewCoreTabs && (
              <TabsTrigger value="hustler" data-testid="tab-hustler">
                <Users className="h-4 w-4 mr-2" /> Hustler Oversight
              </TabsTrigger>
            )}
            {canViewCostCodes && (
              <TabsTrigger value="cost-codes" data-testid="tab-cost-codes">
                <Code className="h-4 w-4 mr-2" /> Cost Codes
              </TabsTrigger>
            )}
            {canViewUsers && (
              <TabsTrigger value="users" data-testid="tab-users-roles">
                <Users className="h-4 w-4 mr-2" /> Users & Roles
              </TabsTrigger>
            )}
            {canViewIntegrations && (
              <TabsTrigger value="integrations" data-testid="tab-integrations">
                <Link2 className="h-4 w-4 mr-2" /> Integrations
              </TabsTrigger>
            )}
            {canViewWebsite && (
              <TabsTrigger value="website" data-testid="tab-website">
                <Globe className="h-4 w-4 mr-2" /> Website
              </TabsTrigger>
            )}
            {canViewOverhead && (
              <TabsTrigger value="overhead-costs" data-testid="tab-overhead-costs">
                <DollarSign className="h-4 w-4 mr-2" /> Overhead Costs
              </TabsTrigger>
            )}
            {canViewProductionRates && (
              <TabsTrigger value="production-rates" data-testid="tab-production-rates">
                <BarChart3 className="h-4 w-4 mr-2" /> Production Rates
              </TabsTrigger>
            )}
          </TabsList>
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
      </Tabs>
    </div>
  );
}

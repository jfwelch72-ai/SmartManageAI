import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, BarChart3, TrendingUp, FileEdit, FileSpreadsheet, Receipt, CreditCard, Activity, PieChart, Search } from "lucide-react";
import { FeaturePermissions, hasFinancialAccess } from "@/lib/rbac";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import BudgetTab from "./BudgetTab";
import CostLedgerTab from "./CostLedgerTab";
import CostExplorerTab from "./CostExplorerTab";
import ProfitabilityTab from "./ProfitabilityTab";
import ChangeOrdersTab from "./ChangeOrdersTab";
import SovTab from "./SovTab";
import ReceiptsTab from "./ReceiptsTab";
import BillingTab from "./BillingTab";
import ProductionRatesTab from "./ProductionRatesTab";
import RevenueWipTab from "./RevenueWipTab";
import type { ChangeOrder, Project } from "@shared/schema";

interface FinancialsTabProps {
  project: Project;
  projectCode: string;
  userRole: string;
  changeOrders: ChangeOrder[];
  changeOrdersLoading: boolean;
  canAccessSOV: boolean;
  activeSubTab: string;
  onSubTabChange: (value: string) => void;
}

interface SubTabConfig {
  value: string;
  label: string;
  icon: typeof DollarSign;
  visible: boolean;
}

export default function FinancialsTab({
  project,
  projectCode,
  userRole,
  changeOrders,
  changeOrdersLoading,
  canAccessSOV,
  activeSubTab,
  onSubTabChange,
}: FinancialsTabProps) {
  const { isEnabled } = useFeatureFlags();
  const revenueRecEnabled = isEnabled("REVENUE_RECOGNITION");

  const subTabs: SubTabConfig[] = [
    {
      value: "live-financials",
      label: "Live Financials",
      icon: TrendingUp,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "budget",
      label: "Budget",
      icon: DollarSign,
      visible: FeaturePermissions.VIEW_BUDGET_TAB(userRole),
    },
    {
      value: "cost-ledger",
      label: "Cost Ledger",
      icon: BarChart3,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "cost-explorer",
      label: "Cost Explorer",
      icon: Search,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "change-orders",
      label: "Change Orders",
      icon: FileEdit,
      visible: FeaturePermissions.VIEW_CHANGE_ORDERS_TAB(userRole),
    },
    {
      value: "sov",
      label: "Schedule of Values",
      icon: FileSpreadsheet,
      visible: canAccessSOV,
    },
    {
      value: "receipts",
      label: "Receipts",
      icon: Receipt,
      visible: FeaturePermissions.VIEW_RECEIPTS_TAB(userRole),
    },
    {
      value: "billing",
      label: "Billing",
      icon: CreditCard,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "production-rates",
      label: "Production Rates",
      icon: Activity,
      visible: hasFinancialAccess(userRole),
    },
    {
      value: "revenue-wip",
      label: "Revenue & WIP",
      icon: PieChart,
      visible: hasFinancialAccess(userRole) && revenueRecEnabled,
    },
  ];

  const visibleSubTabs = subTabs.filter((t) => t.visible);

  const resolvedSubTab = visibleSubTabs.find((t) => t.value === activeSubTab)
    ? activeSubTab
    : visibleSubTabs[0]?.value || "live-financials";

  return (
    <Tabs value={resolvedSubTab} onValueChange={onSubTabChange} className="space-y-4">
      <TabsList className="flex-wrap h-auto gap-1" data-testid="financials-sub-tabs">
        {visibleSubTabs.map((tab) => {
          const IconComp = tab.icon;
          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-1.5"
              data-testid={`tab-financials-${tab.value}`}
            >
              <IconComp className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="live-financials">
        <ProfitabilityTab projectCode={project.code} />
      </TabsContent>

      <TabsContent value="budget">
        <BudgetTab
          projectCode={projectCode}
          projectId={project.id}
          userRole={userRole}
          projectBudget={Number(project.budget || project.contractAmount || 0)}
        />
      </TabsContent>

      <TabsContent value="cost-ledger">
        <CostLedgerTab projectCode={projectCode} projectId={project.id} />
      </TabsContent>

      <TabsContent value="cost-explorer">
        <CostExplorerTab projectCode={projectCode} />
      </TabsContent>

      <TabsContent value="change-orders">
        <ChangeOrdersTab
          changeOrders={changeOrders}
          projectCode={projectCode}
          projectId={project.id}
          projectName={project.name}
          clientName={project.clientName}
          isLoading={changeOrdersLoading}
          userRole={userRole}
        />
      </TabsContent>

      <TabsContent value="sov">
        <SovTab projectId={project.id} projectCode={project.code} />
      </TabsContent>

      <TabsContent value="receipts">
        <ReceiptsTab projectCode={projectCode} project={project} />
      </TabsContent>

      <TabsContent value="billing">
        <BillingTab projectId={project.id} projectCode={projectCode} />
      </TabsContent>

      <TabsContent value="production-rates">
        <ProductionRatesTab projectId={project.id} projectCode={projectCode} />
      </TabsContent>

      <TabsContent value="revenue-wip">
        <RevenueWipTab projectId={project.id} projectCode={projectCode} />
      </TabsContent>
    </Tabs>
  );
}

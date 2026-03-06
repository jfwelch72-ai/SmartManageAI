import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, Plus } from "lucide-react";
import { StatsCards, PlanBreakdown, type SubStats } from "@/components/platform/SubscriptionPlanCards";
import { SubscriptionDetailDialog, AssignSubscriptionDialog } from "@/components/platform/SubscriptionAddonsPanel";
import { SubscriptionOrgList } from "@/components/platform/SubscriptionOrgList";

export default function PlatformSubscriptions() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<SubStats>({
    queryKey: ["/api/platform/subscriptions/stats"],
  });

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <CreditCard className="h-6 w-6" /> Subscription Management
          </h1>
          <Button onClick={() => setShowAssignDialog(true)} data-testid="button-assign-subscription">
            <Plus className="w-4 h-4 mr-2" /> Assign Subscription
          </Button>
        </div>
        <p className="text-muted-foreground mt-1">Manage organization plans, statuses, and add-ons across the platform</p>
      </div>

      {statsLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <StatsCards stats={stats} />
          </div>
          <PlanBreakdown stats={stats} />
        </div>
      ) : null}

      <SubscriptionOrgList onSelectOrg={setSelectedOrgId} />

      {selectedOrgId && (
        <SubscriptionDetailDialog
          orgId={selectedOrgId}
          open={!!selectedOrgId}
          onClose={() => setSelectedOrgId(null)}
        />
      )}

      <AssignSubscriptionDialog
        open={showAssignDialog}
        onClose={() => setShowAssignDialog(false)}
      />
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";

interface ComplianceItem {
  id: string;
  partyType: "CRM_ORG" | "PROJECT";
  partyId: string;
  daysUntilExpiry: number | null;
  status: "ACTIVE" | "EXPIRING" | "EXPIRED";
}

interface Props {
  partyType: "CRM_ORG" | "PROJECT";
  partyId: string;
  className?: string;
}

/**
 * Small inline badge that surfaces the worst expiration state for a given
 * party (CRM org or project). Only renders if the user can view the
 * compliance dashboard and there is at least one expiring/expired item.
 */
export function ComplianceBadge({ partyType, partyId, className }: Props) {
  const canView = useFeaturePermission("canViewComplianceDashboard");
  const { data = [] } = useQuery<ComplianceItem[]>({
    queryKey: ["/api/compliance/expirations"],
    enabled: canView,
    staleTime: 60_000,
  });

  if (!canView) return null;

  const partyItems = data.filter(
    (it) =>
      it.partyType === partyType &&
      it.partyId === partyId &&
      it.daysUntilExpiry !== null &&
      (it.status === "EXPIRED" || it.status === "EXPIRING" || (it.daysUntilExpiry as number) <= 45),
  );
  if (partyItems.length === 0) return null;

  const worst = partyItems.reduce<ComplianceItem | null>((acc, it) => {
    if (acc === null) return it;
    return (it.daysUntilExpiry ?? 0) < (acc.daysUntilExpiry ?? 0) ? it : acc;
  }, null);
  if (!worst || worst.daysUntilExpiry === null) return null;

  const expiredCount = partyItems.filter((p) => (p.daysUntilExpiry ?? 0) < 0).length;
  const expired = expiredCount > 0;
  const urgent = expired || (worst.daysUntilExpiry as number) <= 14;
  const label = expired
    ? `${expiredCount} expired`
    : `${partyItems.length} expiring`;

  return (
    <Link
      href="/compliance"
      onClick={(e) => e.stopPropagation()}
      className={className}
      data-testid={`badge-compliance-${partyType}-${partyId}`}
    >
      <Badge
        variant={urgent ? "destructive" : "secondary"}
        className={urgent ? "" : "bg-amber-500 text-white hover:bg-amber-600"}
      >
        <ShieldAlert className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    </Link>
  );
}

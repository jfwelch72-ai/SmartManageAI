import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, FileCheck, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { format, parseISO, differenceInDays } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/lib/rbac";

interface ExpiringPermit {
  id: string;
  permitType: string;
  customType?: string | null;
  permitNumber?: string | null;
  expiryDate: string;
  projectName: string;
  projectCode: string;
  status: string;
}

const PERMIT_TYPE_LABELS: Record<string, string> = {
  BUILDING: "Building",
  DEMOLITION: "Demolition",
  EXCAVATION: "Excavation",
  ELECTRICAL: "Electrical",
  PLUMBING: "Plumbing",
  MECHANICAL: "Mechanical",
  FIRE_SAFETY: "Fire Safety",
  ENVIRONMENTAL: "Environmental",
  OCCUPANCY: "Occupancy",
  CUSTOM: "Custom",
};

const PERMITTED_ROLES: UserRole[] = ["ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"];

export function ExpiringPermitsBanner() {
  const { user } = useAuth();
  const userRole = user?.role as UserRole | undefined;
  const hasPermission = userRole ? PERMITTED_ROLES.includes(userRole) : false;

  const { data: expiringPermits = [] } = useQuery<ExpiringPermit[]>({
    queryKey: ["/api/permits/expiring"],
    queryFn: async () => {
      const response = await fetch("/api/permits/expiring", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 300000,
    enabled: hasPermission,
  });

  if (!hasPermission || expiringPermits.length === 0) return null;

  return (
    <Alert variant="destructive" className="mb-6 border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 text-yellow-900 dark:text-yellow-200" data-testid="alert-expiring-permits">
      <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
      <AlertTitle className="text-yellow-800 dark:text-yellow-300">
        {expiringPermits.length} Permit{expiringPermits.length !== 1 ? "s" : ""} Expiring Within 30 Days
      </AlertTitle>
      <AlertDescription>
        <div className="mt-2 space-y-1.5">
          {expiringPermits.slice(0, 5).map((permit) => {
            const days = differenceInDays(parseISO(permit.expiryDate), new Date());
            const typeLabel = permit.permitType === "CUSTOM" && permit.customType
              ? permit.customType
              : PERMIT_TYPE_LABELS[permit.permitType] || permit.permitType;

            return (
              <Link key={permit.id} href={`/projects/${permit.projectCode}?tab=permits`}>
                <div className="flex items-center gap-2 text-sm cursor-pointer hover:underline" data-testid={`link-expiring-permit-${permit.id}`}>
                  <FileCheck className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="font-medium">{typeLabel}</span>
                  {permit.permitNumber && (
                    <span className="text-muted-foreground">#{permit.permitNumber}</span>
                  )}
                  <span className="text-muted-foreground">—</span>
                  <span>{permit.projectName}</span>
                  <Badge
                    variant={days <= 7 ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    {days <= 0 ? "Expiring today" : `${days} day${days !== 1 ? "s" : ""}`}
                  </Badge>
                  <ChevronRight className="h-3 w-3 ml-auto flex-shrink-0" />
                </div>
              </Link>
            );
          })}
          {expiringPermits.length > 5 && (
            <p className="text-xs text-muted-foreground mt-1">
              and {expiringPermits.length - 5} more...
            </p>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

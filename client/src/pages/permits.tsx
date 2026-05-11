import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileCheck,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Shield,
  Building,
  CalendarDays,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { EmptyState } from "@/components/EmptyState";

interface PermitWithProject {
  id: string;
  permitType: string;
  customType?: string | null;
  permitNumber?: string | null;
  status: string;
  issuingAuthority?: string | null;
  appliedDate?: string | null;
  expiryDate?: string | null;
  projectName: string;
  projectCode: string;
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

const STATUS_COLORS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  APPLIED: "secondary",
  UNDER_REVIEW: "secondary",
  APPROVED: "default",
  ACTIVE: "default",
  EXPIRED: "destructive",
  RENEWED: "outline",
};

const STATUS_LABELS: Record<string, string> = {
  APPLIED: "Applied",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  RENEWED: "Renewed",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  APPLIED: Clock,
  UNDER_REVIEW: Clock,
  APPROVED: CheckCircle,
  ACTIVE: Shield,
  EXPIRED: XCircle,
  RENEWED: CheckCircle,
};

export default function PermitsPage() {
  const { user } = useAuth();

  const { data: expiringPermits = [], isLoading: loadingExpiring } = useQuery<
    PermitWithProject[]
  >({
    queryKey: ["/api/permits/expiring"],
    queryFn: async () => {
      const response = await fetch("/api/permits/expiring", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
  });

  return (
    <div
      className="container max-w-full mx-auto py-6 px-8 space-y-6"
      data-testid="page-permits"
    >
      <div>
        <h1
          className="text-2xl font-bold flex items-center gap-2"
          data-testid="text-page-title"
        >
          <FileCheck className="h-6 w-6" />
          Permits & Licenses
        </h1>
        <p className="text-muted-foreground mt-1">
          Overview of permits expiring soon across all projects. Open a project
          to manage its permits.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Expiring Within 30 Days
          </CardTitle>
          <CardDescription>
            Permits that require attention due to upcoming expiration dates
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingExpiring ? (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              Loading permits...
            </div>
          ) : expiringPermits.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No expiring permits"
              description="No permits are expiring within the next 30 days. All clear!"
            />
          ) : (
            <div className="space-y-3">
              {expiringPermits.map((permit) => {
                const StatusIcon = STATUS_ICONS[permit.status] || Clock;
                const typeLabel =
                  permit.permitType === "CUSTOM" && permit.customType
                    ? permit.customType
                    : PERMIT_TYPE_LABELS[permit.permitType] ||
                      permit.permitType;
                const days = permit.expiryDate
                  ? differenceInDays(parseISO(permit.expiryDate), new Date())
                  : null;

                return (
                  <Link
                    key={permit.id}
                    href={`/projects/${permit.projectCode}?tab=permits`}
                  >
                    <Card
                      className="hover-elevate cursor-pointer"
                      data-testid={`card-expiring-permit-${permit.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <FileCheck className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{typeLabel}</span>
                              {permit.permitNumber && (
                                <span className="text-sm text-muted-foreground">
                                  #{permit.permitNumber}
                                </span>
                              )}
                              <Badge variant={STATUS_COLORS[permit.status]}>
                                <StatusIcon className="h-3 w-3 mr-1" />
                                {STATUS_LABELS[permit.status] || permit.status}
                              </Badge>
                              {days !== null && (
                                <Badge
                                  variant={
                                    days <= 7 ? "destructive" : "secondary"
                                  }
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  {days <= 0
                                    ? "Expiring today"
                                    : `${days} day${days !== 1 ? "s" : ""}`}
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-3">
                              <span className="flex items-center gap-1">
                                <Building className="h-3 w-3" />
                                {permit.projectName}
                              </span>
                              {permit.expiryDate && (
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="h-3 w-3" />
                                  Expires:{" "}
                                  {format(
                                    parseISO(permit.expiryDate),
                                    "MMM d, yyyy",
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

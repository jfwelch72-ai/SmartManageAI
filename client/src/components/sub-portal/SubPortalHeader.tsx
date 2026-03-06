import { Badge } from "@/components/ui/badge";
import { Shield, Building2 } from "lucide-react";

interface SubPortalHeaderProps {
  portalInfo: any;
}

export function SubPortalHeader({ portalInfo }: SubPortalHeaderProps) {
  return (
    <header
      className="border-b bg-card"
      data-testid="header-portal"
    >
      <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1
              className="text-lg font-semibold"
              data-testid="text-portal-title"
            >
              Subcontractor Portal
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {portalInfo.projectName && (
                <span
                  className="flex items-center gap-1"
                  data-testid="text-project-name"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  {portalInfo.projectName}
                </span>
              )}
              {portalInfo.companyName && (
                <span data-testid="text-company-name">
                  {portalInfo.companyName}
                </span>
              )}
            </div>
          </div>
        </div>
        <Badge
          variant="outline"
          className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
          data-testid="badge-secure-access"
        >
          <Shield className="h-3 w-3 mr-1" />
          Secure Access
        </Badge>
      </div>
    </header>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileSpreadsheet, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SOV } from "./types";

interface SovSummaryCardsProps {
  sovs: SOV[];
  draftCount: number;
  pendingCount: number;
  approvedCount: number;
}

export function SovSummaryCards({ sovs, draftCount, pendingCount, approvedCount }: SovSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
      <Card>
        <CardHeader className="pb-1 sm:pb-2 p-3 sm:p-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
            <FileSpreadsheet className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Total SOVs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="text-xl sm:text-2xl font-bold" data-testid="text-total-sovs">{sovs.length}</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-1 sm:pb-2 p-3 sm:p-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Draft
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="text-xl sm:text-2xl font-bold" data-testid="text-draft-sovs">{draftCount}</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-1 sm:pb-2 p-3 sm:p-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
            <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Pending
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="text-xl sm:text-2xl font-bold" data-testid="text-pending-sovs">{pendingCount}</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-1 sm:pb-2 p-3 sm:p-6">
          <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1.5 sm:gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Approved
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="text-xl sm:text-2xl font-bold" data-testid="text-approved-sovs">{approvedCount}</div>
        </CardContent>
      </Card>
    </div>
  );
}

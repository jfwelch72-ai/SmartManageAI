import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Clock, DollarSign } from "lucide-react";
import { format } from "date-fns";
import type { ClaimWithRelations } from "@/components/delay-claims/types";

function getStatusBadge(status: string) {
  switch (status) {
    case "DRAFT": return <Badge variant="outline">Draft</Badge>;
    case "SUBMITTED": return <Badge variant="outline" className="text-blue-600 border-blue-600 dark:text-blue-500 dark:border-blue-500">Submitted</Badge>;
    case "UNDER_REVIEW": return <Badge className="bg-yellow-500 hover:bg-yellow-600">Under Review</Badge>;
    case "APPROVED": return <Badge className="bg-green-500 hover:bg-green-600">Approved</Badge>;
    case "REJECTED": return <Badge variant="destructive">Rejected</Badge>;
    case "WITHDRAWN": return <Badge variant="secondary">Withdrawn</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function getClaimTypeBadge(type: string) {
  switch (type) {
    case "TIME_EXTENSION": return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Time</Badge>;
    case "COST_IMPACT": return <Badge variant="secondary"><DollarSign className="w-3 h-3 mr-1" />Cost</Badge>;
    case "BOTH": return <Badge variant="secondary">Time + Cost</Badge>;
    default: return <Badge variant="outline">{type}</Badge>;
  }
}

function formatCurrency(amount: string | number | null | undefined) {
  if (!amount) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(typeof amount === "string" ? parseFloat(amount) : amount);
}

export { getStatusBadge, getClaimTypeBadge, formatCurrency };

export function DelayClaimMobileList({ claims, onSelect }: { claims: ClaimWithRelations[]; onSelect: (c: ClaimWithRelations) => void }) {
  if (claims.length === 0) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">No delay claims found</CardContent></Card>;
  }
  return (
    <div className="space-y-3">
      {claims.map((claim) => (
        <Card key={claim.id} className="hover-elevate cursor-pointer" data-testid={`card-claim-${claim.id}`} onClick={() => onSelect(claim)}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium" data-testid={`text-claim-number-${claim.id}`}>{claim.claimNumber}</span>
              {getStatusBadge(claim.status)}
            </div>
            <div className="text-sm font-medium">{claim.title}</div>
            <div className="text-sm text-muted-foreground">{claim.project?.code || "-"} {claim.project?.name ? `- ${claim.project.name}` : ""}</div>
            <div className="flex items-center flex-wrap gap-2">
              {getClaimTypeBadge(claim.claimType)}
              {claim.daysRequested ? <span className="text-xs text-muted-foreground">{claim.daysRequested} days</span> : null}
              {claim.costRequested ? <span className="text-xs text-muted-foreground">{formatCurrency(claim.costRequested)}</span> : null}
            </div>
            <div className="text-xs text-muted-foreground">{claim.createdAt ? format(new Date(claim.createdAt), "MM/dd/yyyy") : "-"}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function DelayClaimDesktopTable({ claims, onSelect }: { claims: ClaimWithRelations[]; onSelect: (c: ClaimWithRelations) => void }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim #</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No delay claims found</TableCell></TableRow>
              ) : (
                claims.map((claim) => (
                  <TableRow key={claim.id} data-testid={`row-claim-${claim.id}`}>
                    <TableCell className="font-mono text-sm" data-testid={`text-claim-number-${claim.id}`}>{claim.claimNumber}</TableCell>
                    <TableCell>{claim.project?.code || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{claim.title}</TableCell>
                    <TableCell>{getClaimTypeBadge(claim.claimType)}</TableCell>
                    <TableCell>{claim.daysRequested ? `${claim.daysRequested} days` : "-"}</TableCell>
                    <TableCell>{formatCurrency(claim.costRequested)}</TableCell>
                    <TableCell>{getStatusBadge(claim.status)}</TableCell>
                    <TableCell>{claim.createdAt ? format(new Date(claim.createdAt), "MM/dd/yyyy") : "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => onSelect(claim)} data-testid={`button-view-claim-${claim.id}`}><Eye className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

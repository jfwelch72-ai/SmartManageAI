import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Building2, Check, X, CreditCard, FileText, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { Payable } from "./types";

interface PayablesTableProps {
  payables: Payable[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  userRole: string;
  onApprove: (payable: Payable) => void;
  onRejectOpen: (payable: Payable) => void;
  onPayOpen: (payable: Payable) => void;
  onViewDetail: (payable: Payable) => void;
  isApproving: boolean;
  formatCurrency: (amount: string | number) => string;
  getStatusBadge: (status: string) => JSX.Element;
}

function getAgingDays(createdAt: string) {
  const created = new Date(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - created.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function PayablesTable({
  payables,
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  userRole,
  onApprove,
  onRejectOpen,
  onPayOpen,
  onViewDetail,
  isApproving,
  formatCurrency,
  getStatusBadge,
}: PayablesTableProps) {
  return (
    <>
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by subcontractor, project, or contract..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid="input-search-payables"
          />
        </div>
        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-full md:w-48" data-testid="select-status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {payables.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchTerm || statusFilter !== "ALL"
                ? "No payables match your filters"
                : "No subcontractor payables yet. Payables are automatically created when a subcontract is marked as completed."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Payables List</CardTitle>
            <CardDescription>
              {payables.length} payable{payables.length !== 1 ? 's' : ''} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract #</TableHead>
                    <TableHead>Subcontractor</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payables.map((payable) => {
                    const agingDays = getAgingDays(payable.createdAt);
                    return (
                      <TableRow key={payable.id} data-testid={`row-payable-${payable.id}`}>
                        <TableCell className="font-mono text-xs">
                          {payable.contract.contractNumber}
                          {payable.autoCreated && (
                            <Badge variant="outline" className="ml-2 text-xs">Auto</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{payable.subcontractor.companyName}</p>
                            {payable.subcontractor.contactName && (
                              <p className="text-xs text-muted-foreground">{payable.subcontractor.contactName}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <Badge variant="outline" className="font-mono text-xs mb-1">{payable.project.code}</Badge>
                            <p className="text-sm">{payable.project.name}</p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {payable.contract.scopeOfWork}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(payable.amount)}
                        </TableCell>
                        <TableCell>{getStatusBadge(payable.status)}</TableCell>
                        <TableCell>
                          <div className={agingDays > 30 ? "text-red-500 font-medium" : agingDays > 14 ? "text-yellow-600 dark:text-yellow-500 font-medium" : ""}>
                            {agingDays} day{agingDays !== 1 ? 's' : ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {payable.status === "PENDING" && (userRole === "ADMIN" || userRole === "MANAGER") && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => onApprove(payable)}
                                  disabled={isApproving}
                                  data-testid={`button-approve-${payable.id}`}
                                >
                                  {isApproving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onRejectOpen(payable)}
                                  data-testid={`button-reject-${payable.id}`}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                            {payable.status === "APPROVED" && (userRole === "ADMIN" || userRole === "MANAGER") && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onPayOpen(payable)}
                                data-testid={`button-pay-${payable.id}`}
                              >
                                <CreditCard className="w-3 h-3 mr-1" /> Pay
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onViewDetail(payable)}
                              data-testid={`button-view-${payable.id}`}
                            >
                              <FileText className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

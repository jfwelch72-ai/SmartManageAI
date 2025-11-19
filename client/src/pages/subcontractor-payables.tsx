import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { DollarSign, AlertCircle, Clock, Search, Building2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Payable {
  paymentId: string;
  paymentNumber: number;
  amount: string;
  retentionHeld: string | null;
  paymentDate: string | null;
  description: string | null;
  invoiceNumber: string | null;
  status: string;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  remainingBalance: string;
  contract: {
    id: string;
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string;
    projectId: string;
  };
  subcontractor: {
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  };
  project: {
    code: string;
    name: string;
  };
}

export default function SubcontractorPayablesPage() {
  const { user, logout } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const { data: payables = [], isLoading } = useQuery<Payable[]>({
    queryKey: ["/api/subcontractor-payables"],
    enabled: !!user && (user.role === "ADMIN" || user.role === "MANAGER"),
  });

  const filteredPayables = useMemo(() => {
    return payables.filter(payable => {
      const matchesSearch =
        payable.subcontractor.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payable.project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payable.project.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (payable.invoiceNumber && payable.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus = statusFilter === "ALL" || payable.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [payables, searchTerm, statusFilter]);

  // Calculate totals
  const totalPending = payables
    .filter(p => p.status === "PENDING")
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const totalApproved = payables
    .filter(p => p.status === "APPROVED")
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const totalPaid = payables
    .filter(p => p.status === "PAID")
    .reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const pendingCount = payables.filter(p => p.status === "PENDING").length;

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(typeof amount === "string" ? parseFloat(amount) : amount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">Pending</Badge>;
      case "APPROVED":
        return <Badge className="bg-blue-500 hover:bg-blue-600">Approved</Badge>;
      case "PAID":
        return <Badge className="bg-green-500 hover:bg-green-600">Paid</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getAgingDays = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - created.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (!user || (user.role !== "ADMIN" && user.role !== "MANAGER")) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <CardContent className="p-8 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Admin or Manager access required to view subcontractor payables.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user.firstName || ""} ${user.lastName || ""}`.trim() || "User"}
        userRole={user.role}
        onLogout={logout}
      />

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-primary" />
            Subcontractor Payables
          </h1>
          <p className="text-sm text-muted-foreground">
            Track and manage all subcontractor payments across projects
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading payables...</div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <Card data-testid="card-pending-payables">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4 text-yellow-500" />
                    Pending Approval
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(totalPending)}</div>
                  <p className="text-xs text-muted-foreground mt-1">{pendingCount} invoice{pendingCount !== 1 ? 's' : ''}</p>
                </CardContent>
              </Card>

              <Card data-testid="card-approved-payables">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-500" />
                    Approved (Unpaid)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(totalApproved)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {payables.filter(p => p.status === "APPROVED").length} payment{payables.filter(p => p.status === "APPROVED").length !== 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-paid-payables">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Total Paid (All Time)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">{formatCurrency(totalPaid)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {payables.filter(p => p.status === "PAID").length} payment{payables.filter(p => p.status === "PAID").length !== 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-total-outstanding">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600">{formatCurrency(totalPending + totalApproved)}</div>
                  <p className="text-xs text-muted-foreground mt-1">Pending + Approved</p>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by subcontractor, project, or invoice..."
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search-payables"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-48" data-testid="select-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Payables Table */}
            {filteredPayables.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {searchTerm || statusFilter !== "ALL" ? "No payables match your filters" : "No subcontractor payables yet"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Payables List</CardTitle>
                  <CardDescription>
                    {filteredPayables.length} payable{filteredPayables.length !== 1 ? 's' : ''} found
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Subcontractor</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Scope</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Contract Balance</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Age</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPayables.map((payable) => {
                          const agingDays = getAgingDays(payable.createdAt);
                          return (
                            <TableRow key={payable.paymentId} data-testid={`row-payable-${payable.paymentId}`}>
                              <TableCell className="font-mono text-xs">
                                {payable.invoiceNumber || `#${payable.paymentNumber}`}
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
                              <TableCell className="text-right">
                                <div className="flex flex-col items-end">
                                  <span className={`font-medium ${parseFloat(payable.remainingBalance) > 0 ? 'text-yellow-600 dark:text-yellow-500' : 'text-green-500'}`}>
                                    {formatCurrency(payable.remainingBalance)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    of {formatCurrency(payable.contract.contractAmount)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>{getStatusBadge(payable.status)}</TableCell>
                              <TableCell>
                                <div className={agingDays > 30 ? "text-red-500 font-medium" : agingDays > 14 ? "text-yellow-600 font-medium" : ""}>
                                  {agingDays} day{agingDays !== 1 ? 's' : ''}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" data-testid={`button-view-${payable.paymentId}`}>
                                  View
                                </Button>
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
        )}
      </main>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Filter, DollarSign, TrendingUp, Layers, Calendar } from "lucide-react";

interface CostTransaction {
  id: string;
  projectId: string;
  costCode: string;
  sourceCategory: string;
  originModule: string;
  amount: string;
  transactionDate: string;
  referenceId: string | null;
  description: string | null;
  status: string;
  createdAt: string;
}

interface CostSummaryRow {
  groupKey: string;
  totalAmount: number;
  transactionCount: number;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

const SOURCE_CATEGORY_LABELS: Record<string, string> = {
  LABOR: "Labor",
  MATERIAL: "Material",
  EQUIPMENT: "Equipment",
  SUBCONTRACTOR: "Subcontractor",
  OTHER: "Other",
};

const ORIGIN_MODULE_LABELS: Record<string, string> = {
  ESTIMATE: "Estimate",
  PO: "Purchase Order",
  PAYROLL: "Payroll",
  TM: "T&M Ticket",
  RECEIPT: "Receipt",
  CHANGE_ORDER: "Change Order",
  EQUIPMENT: "Equipment",
  SUBCONTRACTOR: "Subcontractor",
};

const SOURCE_BADGE_COLORS: Record<string, string> = {
  LABOR: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  MATERIAL: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  EQUIPMENT: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  SUBCONTRACTOR: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  OTHER: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

interface CostExplorerTabProps {
  projectCode: string;
}

export default function CostExplorerTab({ projectCode }: CostExplorerTabProps) {
  const [sourceCategory, setSourceCategory] = useState<string>("all");
  const [originModule, setOriginModule] = useState<string>("all");
  const [costCodeFilter, setCostCodeFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [groupBy, setGroupBy] = useState<string>("cost_code");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const queryParams = new URLSearchParams();
  if (sourceCategory !== "all") queryParams.set("sourceCategory", sourceCategory);
  if (originModule !== "all") queryParams.set("originModule", originModule);
  if (costCodeFilter) queryParams.set("costCode", costCodeFilter);
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  queryParams.set("limit", String(pageSize));
  queryParams.set("offset", String(page * pageSize));

  const summaryParams = new URLSearchParams();
  if (sourceCategory !== "all") summaryParams.set("sourceCategory", sourceCategory);
  if (originModule !== "all") summaryParams.set("originModule", originModule);
  if (costCodeFilter) summaryParams.set("costCode", costCodeFilter);
  if (startDate) summaryParams.set("startDate", startDate);
  if (endDate) summaryParams.set("endDate", endDate);
  summaryParams.set("groupBy", groupBy);

  const { data: transactionsData, isLoading: txLoading } = useQuery<{
    transactions: CostTransaction[];
    total: number;
  }>({
    queryKey: ["/api/projects", projectCode, "cost-transactions", queryParams.toString()],
    queryFn: () =>
      fetch(`/api/projects/${projectCode}/cost-transactions?${queryParams.toString()}`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery<CostSummaryRow[]>({
    queryKey: ["/api/projects", projectCode, "cost-transactions", "summary", summaryParams.toString()],
    queryFn: () =>
      fetch(`/api/projects/${projectCode}/cost-transactions/summary?${summaryParams.toString()}`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  const { data: categorySummary } = useQuery<CostSummaryRow[]>({
    queryKey: ["/api/projects", projectCode, "cost-transactions", "summary", "by-category"],
    queryFn: () =>
      fetch(`/api/projects/${projectCode}/cost-transactions/summary?groupBy=source_category`, {
        credentials: "include",
      }).then((r) => r.json()),
  });

  const transactions = transactionsData?.transactions || [];
  const totalCount = transactionsData?.total || 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const summary = Array.isArray(summaryData) ? summaryData : [];
  const summaryTotal = summary.reduce((acc, r) => acc + r.totalAmount, 0);

  const categoryCards = (Array.isArray(categorySummary) ? categorySummary : []).map((c) => ({
    label: SOURCE_CATEGORY_LABELS[c.groupKey] || c.groupKey,
    amount: c.totalAmount,
    count: c.transactionCount,
    color: SOURCE_BADGE_COLORS[c.groupKey] || SOURCE_BADGE_COLORS.OTHER,
  }));

  const handleResetFilters = () => {
    setSourceCategory("all");
    setOriginModule("all");
    setCostCodeFilter("");
    setStartDate("");
    setEndDate("");
    setPage(0);
  };

  return (
    <div className="space-y-6" data-testid="cost-explorer-tab">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {categoryCards.length > 0 ? (
          categoryCards.map((card) => (
            <Card key={card.label} className="cursor-pointer hover:shadow-md transition-shadow" data-testid={`summary-card-${card.label.toLowerCase()}`}>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
                <p className="text-lg font-bold mt-1">{fmtCurrency(card.amount)}</p>
                <p className="text-xs text-muted-foreground">{card.count} transactions</p>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="col-span-full">
            <CardContent className="p-6 text-center text-muted-foreground">
              No cost transactions recorded yet. Costs will appear here as PO receipts, payroll runs, T&M tickets, and other cost events are processed.
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters & Grouping
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={handleResetFilters} data-testid="btn-reset-filters">
              Reset
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Select value={sourceCategory} onValueChange={(v) => { setSourceCategory(v); setPage(0); }}>
              <SelectTrigger data-testid="select-source-category">
                <SelectValue placeholder="Source Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="LABOR">Labor</SelectItem>
                <SelectItem value="MATERIAL">Material</SelectItem>
                <SelectItem value="EQUIPMENT">Equipment</SelectItem>
                <SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>

            <Select value={originModule} onValueChange={(v) => { setOriginModule(v); setPage(0); }}>
              <SelectTrigger data-testid="select-origin-module">
                <SelectValue placeholder="Origin Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                <SelectItem value="PAYROLL">Payroll</SelectItem>
                <SelectItem value="PO">Purchase Order</SelectItem>
                <SelectItem value="TM">T&M Ticket</SelectItem>
                <SelectItem value="RECEIPT">Receipt</SelectItem>
                <SelectItem value="EQUIPMENT">Equipment</SelectItem>
                <SelectItem value="SUBCONTRACTOR">Subcontractor</SelectItem>
                <SelectItem value="CHANGE_ORDER">Change Order</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cost code..."
                value={costCodeFilter}
                onChange={(e) => { setCostCodeFilter(e.target.value); setPage(0); }}
                className="pl-9"
                data-testid="input-cost-code-filter"
              />
            </div>

            <Input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              placeholder="Start date"
              data-testid="input-start-date"
            />

            <Input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              placeholder="End date"
              data-testid="input-end-date"
            />

            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger data-testid="select-group-by">
                <SelectValue placeholder="Group by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cost_code">By Cost Code</SelectItem>
                <SelectItem value="source_category">By Category</SelectItem>
                <SelectItem value="origin_module">By Module</SelectItem>
                <SelectItem value="month">By Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Summary — Grouped by {groupBy === "cost_code" ? "Cost Code" : groupBy === "source_category" ? "Category" : groupBy === "origin_module" ? "Module" : "Month"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : summary.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground text-sm">No cost data available for the selected filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{groupBy === "cost_code" ? "Cost Code" : groupBy === "source_category" ? "Category" : groupBy === "origin_module" ? "Module" : "Month"}</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row) => (
                  <TableRow key={row.groupKey} data-testid={`summary-row-${row.groupKey}`}>
                    <TableCell className="font-medium">
                      {groupBy === "source_category"
                        ? SOURCE_CATEGORY_LABELS[row.groupKey] || row.groupKey
                        : groupBy === "origin_module"
                        ? ORIGIN_MODULE_LABELS[row.groupKey] || row.groupKey
                        : row.groupKey}
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmtCurrency(row.totalAmount)}</TableCell>
                    <TableCell className="text-right">{row.transactionCount}</TableCell>
                    <TableCell className="text-right">
                      {summaryTotal > 0 ? ((row.totalAmount / summaryTotal) * 100).toFixed(1) : "0.0"}%
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold border-t-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono">{fmtCurrency(summaryTotal)}</TableCell>
                  <TableCell className="text-right">{summary.reduce((a, r) => a + r.transactionCount, 0)}</TableCell>
                  <TableCell className="text-right">100.0%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Transactions ({totalCount})
            </CardTitle>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  data-testid="btn-prev-page"
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                  data-testid="btn-next-page"
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {txLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground text-sm">
              No transactions found. Cost transactions are automatically created when PO receipts are recorded, payroll runs are completed, T&M tickets are approved, and other cost events occur.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Cost Code</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id} data-testid={`tx-row-${tx.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(tx.transactionDate + "T00:00:00").toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{tx.costCode}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_BADGE_COLORS[tx.sourceCategory] || SOURCE_BADGE_COLORS.OTHER}`}>
                          {SOURCE_CATEGORY_LABELS[tx.sourceCategory] || tx.sourceCategory}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ORIGIN_MODULE_LABELS[tx.originModule] || tx.originModule}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={tx.description || ""}>
                        {tx.description || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {fmtCurrency(Number(tx.amount))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

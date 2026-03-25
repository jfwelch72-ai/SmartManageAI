import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Building2,
  DollarSign,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  Calculator,
  Target,
  CheckCircle2,
  History,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";

interface OverheadCostItem {
  id: string;
  organizationId: string;
  name: string;
  category: string;
  amount: string;
  frequency: string;
  amortizationMonths: number | null;
  effectiveDate: string | null;
  endDate: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OverheadSummary {
  totalMonthly: number;
  totalAnnual: number;
  suggestedPercent: number | null;
  annualRevenueTarget: number | null;
  defaultOverheadPercent: number;
  overheadWarningThreshold: number | null;
  overheadCriticalThreshold: number | null;
  categoryBreakdown: Record<string, number>;
  categoryWeights: Record<string, number>;
  weightedCategoryBreakdown: Record<string, { monthly: number; weight: number; weighted: number }>;
  monthlyRevenueTargets: Record<string, number>;
}

interface OverheadHistoryEntry {
  id: string;
  organizationId: string;
  costItemId: string | null;
  action: string;
  performedById: string | null;
  itemName: string;
  previousData: string | null;
  newData: string | null;
  createdAt: string;
}

const CATEGORIES = [
  { value: "SALARIES", label: "Salaries & Payroll" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "RENT_LEASE", label: "Rent / Lease" },
  { value: "LOANS_FINANCING", label: "Loans & Financing" },
  { value: "SUBSCRIPTIONS", label: "Subscriptions & Software" },
  { value: "UTILITIES", label: "Utilities" },
  { value: "VEHICLES", label: "Vehicles & Fleet" },
  { value: "MARKETING", label: "Marketing & Advertising" },
  { value: "PROFESSIONAL_FEES", label: "Professional Fees" },
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "OTHER", label: "Other" },
] as const;

const FREQUENCIES = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUAL", label: "Annual" },
  { value: "ONE_TIME", label: "One-Time" },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  SALARIES: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  INSURANCE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  RENT_LEASE: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  LOANS_FINANCING: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  SUBSCRIPTIONS: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  UTILITIES: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  VEHICLES: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  MARKETING: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300",
  PROFESSIONAL_FEES: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  EQUIPMENT: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  OTHER: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

function getCategoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function getFrequencyLabel(value: string) {
  return FREQUENCIES.find((f) => f.value === value)?.label ?? value;
}

const DEFAULT_AMORTIZATION_MONTHS = 12;

function toMonthly(amount: number, frequency: string, amortizationMonths?: number | null): number {
  if (frequency === "ONE_TIME") {
    const months = amortizationMonths && amortizationMonths > 0 ? amortizationMonths : DEFAULT_AMORTIZATION_MONTHS;
    return amount / months;
  }
  const multipliers: Record<string, number> = {
    MONTHLY: 1,
    QUARTERLY: 1 / 3,
    ANNUAL: 1 / 12,
  };
  return amount * (multipliers[frequency] ?? 1);
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const OVERHEAD_CATEGORIES_VALUES = [
  "SALARIES", "INSURANCE", "RENT_LEASE", "LOANS_FINANCING", "SUBSCRIPTIONS",
  "UTILITIES", "VEHICLES", "MARKETING", "PROFESSIONAL_FEES", "EQUIPMENT", "OTHER",
] as const;

const itemFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  category: z.enum(OVERHEAD_CATEGORIES_VALUES),
  amount: z.coerce.number({ invalid_type_error: "Enter a valid amount" }).nonnegative("Amount must be 0 or more"),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"]),
  amortizationMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
  effectiveDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.boolean(),
  notes: z.string().optional(),
});
type ItemFormValues = z.infer<typeof itemFormSchema>;

function ItemDialog({
  open,
  onClose,
  editItem,
}: {
  open: boolean;
  onClose: () => void;
  editItem: OverheadCostItem | null;
}) {
  const { toast } = useToast();

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: editItem
      ? {
          name: editItem.name,
          category: editItem.category as ItemFormValues["category"],
          amount: Number(editItem.amount),
          frequency: editItem.frequency as ItemFormValues["frequency"],
          amortizationMonths: editItem.amortizationMonths ?? null,
          effectiveDate: editItem.effectiveDate ?? "",
          endDate: editItem.endDate ?? "",
          isActive: editItem.isActive,
          notes: editItem.notes ?? "",
        }
      : {
          name: "",
          category: "OTHER",
          amount: 0,
          frequency: "MONTHLY",
          amortizationMonths: null,
          effectiveDate: "",
          endDate: "",
          isActive: true,
          notes: "",
        },
  });

  const watchFrequency = form.watch("frequency");

  const createMutation = useMutation({
    mutationFn: (data: ItemFormValues) => apiRequest("POST", "/api/overhead/items", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/history"] });
      toast({ title: "Cost item added" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: ItemFormValues) =>
      apiRequest("PATCH", `/api/overhead/items/${editItem!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/history"] });
      toast({ title: "Cost item updated" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(values: ItemFormValues) {
    const payload = {
      ...values,
      amortizationMonths: values.frequency === "ONE_TIME" ? (values.amortizationMonths || null) : null,
      effectiveDate: values.effectiveDate || null,
      endDate: values.endDate || null,
      notes: values.notes || null,
    };
    if (editItem) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-overhead-item">
        <DialogHeader>
          <DialogTitle>{editItem ? "Edit Cost Item" : "Add Cost Item"}</DialogTitle>
          <DialogDescription>
            Enter the details of this overhead or fixed cost.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Office Rent" data-testid="input-overhead-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-overhead-category">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-overhead-frequency">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FREQUENCIES.map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      data-testid="input-overhead-amount"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchFrequency === "ONE_TIME" && (
              <FormField
                control={form.control}
                name="amortizationMonths"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amortization Period (months)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="120"
                        step="1"
                        placeholder="Default: 12 months"
                        data-testid="input-amortization-months"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          field.onChange(v === "" ? null : Number(v));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">
                      Spread this one-time cost over this many months for the monthly overhead calculation.
                    </p>
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="effectiveDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective Date</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-overhead-effective-date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-overhead-end-date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-overhead-active"
                    />
                  </FormControl>
                  <FormLabel className="!mt-0">Active (included in calculations)</FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional notes..."
                      rows={2}
                      data-testid="textarea-overhead-notes"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} data-testid="button-overhead-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-overhead-save">
                {isPending ? "Saving..." : editItem ? "Update" : "Add Cost"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryGroup({
  category,
  items,
  onEdit,
  onDelete,
}: {
  category: string;
  items: OverheadCostItem[];
  onEdit: (item: OverheadCostItem) => void;
  onDelete: (item: OverheadCostItem) => void;
}) {
  const groupMonthly = items.reduce(
    (sum, i) => sum + toMonthly(Number(i.amount), i.frequency, i.amortizationMonths),
    0
  );
  const activeMonthly = items
    .filter((i) => i.isActive)
    .reduce((sum, i) => sum + toMonthly(Number(i.amount), i.frequency, i.amortizationMonths), 0);

  return (
    <div className="mb-6" data-testid={`group-category-${category}`}>
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border rounded-t-md">
        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${CATEGORY_COLORS[category] ?? CATEGORY_COLORS.OTHER}`}>
          {getCategoryLabel(category)}
        </span>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Active: <span className="font-semibold text-foreground">${fmt(activeMonthly)}/mo</span>
          </span>
          <span>
            Total: <span className="font-semibold text-foreground">${fmt(groupMonthly)}/mo</span>
          </span>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Frequency</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Monthly Equiv.</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const monthly = toMonthly(Number(item.amount), item.frequency, item.amortizationMonths);
            return (
              <TableRow key={item.id} data-testid={`row-overhead-${item.id}`}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {getFrequencyLabel(item.frequency)}
                  {item.frequency === "ONE_TIME" && item.amortizationMonths && (
                    <span className="block text-xs text-muted-foreground">
                      ÷ {item.amortizationMonths} mo
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  ${fmt(Number(item.amount))}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  ${fmt(monthly)}/mo
                  {item.frequency === "ONE_TIME" && !item.amortizationMonths && (
                    <span className="text-muted-foreground text-xs ml-1">
                      (÷ {DEFAULT_AMORTIZATION_MONTHS} mo default)
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={item.isActive ? "default" : "secondary"}>
                    {item.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                  {item.notes ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(item)}
                      data-testid={`button-edit-overhead-${item.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDelete(item)}
                      data-testid={`button-delete-overhead-${item.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function PeriodComparisonView({ history }: { history: OverheadHistoryEntry[] }) {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const thisMonthEntries = history.filter((e) => new Date(e.createdAt) >= thisMonthStart);
  const lastMonthEntries = history.filter((e) => {
    const d = new Date(e.createdAt);
    return d >= lastMonthStart && d < thisMonthStart;
  });

  function countActions(entries: OverheadHistoryEntry[]) {
    let creates = 0, updates = 0, deletes = 0;
    for (const e of entries) {
      if (e.action === "CREATE") creates++;
      else if (e.action === "UPDATE") updates++;
      else if (e.action === "DELETE") deletes++;
    }
    return { creates, updates, deletes, total: entries.length };
  }

  function sumAmountChanges(entries: OverheadHistoryEntry[]): number {
    let net = 0;
    for (const e of entries) {
      try {
        if (e.action === "CREATE" && e.newData) {
          net += Number(JSON.parse(e.newData).amount ?? 0);
        } else if (e.action === "DELETE" && e.previousData) {
          net -= Number(JSON.parse(e.previousData).amount ?? 0);
        } else if (e.action === "UPDATE" && e.previousData && e.newData) {
          const prev = Number(JSON.parse(e.previousData).amount ?? 0);
          const next = Number(JSON.parse(e.newData).amount ?? 0);
          net += (next - prev);
        }
      } catch { /* ignore */ }
    }
    return net;
  }

  const thisMonth = countActions(thisMonthEntries);
  const lastMonth = countActions(lastMonthEntries);
  const thisMonthNet = sumAmountChanges(thisMonthEntries);
  const lastMonthNet = sumAmountChanges(lastMonthEntries);

  const thisLabel = thisMonthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const lastLabel = lastMonthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="grid grid-cols-2 gap-4 mb-6" data-testid="period-comparison">
      <div className="p-4 border rounded-md bg-muted/30">
        <p className="text-sm font-medium mb-2">{thisLabel}</p>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{thisMonth.total} changes ({thisMonth.creates} added, {thisMonth.updates} updated, {thisMonth.deletes} removed)</p>
          <p className={`font-mono ${thisMonthNet >= 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
            Net cost change: {thisMonthNet >= 0 ? "+" : ""}${fmt(thisMonthNet)}
          </p>
        </div>
      </div>
      <div className="p-4 border rounded-md bg-muted/30">
        <p className="text-sm font-medium mb-2">{lastLabel}</p>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{lastMonth.total} changes ({lastMonth.creates} added, {lastMonth.updates} updated, {lastMonth.deletes} removed)</p>
          <p className={`font-mono ${lastMonthNet >= 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
            Net cost change: {lastMonthNet >= 0 ? "+" : ""}${fmt(lastMonthNet)}
          </p>
        </div>
      </div>
    </div>
  );
}

function HistorySection() {
  const { data: history = [], isLoading } = useQuery<OverheadHistoryEntry[]>({
    queryKey: ["/api/overhead/history"],
  });

  const actionBadge = (action: string) => {
    switch (action) {
      case "CREATE":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Created</Badge>;
      case "UPDATE":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Updated</Badge>;
      case "DELETE":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Deleted</Badge>;
      default:
        return <Badge variant="secondary">{action}</Badge>;
    }
  };

  function getChangeSummary(entry: OverheadHistoryEntry): string {
    if (entry.action === "CREATE") return "Item created";
    if (entry.action === "DELETE") return "Item removed";
    if (!entry.previousData || !entry.newData) return "Item updated";
    try {
      const prev = JSON.parse(entry.previousData);
      const next = JSON.parse(entry.newData);
      const changes: string[] = [];
      if (prev.amount !== next.amount) changes.push(`amount: $${prev.amount} → $${next.amount}`);
      if (prev.frequency !== next.frequency) changes.push(`frequency: ${prev.frequency} → ${next.frequency}`);
      if (prev.isActive !== next.isActive) changes.push(next.isActive ? "re-activated" : "deactivated");
      if (prev.name !== next.name) changes.push(`name: "${prev.name}" → "${next.name}"`);
      if (prev.category !== next.category) changes.push(`category changed`);
      if (prev.amortizationMonths !== next.amortizationMonths) changes.push(`amortization: ${prev.amortizationMonths ?? "none"} → ${next.amortizationMonths ?? "none"} mo`);
      return changes.length > 0 ? changes.join(", ") : "No visible changes";
    } catch {
      return "Item updated";
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading history...</div>;
  }

  if (history.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No history yet</p>
        <p className="text-sm mt-1">Changes to overhead cost items will appear here</p>
      </div>
    );
  }

  return (
    <div>
      <PeriodComparisonView history={history} />
      <div className="space-y-2" data-testid="overhead-history-list">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-3 p-3 border rounded-md bg-background"
            data-testid={`history-entry-${entry.id}`}
          >
            <div className="pt-0.5">{actionBadge(entry.action)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{entry.itemName}</p>
              <p className="text-xs text-muted-foreground">{getChangeSummary(entry)}</p>
            </div>
            <p className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(entry.createdAt)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryBreakdownSection({ summary }: { summary: OverheadSummary }) {
  const entries = Object.entries(summary.categoryBreakdown)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0) return null;

  const hasWeights = Object.keys(summary.weightedCategoryBreakdown ?? {}).length > 0;

  return (
    <div className="space-y-3" data-testid="category-breakdown-section">
      {entries.map(([cat, monthly]) => {
        const pct = summary.totalMonthly > 0 ? (monthly / summary.totalMonthly) * 100 : 0;
        const weightInfo = summary.weightedCategoryBreakdown?.[cat];
        return (
          <div key={cat} className="flex items-center gap-3" data-testid={`category-bar-${cat}`}>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold min-w-[120px] ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.OTHER}`}>
              {getCategoryLabel(cat)}
            </span>
            <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-primary/60 rounded-full transition-all"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground min-w-[80px] text-right">
              ${fmt(monthly)}/mo
            </span>
            <span className="text-xs text-muted-foreground min-w-[40px] text-right">
              {pct.toFixed(0)}%
            </span>
            {hasWeights && weightInfo && (
              <span className="text-xs font-mono text-muted-foreground min-w-[60px] text-right" data-testid={`weight-${cat}`}>
                @{weightInfo.weight}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OverheadHealthBadge({ summary }: { summary: OverheadSummary }) {
  if (!summary.suggestedPercent) return null;

  const pct = summary.suggestedPercent;
  const critical = summary.overheadCriticalThreshold;
  const warning = summary.overheadWarningThreshold;

  if (critical != null && pct >= critical) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 gap-1" data-testid="badge-overhead-critical">
        <AlertCircle className="h-3 w-3" />
        Critical
      </Badge>
    );
  }

  if (warning != null && pct >= warning) {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 gap-1" data-testid="badge-overhead-warning">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </Badge>
    );
  }

  return (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1" data-testid="badge-overhead-healthy">
      <CheckCircle2 className="h-3 w-3" />
      Healthy
    </Badge>
  );
}

const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function CategoryWeightsSection({
  summary,
  onSave,
  isPending,
}: {
  summary: OverheadSummary | null;
  onSave: (weights: Record<string, number>) => void;
  isPending: boolean;
}) {
  const existingWeights = summary?.categoryWeights ?? {};
  const categoriesInUse = Object.keys(summary?.categoryBreakdown ?? {}).filter(
    (k) => (summary?.categoryBreakdown[k] ?? 0) > 0
  );

  const [weights, setWeights] = useState<Record<string, string>>(() => {
    const w: Record<string, string> = {};
    for (const cat of categoriesInUse) {
      w[cat] = existingWeights[cat] != null ? String(existingWeights[cat]) : "";
    }
    return w;
  });

  function handleSave() {
    const parsed: Record<string, number> = {};
    for (const [cat, val] of Object.entries(weights)) {
      if (val.trim() !== "") {
        const n = Number(val);
        if (!isNaN(n) && n >= 0 && n <= 100) parsed[cat] = n;
      }
    }
    onSave(parsed);
  }

  if (categoriesInUse.length === 0) return null;

  return (
    <div className="mt-6 pt-6 border-t" data-testid="category-weights-section">
      <h3 className="text-sm font-medium mb-3">Category Overhead Weights (%)</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Assign different overhead percentages per cost category. Leave blank to use the default overhead %.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {categoriesInUse.sort().map((cat) => (
          <div key={cat} className="space-y-1">
            <label className="text-xs text-muted-foreground">{getCategoryLabel(cat)}</label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.5"
              placeholder={String(summary?.defaultOverheadPercent ?? 15)}
              value={weights[cat] ?? ""}
              onChange={(e) => setWeights((prev) => ({ ...prev, [cat]: e.target.value }))}
              className="h-8 text-sm"
              data-testid={`input-weight-${cat}`}
            />
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={handleSave}
        disabled={isPending}
        data-testid="button-save-category-weights"
      >
        Save Category Weights
      </Button>
    </div>
  );
}

const QUARTER_KEYS = ["q1", "q2", "q3", "q4"];
const QUARTER_LABELS = ["Q1 (Jan-Mar)", "Q2 (Apr-Jun)", "Q3 (Jul-Sep)", "Q4 (Oct-Dec)"];
const QUARTER_TO_MONTHS: Record<string, string[]> = {
  q1: ["jan", "feb", "mar"],
  q2: ["apr", "may", "jun"],
  q3: ["jul", "aug", "sep"],
  q4: ["oct", "nov", "dec"],
};

function MonthlyRevenueTargetSection({
  summary,
  onSave,
  isPending,
}: {
  summary: OverheadSummary | null;
  onSave: (targets: Record<string, number> | null) => void;
  isPending: boolean;
}) {
  const existing = summary?.monthlyRevenueTargets ?? {};
  const annualFallback = summary?.annualRevenueTarget
    ? Math.round((summary.annualRevenueTarget / 12) * 100) / 100
    : null;

  const [inputMode, setInputMode] = useState<"monthly" | "quarterly">("monthly");

  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const key of MONTH_KEYS) {
      t[key] = existing[key] != null ? String(existing[key]) : "";
    }
    return t;
  });

  const [quarterTargets, setQuarterTargets] = useState<Record<string, string>>(() => {
    const qt: Record<string, string> = {};
    for (const qk of QUARTER_KEYS) {
      const months = QUARTER_TO_MONTHS[qk];
      const firstMonth = months[0];
      qt[qk] = existing[firstMonth] != null ? String(Number(existing[firstMonth]) * 3) : "";
    }
    return qt;
  });

  function handleSave() {
    const parsed: Record<string, number> = {};
    if (inputMode === "monthly") {
      for (const [key, val] of Object.entries(targets)) {
        if (val.trim() !== "") {
          const n = Number(val);
          if (!isNaN(n) && n >= 0) parsed[key] = n;
        }
      }
    } else {
      for (const [qk, val] of Object.entries(quarterTargets)) {
        if (val.trim() !== "") {
          const quarterTotal = Number(val);
          if (!isNaN(quarterTotal) && quarterTotal >= 0) {
            const monthlyVal = Math.round((quarterTotal / 3) * 100) / 100;
            for (const mk of QUARTER_TO_MONTHS[qk]) {
              parsed[mk] = monthlyVal;
            }
          }
        }
      }
    }
    onSave(Object.keys(parsed).length > 0 ? parsed : null);
  }

  function handleDistributeEvenly() {
    if (!summary?.annualRevenueTarget) return;
    const monthly = Math.round((summary.annualRevenueTarget / 12) * 100) / 100;
    const t: Record<string, string> = {};
    for (const key of MONTH_KEYS) {
      t[key] = String(monthly);
    }
    setTargets(t);
    const quarterly = Math.round((summary.annualRevenueTarget / 4) * 100) / 100;
    const qt: Record<string, string> = {};
    for (const qk of QUARTER_KEYS) {
      qt[qk] = String(quarterly);
    }
    setQuarterTargets(qt);
  }

  return (
    <div className="mt-6 pt-6 border-t" data-testid="monthly-revenue-targets-section">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium">Revenue Target Breakdown ($)</h3>
          <p className="text-xs text-muted-foreground">
            Set per-month or per-quarter revenue targets for seasonal adjustments. Leave blank to use annual target ÷ 12.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary?.annualRevenueTarget && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDistributeEvenly}
              className="text-xs"
              data-testid="button-distribute-evenly"
            >
              Distribute Evenly
            </Button>
          )}
          <div className="flex border rounded-md overflow-hidden">
            <Button
              variant={inputMode === "monthly" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-7 text-xs"
              onClick={() => setInputMode("monthly")}
              data-testid="button-mode-monthly"
            >
              Monthly
            </Button>
            <Button
              variant={inputMode === "quarterly" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-7 text-xs"
              onClick={() => setInputMode("quarterly")}
              data-testid="button-mode-quarterly"
            >
              Quarterly
            </Button>
          </div>
        </div>
      </div>

      {inputMode === "monthly" ? (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {MONTH_KEYS.map((key, i) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-muted-foreground">{MONTH_LABELS[i]}</label>
              <Input
                type="number"
                min="0"
                step="1000"
                placeholder={annualFallback != null ? String(annualFallback) : "—"}
                value={targets[key] ?? ""}
                onChange={(e) => setTargets((prev) => ({ ...prev, [key]: e.target.value }))}
                className="h-8 text-sm"
                data-testid={`input-revenue-${key}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {QUARTER_KEYS.map((qk, i) => (
            <div key={qk} className="space-y-1">
              <label className="text-xs text-muted-foreground">{QUARTER_LABELS[i]}</label>
              <Input
                type="number"
                min="0"
                step="1000"
                placeholder={summary?.annualRevenueTarget ? String(Math.round(summary.annualRevenueTarget / 4)) : "—"}
                value={quarterTargets[qk] ?? ""}
                onChange={(e) => setQuarterTargets((prev) => ({ ...prev, [qk]: e.target.value }))}
                className="h-8 text-sm"
                data-testid={`input-revenue-${qk}`}
              />
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={handleSave}
        disabled={isPending}
        data-testid="button-save-monthly-targets"
      >
        Save {inputMode === "monthly" ? "Monthly" : "Quarterly"} Targets
      </Button>
    </div>
  );
}

interface ProjectAllocation {
  projectId: string;
  projectName: string;
  projectCode: string;
  status: string;
  directCost: number;
  sharePercent: number;
  monthlyOverheadAllocation: number;
  annualOverheadAllocation: number;
}

interface ProjectAllocationData {
  totalMonthlyOverhead: number;
  totalAnnualOverhead: number;
  totalDirectCosts: number;
  allocations: ProjectAllocation[];
}

function ProjectAllocationSection() {
  const { data, isLoading } = useQuery<ProjectAllocationData>({
    queryKey: ["/api/overhead/project-allocation"],
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading project allocations...</div>;
  }

  if (!data || data.allocations.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No active projects found</p>
        <p className="text-sm mt-1">Overhead allocation requires active projects with budgets</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="project-allocation-section">
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="p-3 bg-muted/50 rounded-md">
          <p className="text-xs text-muted-foreground">Total Monthly Overhead</p>
          <p className="text-lg font-bold">${fmt(data.totalMonthlyOverhead)}</p>
        </div>
        <div className="p-3 bg-muted/50 rounded-md">
          <p className="text-xs text-muted-foreground">Total Direct Costs</p>
          <p className="text-lg font-bold">${fmt(data.totalDirectCosts)}</p>
        </div>
        <div className="p-3 bg-muted/50 rounded-md">
          <p className="text-xs text-muted-foreground">Active Projects</p>
          <p className="text-lg font-bold">{data.allocations.length}</p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Direct Cost</TableHead>
            <TableHead className="text-right">Share %</TableHead>
            <TableHead className="text-right">Monthly Allocation</TableHead>
            <TableHead className="text-right">Annual Allocation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.allocations.map((alloc) => (
            <TableRow key={alloc.projectId} data-testid={`row-allocation-${alloc.projectId}`}>
              <TableCell>
                <div>
                  <p className="font-medium">{alloc.projectName}</p>
                  <p className="text-xs text-muted-foreground">{alloc.projectCode}</p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{alloc.status}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">${fmt(alloc.directCost)}</TableCell>
              <TableCell className="text-right font-mono text-sm">{alloc.sharePercent}%</TableCell>
              <TableCell className="text-right font-mono text-sm">${fmt(alloc.monthlyOverheadAllocation)}</TableCell>
              <TableCell className="text-right font-mono text-sm">${fmt(alloc.annualOverheadAllocation)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface MonthlyBreakdownEntry {
  month: string;
  monthKey: string;
  overhead: number;
  revenueTarget: number | null;
  overheadPercent: number | null;
}

function MonthlyBreakdownSection() {
  const { data, isLoading } = useQuery<{ months: MonthlyBreakdownEntry[] }>({
    queryKey: ["/api/overhead/monthly-breakdown"],
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading monthly breakdown...</div>;
  }

  if (!data || data.months.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">No data available</div>;
  }

  const maxVal = Math.max(
    ...data.months.map((m) => Math.max(m.overhead, m.revenueTarget ?? 0))
  );

  return (
    <div className="space-y-4" data-testid="monthly-breakdown-section">
      <div className="flex items-end gap-1 h-48" data-testid="monthly-bar-chart">
        {data.months.map((m) => {
          const overheadHeight = maxVal > 0 ? (m.overhead / maxVal) * 100 : 0;
          const revenueHeight = m.revenueTarget && maxVal > 0 ? (m.revenueTarget / maxVal) * 100 : 0;
          return (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5" data-testid={`bar-month-${m.month}`}>
              <div className="w-full flex items-end gap-0.5 h-40">
                <div
                  className="flex-1 bg-orange-400/70 rounded-t transition-all"
                  style={{ height: `${overheadHeight}%` }}
                  title={`Overhead: $${fmt(m.overhead)}`}
                />
                {m.revenueTarget != null && (
                  <div
                    className="flex-1 bg-blue-400/50 rounded-t transition-all"
                    style={{ height: `${revenueHeight}%` }}
                    title={`Revenue Target: $${fmt(m.revenueTarget)}`}
                  />
                )}
              </div>
              <span className="text-[9px] text-muted-foreground text-center leading-tight">
                {m.month.split(" ")[0]}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 justify-center text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-orange-400/70" />
          Monthly Overhead
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-blue-400/50" />
          Revenue Target (÷12)
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Overhead</TableHead>
            <TableHead className="text-right">Revenue Target</TableHead>
            <TableHead className="text-right">Overhead %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.months.map((m) => (
            <TableRow key={m.month}>
              <TableCell className="font-medium">{m.month}</TableCell>
              <TableCell className="text-right font-mono text-sm">${fmt(m.overhead)}</TableCell>
              <TableCell className="text-right font-mono text-sm">
                {m.revenueTarget != null ? `$${fmt(m.revenueTarget)}` : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {m.overheadPercent != null ? `${m.overheadPercent}%` : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function OverheadCostsPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<OverheadCostItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<OverheadCostItem | null>(null);
  const [revenueInput, setRevenueInput] = useState("");
  const [overheadPercentInput, setOverheadPercentInput] = useState("");
  const [warningInput, setWarningInput] = useState("");
  const [criticalInput, setCriticalInput] = useState("");
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [activeTab, setActiveTab] = useState<"costs" | "history" | "breakdown" | "allocation" | "monthly">("costs");

  const { data: items = [], isLoading: itemsLoading } = useQuery<OverheadCostItem[]>({
    queryKey: ["/api/overhead/items"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<OverheadSummary>({
    queryKey: ["/api/overhead/summary"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/overhead/items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/history"] });
      toast({ title: "Cost item deleted" });
      setDeleteItem(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const revenueTargetMutation = useMutation({
    mutationFn: (payload: {
      annualRevenueTarget: number | null;
      defaultOverheadPercent?: number;
      overheadWarningThreshold?: number | null;
      overheadCriticalThreshold?: number | null;
      overheadCategoryWeights?: Record<string, number> | null;
      monthlyRevenueTargets?: Record<string, number> | null;
    }) => apiRequest("PATCH", "/api/overhead/revenue-target", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/summary"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function openAdd() {
    setEditItem(null);
    setDialogOpen(true);
  }

  function openEdit(item: OverheadCostItem) {
    setEditItem(item);
    setDialogOpen(true);
  }

  function handleSaveRevenue() {
    const val = revenueInput.trim() === "" ? null : Number(revenueInput);
    if (val !== null && isNaN(val)) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    revenueTargetMutation.mutate({ annualRevenueTarget: val });
  }

  function handleSetDefaultOverhead() {
    const pct = Number(overheadPercentInput);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast({ title: "Enter a valid percentage (0–100)", variant: "destructive" });
      return;
    }
    revenueTargetMutation.mutate({
      annualRevenueTarget: summary?.annualRevenueTarget ?? null,
      defaultOverheadPercent: pct,
    });
  }

  function handleApplySuggested() {
    if (summary?.suggestedPercent == null) return;
    revenueTargetMutation.mutate({
      annualRevenueTarget: summary.annualRevenueTarget,
      defaultOverheadPercent: summary.suggestedPercent,
    });
    toast({ title: `Default overhead set to ${summary.suggestedPercent}%` });
  }

  function handleSaveThresholds() {
    const w = warningInput.trim() === "" ? null : Number(warningInput);
    const c = criticalInput.trim() === "" ? null : Number(criticalInput);
    if ((w !== null && (isNaN(w) || w < 0 || w > 100)) || (c !== null && (isNaN(c) || c < 0 || c > 100))) {
      toast({ title: "Enter valid percentages (0–100)", variant: "destructive" });
      return;
    }
    revenueTargetMutation.mutate({
      annualRevenueTarget: summary?.annualRevenueTarget ?? null,
      overheadWarningThreshold: w,
      overheadCriticalThreshold: c,
    });
  }

  const filteredItems = filterCategory === "ALL"
    ? items
    : items.filter((i) => i.category === filterCategory);

  const grouped: Record<string, OverheadCostItem[]> = {};
  for (const cat of OVERHEAD_CATEGORIES_VALUES) {
    const group = filteredItems.filter((i) => i.category === cat);
    if (group.length > 0) grouped[cat] = group;
  }
  for (const item of filteredItems) {
    if (!OVERHEAD_CATEGORIES_VALUES.includes(item.category as typeof OVERHEAD_CATEGORIES_VALUES[number])) {
      if (!grouped["OTHER"]) grouped["OTHER"] = [];
      if (!grouped["OTHER"].find((x) => x.id === item.id)) grouped["OTHER"].push(item);
    }
  }

  const categoryTabs = ["ALL", ...CATEGORIES.map((c) => c.value)];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-7 w-7 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold" data-testid="heading-overhead-costs">
                Overhead & Fixed Costs
              </h1>
              {summary && <OverheadHealthBadge summary={summary} />}
            </div>
            <p className="text-sm text-muted-foreground">
              Track recurring company costs to calculate accurate bid overhead percentages
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-monthly-overhead">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-orange-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly Overhead</p>
                <p className="text-2xl font-bold">
                  {summaryLoading ? "—" : `$${fmt(summary?.totalMonthly ?? 0)}`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-annual-overhead">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-blue-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Annual Overhead</p>
                <p className="text-2xl font-bold">
                  {summaryLoading ? "—" : `$${fmt(summary?.totalAnnual ?? 0)}`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-suggested-percent">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Calculator className="h-8 w-8 text-green-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Suggested Overhead %</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">
                    {summaryLoading
                      ? "—"
                      : summary?.suggestedPercent != null
                      ? `${summary.suggestedPercent}%`
                      : "—"}
                  </p>
                  {summary && summary.suggestedPercent != null && (
                    <OverheadHealthBadge summary={summary} />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">of revenue target</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-default-overhead">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <Target className="h-8 w-8 text-purple-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Default Bid Overhead</p>
                <p className="text-2xl font-bold">
                  {summaryLoading ? "—" : `${summary?.defaultOverheadPercent ?? 15}%`}
                </p>
                <p className="text-xs text-muted-foreground">applied to new bids</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overhead Settings</CardTitle>
          <CardDescription>
            Set your annual revenue target to get a calculated overhead percentage recommendation, then apply it to new bids.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Annual Revenue Target ($)</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  step="1000"
                  placeholder={summary?.annualRevenueTarget != null ? String(summary.annualRevenueTarget) : "e.g. 2000000"}
                  value={revenueInput}
                  onChange={(e) => setRevenueInput(e.target.value)}
                  data-testid="input-revenue-target"
                />
                <Button
                  variant="outline"
                  onClick={handleSaveRevenue}
                  disabled={revenueTargetMutation.isPending}
                  data-testid="button-save-revenue-target"
                >
                  Save
                </Button>
              </div>
              {summary?.annualRevenueTarget != null && (
                <p className="text-xs text-muted-foreground">
                  Current: ${fmt(summary.annualRevenueTarget)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Default Overhead % for New Bids</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder={String(summary?.defaultOverheadPercent ?? 15)}
                  value={overheadPercentInput}
                  onChange={(e) => setOverheadPercentInput(e.target.value)}
                  data-testid="input-default-overhead-percent"
                />
                <Button
                  variant="outline"
                  onClick={handleSetDefaultOverhead}
                  disabled={revenueTargetMutation.isPending}
                  data-testid="button-set-default-overhead"
                >
                  Set
                </Button>
              </div>
              {summary?.suggestedPercent != null && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    Suggested: {summary.suggestedPercent}% based on your cost data
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={handleApplySuggested}
                    disabled={revenueTargetMutation.isPending}
                    data-testid="button-apply-suggested"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Apply
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Overhead Health Alerts
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Warning Threshold (%)</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder={summary?.overheadWarningThreshold != null ? String(summary.overheadWarningThreshold) : "e.g. 20"}
                  value={warningInput}
                  onChange={(e) => setWarningInput(e.target.value)}
                  data-testid="input-warning-threshold"
                />
                {summary?.overheadWarningThreshold != null && (
                  <p className="text-xs text-muted-foreground">Current: {summary.overheadWarningThreshold}%</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Critical Threshold (%)</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder={summary?.overheadCriticalThreshold != null ? String(summary.overheadCriticalThreshold) : "e.g. 30"}
                  value={criticalInput}
                  onChange={(e) => setCriticalInput(e.target.value)}
                  data-testid="input-critical-threshold"
                />
                {summary?.overheadCriticalThreshold != null && (
                  <p className="text-xs text-muted-foreground">Current: {summary.overheadCriticalThreshold}%</p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={handleSaveThresholds}
              disabled={revenueTargetMutation.isPending}
              data-testid="button-save-thresholds"
            >
              Save Thresholds
            </Button>
          </div>

          <CategoryWeightsSection summary={summary ?? null} onSave={(weights) => {
            revenueTargetMutation.mutate({
              annualRevenueTarget: summary?.annualRevenueTarget ?? null,
              overheadCategoryWeights: weights,
            });
          }} isPending={revenueTargetMutation.isPending} />

          <MonthlyRevenueTargetSection summary={summary ?? null} onSave={(targets) => {
            revenueTargetMutation.mutate({
              annualRevenueTarget: summary?.annualRevenueTarget ?? null,
              monthlyRevenueTargets: targets,
            });
          }} isPending={revenueTargetMutation.isPending} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          variant={activeTab === "costs" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("costs")}
          data-testid="tab-costs"
        >
          Cost Items
        </Button>
        <Button
          variant={activeTab === "breakdown" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("breakdown")}
          data-testid="tab-breakdown"
        >
          Category Breakdown
        </Button>
        <Button
          variant={activeTab === "allocation" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("allocation")}
          data-testid="tab-allocation"
        >
          Project Allocation
        </Button>
        <Button
          variant={activeTab === "monthly" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("monthly")}
          data-testid="tab-monthly"
        >
          Monthly View
        </Button>
        <Button
          variant={activeTab === "history" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("history")}
          data-testid="tab-history"
        >
          <History className="h-4 w-4 mr-1" />
          History
        </Button>
      </div>

      {activeTab === "costs" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {categoryTabs.map((cat) => (
              <Button
                key={cat}
                type="button"
                variant={filterCategory === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterCategory(cat)}
                data-testid={`filter-category-${cat}`}
              >
                {cat === "ALL" ? "All Categories" : getCategoryLabel(cat)}
              </Button>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Cost Items ({filteredItems.length})</CardTitle>
                <Button onClick={openAdd} data-testid="button-add-overhead-item">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Cost
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {itemsLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading...</div>
              ) : filteredItems.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No overhead costs added yet</p>
                  <p className="text-sm mt-1">Click "Add Cost" to get started</p>
                </div>
              ) : (
                <div data-testid="grouped-overhead-items">
                  {Object.entries(grouped).map(([cat, groupItems]) => (
                    <CategoryGroup
                      key={cat}
                      category={cat}
                      items={groupItems}
                      onEdit={openEdit}
                      onDelete={setDeleteItem}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {filteredItems.length > 0 && (
            <Card className="bg-muted/40">
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <span className="text-muted-foreground">Shown items monthly total: </span>
                    <span className="font-semibold">
                      ${fmt(filteredItems.reduce((sum, i) => sum + toMonthly(Number(i.amount), i.frequency, i.amortizationMonths), 0))}/mo
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Active items only: </span>
                    <span className="font-semibold">
                      ${fmt(filteredItems.filter((i) => i.isActive).reduce((sum, i) => sum + toMonthly(Number(i.amount), i.frequency, i.amortizationMonths), 0))}/mo
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {activeTab === "breakdown" && (
        <Card>
          <CardHeader>
            <CardTitle>Category Breakdown</CardTitle>
            <CardDescription>
              How your overhead costs are distributed across categories
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary ? (
              <CategoryBreakdownSection summary={summary} />
            ) : (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "allocation" && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Project Overhead Allocation</CardTitle>
            <CardDescription>
              How overhead is distributed across active projects based on their share of direct costs (budget or contract amount)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectAllocationSection />
          </CardContent>
        </Card>
      )}

      {activeTab === "monthly" && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly Overhead vs Revenue</CardTitle>
            <CardDescription>
              12-month view comparing monthly overhead costs to revenue target breakdown
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBreakdownSection />
          </CardContent>
        </Card>
      )}

      {activeTab === "history" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Change History
            </CardTitle>
            <CardDescription>
              Audit log of all overhead cost changes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HistorySection />
          </CardContent>
        </Card>
      )}

      {dialogOpen && (
        <ItemDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          editItem={editItem}
        />
      )}

      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent data-testid="dialog-delete-overhead">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cost Item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteItem?.name}</strong> from your overhead costs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              data-testid="button-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

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
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface OverheadCostItem {
  id: string;
  organizationId: string;
  name: string;
  category: string;
  amount: string;
  frequency: string;
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
}

// ── Constants ──────────────────────────────────────────────────────────────

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

function toMonthly(amount: number, frequency: string): number {
  const multipliers: Record<string, number> = {
    MONTHLY: 1,
    QUARTERLY: 1 / 3,
    ANNUAL: 1 / 12,
    ONE_TIME: 0,
  };
  return amount * (multipliers[frequency] ?? 1);
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Form Schema ────────────────────────────────────────────────────────────

const itemFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  category: z.string().min(1, "Category is required"),
  amount: z.coerce.number({ invalid_type_error: "Enter a valid amount" }).nonnegative("Amount must be 0 or more"),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"]),
  effectiveDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.boolean(),
  notes: z.string().optional(),
});
type ItemFormValues = z.infer<typeof itemFormSchema>;

// ── ItemDialog ─────────────────────────────────────────────────────────────

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
          category: editItem.category,
          amount: Number(editItem.amount),
          frequency: editItem.frequency as ItemFormValues["frequency"],
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
          effectiveDate: "",
          endDate: "",
          isActive: true,
          notes: "",
        },
  });

  const createMutation = useMutation({
    mutationFn: (data: ItemFormValues) =>
      apiRequest("POST", "/api/overhead/items", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overhead/summary"] });
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
      toast({ title: "Cost item updated" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(values: ItemFormValues) {
    const payload = {
      ...values,
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

// ── Main Page ──────────────────────────────────────────────────────────────

export default function OverheadCostsPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<OverheadCostItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<OverheadCostItem | null>(null);
  const [revenueInput, setRevenueInput] = useState("");
  const [overheadPercentInput, setOverheadPercentInput] = useState("");
  const [filterCategory, setFilterCategory] = useState("ALL");

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
      toast({ title: "Cost item deleted" });
      setDeleteItem(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const revenueTargetMutation = useMutation({
    mutationFn: (payload: { annualRevenueTarget: number | null; defaultOverheadPercent?: number }) =>
      apiRequest("PATCH", "/api/overhead/revenue-target", payload),
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

  const categories = ["ALL", ...CATEGORIES.map((c) => c.value)];

  const filteredItems = filterCategory === "ALL"
    ? items
    : items.filter((i) => i.category === filterCategory);

  const grouped: Record<string, OverheadCostItem[]> = {};
  for (const item of filteredItems) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="heading-overhead-costs">
              Overhead & Fixed Costs
            </h1>
            <p className="text-sm text-muted-foreground">
              Track recurring company costs to calculate accurate bid overhead percentages
            </p>
          </div>
        </div>
        <Button onClick={openAdd} data-testid="button-add-overhead-item">
          <Plus className="h-4 w-4 mr-2" />
          Add Cost
        </Button>
      </div>

      {/* Summary cards */}
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
                <p className="text-2xl font-bold">
                  {summaryLoading
                    ? "—"
                    : summary?.suggestedPercent != null
                    ? `${summary.suggestedPercent}%`
                    : "—"}
                </p>
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

      {/* Settings panel */}
      <Card>
        <CardHeader>
          <CardTitle>Overhead Settings</CardTitle>
          <CardDescription>
            Set your annual revenue target to get a calculated overhead percentage recommendation, then apply it to new bids.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Revenue target */}
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

            {/* Default overhead */}
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
        </CardContent>
      </Card>

      {/* Category filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {categories.map((cat) => (
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

      {/* Items table */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Items ({filteredItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {itemsLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No overhead costs added yet</p>
              <p className="text-sm mt-1">Click "Add Cost" to get started</p>
            </div>
          ) : (
            <Table data-testid="table-overhead-items">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Monthly Equiv.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const monthly = toMonthly(Number(item.amount), item.frequency);
                  return (
                    <TableRow key={item.id} data-testid={`row-overhead-${item.id}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.OTHER}`}>
                          {getCategoryLabel(item.category)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getFrequencyLabel(item.frequency)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ${fmt(Number(item.amount))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {item.frequency === "ONE_TIME" ? "—" : `$${fmt(monthly)}/mo`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.isActive ? "default" : "secondary"}>
                          {item.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(item)}
                            data-testid={`button-edit-overhead-${item.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteItem(item)}
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
          )}
        </CardContent>
      </Card>

      {/* Monthly breakdown footer */}
      {filteredItems.length > 0 && (
        <Card className="bg-muted/40">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Shown items monthly total: </span>
                <span className="font-semibold">
                  ${fmt(filteredItems.reduce((sum, i) => sum + toMonthly(Number(i.amount), i.frequency), 0))}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Active items only: </span>
                <span className="font-semibold">
                  ${fmt(filteredItems.filter(i => i.isActive).reduce((sum, i) => sum + toMonthly(Number(i.amount), i.frequency), 0))}/mo
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit dialog */}
      {dialogOpen && (
        <ItemDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          editItem={editItem}
        />
      )}

      {/* Delete confirmation */}
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

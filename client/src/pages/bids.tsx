import { useState, useMemo } from "react";
import BidCard from "@/components/BidCard";
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Plus,
  AlertTriangle,
  Trash2,
  Filter,
  X,
  Calendar,
  Wand2,
  UserCog,
  ChevronDown,
  FileEdit,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canEditBids, canDeleteBids } from "@/lib/rbac";
import {
  useBids,
  useConvertBidToProject,
  useCreateBid,
  useDeleteBid,
} from "@/hooks/use-data";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  format,
  isAfter,
  isBefore,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  parseISO,
} from "date-fns";
import { FormDatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";
import type {
  Bid,
  CrmOrganisation,
  CrmContact,
  SelectUser,
} from "@shared/schema";
import { insertBidSchema } from "@shared/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Label } from "@/components/ui/label";

// Extended bid type with estimate summary and estimator name
type BidWithEstimate = Bid & {
  estimateSummary: {
    totalCost: number;
    lineItemCount: number;
    status: string;
  } | null;
  estimatorName: string | null;
};
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";

// Due date filter options
const DUE_DATE_FILTERS = [
  { value: "ALL", label: "All Due Dates" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "THIS_WEEK", label: "Due This Week" },
  { value: "THIS_MONTH", label: "Due This Month" },
  { value: "NO_DATE", label: "No Due Date" },
];

// Estimate status filter options
const ESTIMATE_STATUS_FILTERS = [
  { value: "ALL", label: "All Statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "PENDING_APPROVAL", label: "Pending Approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
];

export default function BidsPage() {
  const [, setLocation] = useLocation();
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [dueDateFilter, setDueDateFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [estimatorFilter, setEstimatorFilter] = useState("ALL");
  const [showBudgetWarning, setShowBudgetWarning] = useState(false);
  const [pendingConversionBidCode, setPendingConversionBidCode] = useState<
    string | null
  >(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAwardDialog, setShowAwardDialog] = useState(false);
  const [awardBidCode, setAwardBidCode] = useState<string | null>(null);
  const [selectedSuperintendentId, setSelectedSuperintendentId] =
    useState<string>("");
  const [selectedProjectManagerId, setSelectedProjectManagerId] =
    useState<string>("");

  const { data: bidsData = [], isLoading } = useBids();

  // Fetch users for estimator filter
  const { data: users = [] } = useQuery<SelectUser[]>({
    queryKey: ["/api/users"],
  });
  const convertBid = useConvertBidToProject();
  const createBid = useCreateBid();
  const deleteBid = useDeleteBid();

  // Filter active superintendents and managers for team assignment
  const superintendents = users.filter(
    (u: SelectUser) =>
      u.isActive &&
      (u.role === "SUPERINTENDENT" ||
        u.role === "MANAGER" ||
        u.role === "ADMIN"),
  );
  const managers = users.filter(
    (u: SelectUser) =>
      u.isActive && (u.role === "MANAGER" || u.role === "ADMIN"),
  );

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bidToDelete, setBidToDelete] = useState<{
    code: string;
    name: string;
  } | null>(null);

  // CRM integration state
  const [selectedGcOrg, setSelectedGcOrg] = useState<CrmOrganisation | null>(
    null,
  );
  const [selectedGcContact, setSelectedGcContact] = useState<CrmContact | null>(
    null,
  );
  const [selectedOwnerRepOrg, setSelectedOwnerRepOrg] =
    useState<CrmOrganisation | null>(null);
  const [selectedOwnerRepContact, setSelectedOwnerRepContact] =
    useState<CrmContact | null>(null);

  // Cast to extended type with estimate summary
  const bids = bidsData as BidWithEstimate[];

  // Create schema without code - code is auto-generated on the backend
  const createBidFormSchema = insertBidSchema.omit({ code: true });
  type CreateBidFormInput = z.infer<typeof createBidFormSchema>;

  const form = useForm<CreateBidFormInput>({
    resolver: zodResolver(createBidFormSchema),
    defaultValues: {
      name: "",
      clientName: "",
      clientContactName: "",
      clientContactEmail: "",
      clientContactPhone: "",
      bidAmount: "",
      dueDate: undefined,
      locationAddress: "",
      city: "",
      state: "",
      description: "",
      estimatorId: user?.id || undefined,
      gcOrganizationId: undefined,
      ownerRepOrganizationId: undefined,
    },
  });

  // Handle GC organization selection - auto-populate client fields
  const handleGcSelect = (org: CrmOrganisation | null) => {
    const previousOrgId = selectedGcOrg?.id;
    setSelectedGcOrg(org);

    // Always clear contact when org changes (different org or deselected)
    if (!org || org.id !== previousOrgId) {
      setSelectedGcContact(null);
      form.setValue("clientContactName", "");
      form.setValue("clientContactEmail", "");
      form.setValue("clientContactPhone", "");
    }

    if (org) {
      form.setValue("gcOrganizationId", org.id);
      form.setValue("clientName", org.name);
    } else {
      form.setValue("gcOrganizationId", undefined);
      form.setValue("clientName", "");
    }
  };

  // Handle GC contact selection - auto-populate contact fields
  const handleGcContactSelect = (contact: CrmContact | null) => {
    setSelectedGcContact(contact);
    if (contact) {
      const fullName = `${contact.firstName} ${contact.lastName}`.trim();
      form.setValue("clientContactName", fullName);
      form.setValue("clientContactEmail", contact.email || "");
      form.setValue(
        "clientContactPhone",
        contact.phone || contact.mobile || "",
      );
    } else {
      form.setValue("clientContactName", "");
      form.setValue("clientContactEmail", "");
      form.setValue("clientContactPhone", "");
    }
  };

  // Handle Owner Rep organization selection
  const handleOwnerRepSelect = (org: CrmOrganisation | null) => {
    const previousOrgId = selectedOwnerRepOrg?.id;
    setSelectedOwnerRepOrg(org);

    // Always clear contact when org changes (different org or deselected)
    if (!org || org.id !== previousOrgId) {
      setSelectedOwnerRepContact(null);
    }

    if (org) {
      form.setValue("ownerRepOrganizationId", org.id);
    } else {
      form.setValue("ownerRepOrganizationId", undefined);
    }
  };

  // Handle Owner Rep contact selection
  const handleOwnerRepContactSelect = (contact: CrmContact | null) => {
    setSelectedOwnerRepContact(contact);
  };

  // Reset form and CRM state
  const resetFormAndCrmState = () => {
    form.reset();
    setSelectedGcOrg(null);
    setSelectedGcContact(null);
    setSelectedOwnerRepOrg(null);
    setSelectedOwnerRepContact(null);
  };

  // Handle dialog open/close
  const handleDialogOpenChange = (open: boolean) => {
    setShowCreateDialog(open);
    if (!open) {
      resetFormAndCrmState();
    }
  };

  const filteredBids = useMemo(() => {
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);

    return bids.filter((bid) => {
      // Search filter
      const matchesSearch =
        bid.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bid.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bid.clientName.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      // Due date filter
      if (dueDateFilter !== "ALL") {
        const dueDate = bid.dueDate ? new Date(bid.dueDate) : null;

        switch (dueDateFilter) {
          case "OVERDUE":
            if (!dueDate || !isBefore(dueDate, today)) return false;
            break;
          case "THIS_WEEK":
            if (
              !dueDate ||
              isBefore(dueDate, weekStart) ||
              isAfter(dueDate, weekEnd)
            )
              return false;
            break;
          case "THIS_MONTH":
            if (
              !dueDate ||
              isBefore(dueDate, monthStart) ||
              isAfter(dueDate, monthEnd)
            )
              return false;
            break;
          case "NO_DATE":
            if (dueDate) return false;
            break;
        }
      }

      // Estimate status filter
      if (statusFilter !== "ALL") {
        const estimateStatus = bid.estimateSummary?.status;
        if (estimateStatus !== statusFilter) return false;
      }

      // Estimator filter
      if (estimatorFilter !== "ALL") {
        if (bid.estimatorId !== estimatorFilter) return false;
      }

      return true;
    });
  }, [bids, searchTerm, dueDateFilter, statusFilter, estimatorFilter]);

  const handleConvertToProject = async (bidCode: string) => {
    const bid = bids.find((b) => b.code === bidCode);
    if (bid && (!bid.bidAmount || parseFloat(bid.bidAmount) === 0)) {
      setPendingConversionBidCode(bidCode);
      setShowBudgetWarning(true);
      return;
    }

    setAwardBidCode(bidCode);
    setSelectedSuperintendentId("");
    setSelectedProjectManagerId("");
    setShowAwardDialog(true);
  };

  const performConversion = async (bidCode: string) => {
    try {
      await convertBid.mutateAsync({
        code: bidCode,
        superintendentId: selectedSuperintendentId || undefined,
        projectManagerId: selectedProjectManagerId || undefined,
      });
      toast({
        title: "Bid Awarded!",
        description: `Bid ${bidCode} has been marked as awarded and converted to an active project.`,
      });
      setShowAwardDialog(false);
      setAwardBidCode(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to convert bid to project",
        variant: "destructive",
      });
    }
  };

  const handleCreateBid = async (data: CreateBidFormInput) => {
    try {
      // Clean up empty string values to undefined for optional fields
      const cleanedData = {
        ...data,
        clientContactName: data.clientContactName || undefined,
        clientContactEmail: data.clientContactEmail || undefined,
        clientContactPhone: data.clientContactPhone || undefined,
        bidAmount: data.bidAmount || undefined,
        locationAddress: data.locationAddress || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        description: data.description || undefined,
        estimatorId: data.estimatorId || undefined,
        gcOrganizationId: selectedGcOrg?.id || undefined,
        ownerRepOrganizationId: selectedOwnerRepOrg?.id || undefined,
      };

      const newBid = await createBid.mutateAsync(cleanedData);
      toast({
        title: "Success",
        description: `Bid ${newBid.code} has been created successfully!`,
      });
      setShowCreateDialog(false);
      resetFormAndCrmState();
      // Navigate to the new bid detail page using the auto-generated code
      setLocation(`/bids/${newBid.code}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create bid",
        variant: "destructive",
      });
    }
  };

  const handleDeleteBid = async (code: string, name: string) => {
    setBidToDelete({ code, name });
    setShowDeleteConfirm(true);
  };

  const confirmDeleteBid = async () => {
    if (!bidToDelete) return;

    try {
      await deleteBid.mutateAsync(bidToDelete.code);
      toast({
        title: "Success",
        description: `Bid ${bidToDelete.code} has been deleted.`,
      });
      setShowDeleteConfirm(false);
      setBidToDelete(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete bid",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-3 py-4 sm:px-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              Bid Board
            </h1>
            <p className="text-sm text-muted-foreground">
              Track opportunities and bids in progress
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AIAnalysisButton module="BIDS" />
            {canEditBids(user?.role) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button data-testid="button-new-bid">
                    <Plus className="w-4 h-4 mr-2" />
                    New Bid
                    <ChevronDown className="w-4 h-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem
                    onClick={() => setLocation("/bids/new")}
                    className="cursor-pointer py-3"
                    data-testid="menu-item-ai-bid"
                  >
                    <Wand2 className="w-4 h-4 mr-3 text-primary" />
                    <div>
                      <div className="font-medium">AI-Enhanced Bid Wizard</div>
                      <div className="text-xs text-muted-foreground">
                        AI analyzes documents & extracts scope
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowCreateDialog(true)}
                    className="cursor-pointer py-3"
                    data-testid="menu-item-manual-bid"
                  >
                    <FileEdit className="w-4 h-4 mr-3 text-muted-foreground" />
                    <div>
                      <div className="font-medium">Manual Bid Entry</div>
                      <div className="text-xs text-muted-foreground">
                        Enter bid details & line items manually
                      </div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="mb-6 space-y-4">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search bids by name, code, or client..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-bids"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Select value={dueDateFilter} onValueChange={setDueDateFilter}>
                <SelectTrigger
                  className="w-full sm:w-[160px]"
                  data-testid="select-due-date-filter"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Due Date" />
                </SelectTrigger>
                <SelectContent>
                  {DUE_DATE_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger
                  className="w-full sm:w-[160px]"
                  data-testid="select-status-filter"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {ESTIMATE_STATUS_FILTERS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={estimatorFilter}
                onValueChange={setEstimatorFilter}
              >
                <SelectTrigger
                  className="w-full sm:w-[180px]"
                  data-testid="select-estimator-filter"
                >
                  <SelectValue placeholder="Estimator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Estimators</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} - {u.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active filter badges */}
          {(dueDateFilter !== "ALL" ||
            statusFilter !== "ALL" ||
            estimatorFilter !== "ALL") && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Active filters:
              </span>
              {dueDateFilter !== "ALL" && (
                <Badge variant="secondary" className="gap-1">
                  {
                    DUE_DATE_FILTERS.find((f) => f.value === dueDateFilter)
                      ?.label
                  }
                  <X
                    className="w-3 h-3 cursor-pointer"
                    onClick={() => setDueDateFilter("ALL")}
                    data-testid="button-clear-due-date-filter"
                  />
                </Badge>
              )}
              {statusFilter !== "ALL" && (
                <Badge variant="secondary" className="gap-1">
                  {
                    ESTIMATE_STATUS_FILTERS.find(
                      (f) => f.value === statusFilter,
                    )?.label
                  }
                  <X
                    className="w-3 h-3 cursor-pointer"
                    onClick={() => setStatusFilter("ALL")}
                    data-testid="button-clear-status-filter"
                  />
                </Badge>
              )}
              {estimatorFilter !== "ALL" && (
                <Badge variant="secondary" className="gap-1">
                  {users.find((u) => u.id === estimatorFilter)?.firstName}{" "}
                  {users.find((u) => u.id === estimatorFilter)?.lastName}
                  <X
                    className="w-3 h-3 cursor-pointer"
                    onClick={() => setEstimatorFilter("ALL")}
                    data-testid="button-clear-estimator-filter"
                  />
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDueDateFilter("ALL");
                  setStatusFilter("ALL");
                  setEstimatorFilter("ALL");
                }}
                data-testid="button-clear-all-filters"
              >
                Clear all
              </Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Loading bids...
          </div>
        ) : filteredBids.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchTerm ||
            dueDateFilter !== "ALL" ||
            statusFilter !== "ALL" ||
            estimatorFilter !== "ALL"
              ? "No bids match your filters"
              : "No bids found. Click 'New Bid' to create your first bid."}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredBids.map((bid) => (
              <BidCard
                key={bid.id}
                code={bid.code}
                name={bid.name}
                clientName={bid.clientName}
                bidAmount={
                  bid.bidAmount
                    ? `$${Number(bid.bidAmount).toLocaleString()}`
                    : "TBD"
                }
                dueDate={
                  bid.dueDate
                    ? format(new Date(bid.dueDate), "yyyy-MM-dd")
                    : undefined
                }
                location={
                  [bid.city, bid.state].filter(Boolean).join(", ") ||
                  bid.locationAddress ||
                  undefined
                }
                estimator={bid.estimatorName || "Unassigned"}
                status={
                  bid.status as
                    | "DRAFT"
                    | "ACTIVE"
                    | "AWARDED"
                    | "LOST"
                    | "CANCELLED"
                }
                onClick={() => setLocation(`/bids/${bid.code}`)}
                onConvertToProject={
                  canEditBids(user?.role)
                    ? () => handleConvertToProject(bid.code)
                    : undefined
                }
                onDelete={
                  canDeleteBids(user?.role)
                    ? () => handleDeleteBid(bid.code, bid.name)
                    : undefined
                }
                estimateData={bid.estimateSummary}
              />
            ))}
          </div>
        )}
      </main>

      {/* Award & Assign Team Dialog */}
      <Dialog open={showAwardDialog} onOpenChange={setShowAwardDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Award Bid & Assign Team
            </DialogTitle>
            <DialogDescription>
              Convert this bid to an active project and assign the team members
              who will be responsible for it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {awardBidCode && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium">
                  Bid: {bids.find((b) => b.code === awardBidCode)?.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Code: {awardBidCode}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="list-superintendent">Superintendent</Label>
              <Select
                value={selectedSuperintendentId}
                onValueChange={(val) =>
                  setSelectedSuperintendentId(val === "none" ? "" : val)
                }
              >
                <SelectTrigger
                  id="list-superintendent"
                  data-testid="select-list-superintendent"
                >
                  <SelectValue placeholder="Select superintendent (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {superintendents.map((u: SelectUser) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="list-project-manager">Project Manager</Label>
              <Select
                value={selectedProjectManagerId}
                onValueChange={(val) =>
                  setSelectedProjectManagerId(val === "none" ? "" : val)
                }
              >
                <SelectTrigger
                  id="list-project-manager"
                  data-testid="select-list-project-manager"
                >
                  <SelectValue placeholder="Select project manager (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {managers.map((u: SelectUser) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAwardDialog(false)}
              data-testid="button-cancel-list-award"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (awardBidCode) {
                  await performConversion(awardBidCode);
                }
              }}
              disabled={convertBid.isPending}
              data-testid="button-confirm-list-award"
            >
              {convertBid.isPending
                ? "Converting..."
                : "Award & Convert to Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Budget Warning Dialog */}
      <AlertDialog open={showBudgetWarning} onOpenChange={setShowBudgetWarning}>
        <AlertDialogContent data-testid="dialog-budget-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Missing Budget Data
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This bid does not have a bid amount entered. Converting to a
                project without budget data will:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Prevent accurate profitability tracking</li>
                <li>Limit AI analysis capabilities</li>
                <li>Reduce data quality score</li>
                <li>Make financial reporting incomplete</li>
              </ul>
              <p className="mt-3 font-medium">
                Are you sure you want to proceed without budget data?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-conversion">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConversionBidCode) {
                  setAwardBidCode(pendingConversionBidCode);
                  setSelectedSuperintendentId("");
                  setSelectedProjectManagerId("");
                  setShowAwardDialog(true);
                  setPendingConversionBidCode(null);
                }
                setShowBudgetWarning(false);
              }}
              data-testid="button-confirm-conversion"
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Bid Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          data-testid="dialog-create-bid"
        >
          <DialogHeader>
            <DialogTitle>Create New Bid</DialogTitle>
            <DialogDescription>
              Enter the basic information for the new bid opportunity.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleCreateBid)}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Bid Name *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Downtown Office Renovation"
                          {...field}
                          data-testid="input-bid-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Due Date</FormLabel>
                      <FormDatePicker
                        field={field}
                        placeholder="Pick a date"
                        outputFormat="date"
                        data-testid="input-bid-due-date"
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="col-span-2 space-y-4 border rounded-md p-4 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      CRM Integration
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Select from CRM to auto-fill client info
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm">GC / General Contractor</Label>
                      <CrmOrganizationSelector
                        value={selectedGcOrg?.id}
                        onSelect={handleGcSelect}
                        onContactSelect={handleGcContactSelect}
                        filterTypes={["CONTRACTOR"]}
                        placeholder="Select GC..."
                        showContactSelector={true}
                        selectedContactId={selectedGcContact?.id}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">Owner Representative</Label>
                      <CrmOrganizationSelector
                        value={selectedOwnerRepOrg?.id}
                        onSelect={handleOwnerRepSelect}
                        onContactSelect={handleOwnerRepContactSelect}
                        filterTypes={["OWNER_REP"]}
                        placeholder="Select Owner Rep..."
                        showContactSelector={true}
                        selectedContactId={selectedOwnerRepContact?.id}
                      />
                    </div>
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Client Name *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., ABC Corporation"
                          {...field}
                          data-testid="input-client-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientContactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., John Smith"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-contact-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientContactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="john@example.com"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-contact-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientContactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="(555) 123-4567"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-contact-phone"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bidAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bid Amount</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-bid-amount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="locationAddress"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Location Address</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="123 Main St"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-location-address"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., Seattle"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-city"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g., WA"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-state"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Brief description of the project scope..."
                          className="min-h-[100px]"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                  data-testid="button-cancel-create"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createBid.isPending}
                  data-testid="button-submit-create"
                >
                  {createBid.isPending ? "Creating..." : "Create Bid"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-bid">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Delete Bid
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete bid{" "}
              <strong>{bidToDelete?.code}</strong> ({bidToDelete?.name})?
              <br />
              <br />
              This action cannot be undone. All associated estimates, quotes,
              and documents will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setBidToDelete(null)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteBid}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteBid.isPending ? "Deleting..." : "Delete Bid"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

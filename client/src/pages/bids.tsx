import { useState, useMemo, lazy, Suspense, useRef } from "react";
import { useTableKeyboardNav } from "@/hooks/use-table-keyboard-nav";
import { useGlobalSearchFocus } from "@/hooks/use-global-search-focus";
import { useRegisterShortcuts, TABLE_NAV_SHORTCUTS } from "@/components/KeyboardShortcutsHelp";
import BidsTable from "@/components/BidsTable";
import ViewSwitcher, { type ViewType } from "@/components/ViewSwitcher";
import SavedViewsDropdown, { type AppliedView, type BuiltInView } from "@/components/SavedViewsDropdown";
import BidsKanbanView from "@/components/BidsKanbanView";
import EntityCalendarView, { type CalendarEntityItem } from "@/components/EntityCalendarView";
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { AIBidAnalysisPanel } from "@/components/AIBidAnalysisPanel";
import { AIFeatureTrigger } from "@/components/AIFeatureDialog";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Inbox,
  Sparkles,
  Loader2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canEditBids, canDeleteBids, canAccessBidNetworkAsSub } from "@/lib/rbac";

const BidInboxPage = lazy(() => import("@/pages/bid-inbox"));
import {
  useBids,
  useConvertBidToProject,
  useDeleteBid,
} from "@/hooks/use-data";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
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
import { EmptyState } from "@/components/EmptyState";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AIExtractedItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  notes?: string;
  selected: boolean;
  unitMaterialCost?: number | null;
  unitLaborCost?: number | null;
}

interface AITextAnalysisResult {
  projectName?: string;
  clientName?: string;
  clientContactName?: string;
  clientContactEmail?: string;
  clientContactPhone?: string;
  dueDate?: string;
  locationAddress?: string;
  city?: string;
  state?: string;
  description?: string;
  estimatedValue?: number;
  scopeItems: Array<{
    description: string;
    quantity: number;
    unit: string;
    category: string;
    notes?: string;
  }>;
  keyRequirements?: string[];
  specialConditions?: string[];
  aiError?: boolean;
  message?: string;
}

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
import { ToastAction } from "@/components/ui/toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";

// Due date filter options
const DUE_DATE_FILTERS = [
  { value: "ALL", label: "All Due Dates" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "THIS_WEEK", label: "Due This Week" },
  { value: "THIS_MONTH", label: "Due This Month" },
  { value: "NO_DATE", label: "No Due Date" },
];

interface BidsFilterState {
  search: string;
  dueDate: string;
  status: string;
  estimator: string;
}

const BIDS_DEFAULT_FILTERS: BidsFilterState = {
  search: "",
  dueDate: "ALL",
  status: "ALL",
  estimator: "ALL",
};

const BIDS_BUILT_IN_VIEWS: BuiltInView<BidsFilterState>[] = [
  { id: "builtin-all-bids", name: "All bids", apply: { view: "table", filters: BIDS_DEFAULT_FILTERS } },
  { id: "builtin-due-this-week", name: "Due this week", apply: { view: "calendar", filters: { ...BIDS_DEFAULT_FILTERS, dueDate: "THIS_WEEK" } } },
  { id: "builtin-overdue-bids", name: "Overdue", apply: { view: "table", filters: { ...BIDS_DEFAULT_FILTERS, dueDate: "OVERDUE" } } },
  { id: "builtin-pending-bids", name: "Pending approval", apply: { view: "kanban", filters: { ...BIDS_DEFAULT_FILTERS, status: "PENDING_APPROVAL" } } },
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [dueDateFilter, setDueDateFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [estimatorFilter, setEstimatorFilter] = useState("ALL");
  const [bidsView, setBidsView] = useState<ViewType>(() => {
    if (typeof window === "undefined") return "table";
    const saved = window.localStorage.getItem("bids-view");
    return saved === "kanban" || saved === "calendar" || saved === "table" ? (saved as ViewType) : "table";
  });
  const handleBidsViewChange = (v: ViewType) => {
    setBidsView(v);
    if (typeof window !== "undefined") window.localStorage.setItem("bids-view", v);
  };
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
  const [awardOverheadPercent, setAwardOverheadPercent] = useState<string>("10");
  const [awardProfitPercent, setAwardProfitPercent] = useState<string>("15");
  const [awardStartStatus, setAwardStartStatus] = useState<"ACTIVE" | "PLANNING">("ACTIVE");

  const { data: bidsData = [], isLoading } = useBids();

  // Fetch users for estimator filter
  const { data: users = [] } = useQuery<SelectUser[]>({
    queryKey: ["/api/users"],
  });
  const convertBid = useConvertBidToProject();
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

  const [manualBidStep, setManualBidStep] = useState(1);
  const [projectDescription, setProjectDescription] = useState("");
  const [scopeItems, setScopeItems] = useState<AIExtractedItem[]>([]);
  const [customItems, setCustomItems] = useState<AIExtractedItem[]>([]);
  const [newItemDescription, setNewItemDescription] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("");

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
      wageDecision: "",
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
    setManualBidStep(1);
    setProjectDescription("");
    setScopeItems([]);
    setCustomItems([]);
    setNewItemDescription("");
    setNewItemQuantity("");
    setNewItemUnit("");
  };

  // Handle dialog open/close
  const handleDialogOpenChange = (open: boolean) => {
    setShowCreateDialog(open);
    if (!open) {
      resetFormAndCrmState();
    }
  };

  const toggleScopeItem = (itemId: string) => {
    setScopeItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, selected: !item.selected } : item
    ));
  };

  const updateScopeItem = (itemId: string, field: 'quantity' | 'unit', value: string) => {
    setScopeItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      if (field === 'quantity') {
        const parsed = parseFloat(value);
        return { ...item, quantity: Number.isFinite(parsed) ? parsed : 0 };
      }
      return { ...item, [field]: value };
    }));
  };

  const addCustomItem = () => {
    if (!newItemDescription.trim()) return;
    const parsedQty = parseFloat(newItemQuantity);
    const safeQuantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
    const newItem: AIExtractedItem = {
      id: `custom-${Date.now()}`,
      description: newItemDescription.trim(),
      quantity: safeQuantity,
      unit: newItemUnit || "EA",
      category: "CUSTOM",
      selected: true,
    };
    setCustomItems(prev => [...prev, newItem]);
    setNewItemDescription("");
    setNewItemQuantity("");
    setNewItemUnit("");
  };

  const removeCustomItem = (itemId: string) => {
    setCustomItems(prev => prev.filter(i => i.id !== itemId));
  };

  const analyzeTextMutation = useMutation({
    mutationFn: async (description: string) => {
      const response = await apiRequest("POST", "/api/ai-bid-wizard/analyze-text", { description });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(errorData.error || 'Failed to analyze text');
      }
      return response.json() as Promise<AITextAnalysisResult>;
    },
    onSuccess: (data) => {
      const items = (data.scopeItems || []).map((item: any, idx: number) => ({
        ...item,
        id: `ai-${idx}`,
        quantity: typeof item.quantity === 'number' && !isNaN(item.quantity) ? item.quantity : 1,
        unit: item.unit || 'EA',
        category: item.category || 'GENERAL',
        selected: true,
      }));
      setScopeItems(items);

      if (data.projectName) form.setValue("name", data.projectName);
      if (data.clientName) form.setValue("clientName", data.clientName);
      if (data.clientContactName) form.setValue("clientContactName", data.clientContactName);
      if (data.clientContactEmail) form.setValue("clientContactEmail", data.clientContactEmail);
      if (data.clientContactPhone) form.setValue("clientContactPhone", data.clientContactPhone);
      if (data.dueDate) form.setValue("dueDate", new Date(data.dueDate));
      if (data.locationAddress) form.setValue("locationAddress", data.locationAddress);
      if (data.city) form.setValue("city", data.city);
      if (data.state) form.setValue("state", data.state);
      if (data.description) form.setValue("description", data.description);
      if (data.estimatedValue) form.setValue("bidAmount", String(data.estimatedValue));

      if (data.aiError) {
        toast({
          title: "AI analysis incomplete",
          description: data.message || "You can enter information manually.",
        });
      } else {
        toast({ title: "Analysis complete", description: `Found ${items.length} scope items` });
      }

      setManualBidStep(2);
    },
    onError: (error: any) => {
      toast({
        title: "Analysis failed",
        description: error.message || "Failed to analyze text. You can still proceed manually.",
        variant: "destructive",
      });
      setManualBidStep(2);
    },
  });

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
    if (bid?.status === "AWARDED") {
      toast({
        title: "Already converted",
        description: bid.convertedToProjectId
          ? `Bid ${bidCode} has already been converted to project ${bidCode}.`
          : `Bid ${bidCode} has already been awarded.`,
      });
      if (bid.convertedToProjectId) {
        setLocation(`/projects/${bidCode}`);
      }
      return;
    }
    if (bid && (!bid.bidAmount || parseFloat(bid.bidAmount) === 0)) {
      setPendingConversionBidCode(bidCode);
      setShowBudgetWarning(true);
      return;
    }

    setAwardBidCode(bidCode);
    setSelectedSuperintendentId("");
    setSelectedProjectManagerId("");
    setAwardOverheadPercent("10");
    setAwardProfitPercent("15");
    setAwardStartStatus("ACTIVE");
    setShowAwardDialog(true);
  };

  const performConversion = async (bidCode: string) => {
    try {
      const newProject = await convertBid.mutateAsync({
        code: bidCode,
        superintendentId: selectedSuperintendentId || undefined,
        projectManagerId: selectedProjectManagerId || undefined,
        overheadPercent: parseFloat(awardOverheadPercent) || 10,
        profitPercent: parseFloat(awardProfitPercent) || 15,
        startStatus: awardStartStatus,
      });
      const statusLabel = awardStartStatus === "PLANNING" ? "a Planning project" : "an Active project";
      toast({
        title: "Bid Awarded!",
        description: `Bid ${bidCode} has been converted to ${statusLabel}.`,
      });
      setShowAwardDialog(false);
      setAwardBidCode(null);
      if (newProject?.code) {
        setLocation(`/projects/${newProject.code}`);
      } else {
        toast({
          title: "Project created",
          description: "Navigate to Projects to find your new project.",
        });
        setLocation("/projects");
      }
    } catch (error: any) {
      const isAlreadyAwarded =
        error.message?.includes("Bid already awarded") ||
        error.status === 409;
      if (isAlreadyAwarded) {
        const bid = bids.find((b) => b.code === bidCode);
        toast({
          title: "Already converted",
          description: bid?.convertedToProjectId
            ? `Bid ${bidCode} has already been converted to project ${bidCode}.`
            : `Bid ${bidCode} has already been awarded.`,
          action: bid?.convertedToProjectId ? (
            <ToastAction
              altText="View Project"
              onClick={() => {
                setShowAwardDialog(false);
                setLocation(`/projects/${bidCode}`);
              }}
            >
              View Project
            </ToastAction>
          ) : undefined,
        });
        setShowAwardDialog(false);
        setAwardBidCode(null);
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to convert bid to project",
          variant: "destructive",
        });
      }
    }
  };

  const createBidWithEstimateMutation = useMutation({
    mutationFn: async (data: CreateBidFormInput) => {
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
        wageDecision: data.wageDecision || undefined,
        estimatorId: data.estimatorId || undefined,
        gcOrganizationId: selectedGcOrg?.id || undefined,
        ownerRepOrganizationId: selectedOwnerRepOrg?.id || undefined,
      };

      const selectedScopeItems = [...scopeItems.filter(i => i.selected), ...customItems];

      const response = await apiRequest("POST", "/api/bids", cleanedData);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to create bid' }));
        throw new Error(errorData.message || 'Failed to create bid');
      }
      const bid = await response.json();

      const estimateResponse = await apiRequest("POST", `/api/bids/${bid.id}/estimate`);
      if (!estimateResponse.ok) {
        const errorData = await estimateResponse.json().catch(() => ({ message: 'Failed to create estimate' }));
        throw new Error(errorData.message || 'Failed to create estimate for bid.');
      }
      const estimate = await estimateResponse.json();

      const validCategories = ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL"];
      const mapCategory = (cat: string | undefined) => {
        if (!cat) return "GENERAL";
        const upper = cat.toUpperCase();
        return validCategories.includes(upper) ? upper : "GENERAL";
      };

      if (selectedScopeItems.length > 0 && estimate?.id) {
        const failedItems: string[] = [];
        for (const item of selectedScopeItems) {
          const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
          const lineItemData = {
            description: item.description,
            quantity: qty.toString(),
            unit: item.unit || 'EA',
            category: mapCategory(item.category),
            notes: item.notes,
            materialCost: "0",
            laborCost: "0",
            laborHours: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          };
          const lineItemResponse = await apiRequest("POST", `/api/estimates/${estimate.id}/line-items`, lineItemData);
          if (!lineItemResponse.ok) {
            failedItems.push(item.description);
          }
        }
        if (failedItems.length > 0) {
          throw new Error(`Failed to add ${failedItems.length} scope item(s) to estimate. Please add them manually.`);
        }
      }

      return bid;
    },
    onSuccess: (bid) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      const totalItems = scopeItems.filter(i => i.selected).length + customItems.length;
      toast({
        title: "Bid created successfully",
        description: `Bid ${bid.code} has been created${totalItems > 0 ? ` with ${totalItems} scope items` : ''}.`,
      });
      setShowCreateDialog(false);
      resetFormAndCrmState();
      setLocation(`/bids/${bid.code}?step=1`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create bid",
        variant: "destructive",
      });
    },
  });

  const handleCreateBid = form.handleSubmit((data: CreateBidFormInput) => {
    createBidWithEstimateMutation.mutate(data);
  });

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

  const urlParams = new URLSearchParams(window.location.search);
  const initialBidsTab = urlParams.get("tab") === "inbox" ? "inbox" : "board";
  const [bidsTab, setBidsTab] = useState(initialBidsTab);
  const userRole = user?.effectiveRole || user?.role;
  const showInboxTab = canAccessBidNetworkAsSub(userRole);

  const isBoardTab = bidsTab === "board";
  const { getRowProps: getBidRowProps } = useTableKeyboardNav({
    rowCount: isBoardTab ? filteredBids.length : 0,
    onActivate: (idx) => {
      if (!isBoardTab) return;
      const bid = filteredBids[idx];
      if (bid) setLocation(`/bids/${bid.code}`);
    },
  });
  useGlobalSearchFocus(searchInputRef, isBoardTab);
  useRegisterShortcuts("bids-list", TABLE_NAV_SHORTCUTS, isBoardTab);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-3 py-4 sm:px-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              Bids
            </h1>
            <p className="text-sm text-muted-foreground">
              Track opportunities, bids in progress, and incoming invitations
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <ContextualHelpButton />
            <ViewSwitcher value={bidsView} onChange={handleBidsViewChange} views={["table", "kanban", "calendar"]} testId="bids-view-switcher" />
            <SavedViewsDropdown
              viewKey="bids"
              defaultFilters={BIDS_DEFAULT_FILTERS}
              builtInViews={BIDS_BUILT_IN_VIEWS}
              current={{ view: bidsView, filters: { search: searchTerm, dueDate: dueDateFilter, status: statusFilter, estimator: estimatorFilter } }}
              onApply={(applied) => {
                handleBidsViewChange(applied.view === "map" ? "table" : applied.view);
                setSearchTerm(applied.filters.search ?? "");
                setDueDateFilter(applied.filters.dueDate ?? "ALL");
                setStatusFilter(applied.filters.status ?? "ALL");
                setEstimatorFilter(applied.filters.estimator ?? "ALL");
              }}
            />
            <AIAnalysisButton module="BIDS" />
            <AIFeatureTrigger feature="document-analysis" variant="outline" size="sm" label="AI Doc Analysis" data-testid="button-open-bid-doc-analysis" />
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
                    <FileEdit className="w-4 h-4 mr-3 text-primary" />
                    <div>
                      <div className="font-medium">Manual Bid Entry</div>
                      <div className="text-xs text-muted-foreground">
                        Enter bid details directly without documents
                      </div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {showInboxTab && (
          <Tabs value={bidsTab} onValueChange={setBidsTab} className="mb-6">
            <TabsList data-testid="tabs-bids">
              <TabsTrigger value="board" data-testid="tab-bid-board">Bid Board</TabsTrigger>
              <TabsTrigger value="inbox" data-testid="tab-bid-inbox">
                <Inbox className="h-4 w-4 mr-2" />
                Bid Inbox
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {bidsTab === "inbox" && showInboxTab ? (
          <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
            <BidInboxPage />
          </Suspense>
        ) : (
        <>
        <AIBidAnalysisPanel className="mb-4" />
        <div className="mb-6 space-y-4">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
            <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
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
          <EmptyState
            icon={ClipboardList}
            title={searchTerm || dueDateFilter !== "ALL" || statusFilter !== "ALL" || estimatorFilter !== "ALL"
              ? "No bids match your filters"
              : "No bids yet"}
            description={searchTerm || dueDateFilter !== "ALL" || statusFilter !== "ALL" || estimatorFilter !== "ALL"
              ? "Try adjusting your search or filter criteria."
              : "Create your first bid to start tracking estimates and proposals."}
            actionLabel={!(searchTerm || dueDateFilter !== "ALL" || statusFilter !== "ALL" || estimatorFilter !== "ALL") ? "New Bid" : undefined}
            onAction={!(searchTerm || dueDateFilter !== "ALL" || statusFilter !== "ALL" || estimatorFilter !== "ALL") ? () => setShowCreateDialog(true) : undefined}
          />
        ) : bidsView === "kanban" ? (
          <BidsKanbanView
            bids={filteredBids}
            onCardClick={(b) => setLocation(`/bids/${b.code}`)}
          />
        ) : bidsView === "calendar" ? (
          <EntityCalendarView
            items={filteredBids
              .filter((b) => !!b.dueDate)
              .map<CalendarEntityItem<typeof filteredBids[number]>>((b) => ({
                id: b.id,
                label: `${b.code} · ${b.name}`,
                date: new Date(b.dueDate as Date | string),
                colorClass: b.status === "AWARDED"
                  ? "bg-emerald-500 hover:bg-emerald-600"
                  : b.status === "LOST" || b.status === "CANCELLED"
                  ? "bg-rose-500 hover:bg-rose-600"
                  : b.status === "SUBMITTED"
                  ? "bg-blue-500 hover:bg-blue-600"
                  : b.status === "ACTIVE"
                  ? "bg-amber-500 hover:bg-amber-600"
                  : "bg-slate-500 hover:bg-slate-600",
                data: b,
              }))}
            onItemClick={(b) => setLocation(`/bids/${b.code}`)}
            legend={[
              { label: "Draft", colorClass: "bg-slate-500" },
              { label: "Active", colorClass: "bg-amber-500" },
              { label: "Submitted", colorClass: "bg-blue-500" },
              { label: "Awarded", colorClass: "bg-emerald-500" },
              { label: "Lost / Cancelled", colorClass: "bg-rose-500" },
            ]}
            testIdPrefix="bids-calendar"
          />
        ) : (
          <BidsTable
            bids={filteredBids as React.ComponentProps<typeof BidsTable>["bids"]}
            onRowClick={(bid) => setLocation(`/bids/${bid.code}`)}
            canDelete={canDeleteBids(user?.role)}
            onDelete={handleDeleteBid}
            canConvert={canEditBids(user?.role)}
            onConvert={handleConvertToProject}
            getRowProps={getBidRowProps as unknown as React.ComponentProps<typeof BidsTable>["getRowProps"]}
          />
        )}
        </>
        )}
      </main>

      {/* Award & Assign Team Dialog */}
      <Dialog open={showAwardDialog} onOpenChange={setShowAwardDialog}>
        <DialogContent className="sm:max-w-lg">
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

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Contract Math</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="space-y-1">
                  <Label htmlFor="award-overhead">Overhead %</Label>
                  <Input
                    id="award-overhead"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={awardOverheadPercent}
                    onChange={(e) => setAwardOverheadPercent(e.target.value)}
                    data-testid="input-award-overhead"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="award-profit">Profit Margin %</Label>
                  <Input
                    id="award-profit"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={awardProfitPercent}
                    onChange={(e) => setAwardProfitPercent(e.target.value)}
                    data-testid="input-award-profit"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">Applied when no bid amount exists; otherwise the bid amount is used as contract value.</p>
              <div className="space-y-2">
                <Label htmlFor="award-start-status">Start Project As</Label>
                <Select
                  value={awardStartStatus}
                  onValueChange={(val) => setAwardStartStatus(val as "ACTIVE" | "PLANNING")}
                >
                  <SelectTrigger id="award-start-status" data-testid="select-award-start-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active — field work can begin immediately</SelectItem>
                    <SelectItem value="PLANNING">Planning — pre-construction setup phase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
          className="sm:max-w-3xl"
          data-testid="dialog-create-bid"
        >
          <DialogHeader>
            <DialogTitle>
              {manualBidStep === 1 && "Manual Bid Entry"}
              {manualBidStep === 2 && "Review Scope Items"}
              {manualBidStep === 3 && "Bid Details"}
            </DialogTitle>
            <DialogDescription>
              {manualBidStep === 1 && "Enter bid details directly without documents. Optionally use AI to help fill in details from a description."}
              {manualBidStep === 2 && "Review AI-suggested scope items. Toggle items on/off, edit quantities, or add your own."}
              {manualBidStep === 3 && "Review and finalize the bid details before creating."}
            </DialogDescription>
            <div className="flex items-center gap-2 pt-2">
              {[1, 2, 3].map((step) => (
                <div key={step} className="flex items-center gap-1">
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
                      step < manualBidStep
                        ? "bg-primary text-primary-foreground"
                        : step === manualBidStep
                          ? "bg-primary/20 text-primary border-2 border-primary"
                          : "bg-muted text-muted-foreground"
                    )}
                    data-testid={`step-indicator-${step}`}
                  >
                    {step < manualBidStep ? <CheckCircle2 className="h-3.5 w-3.5" /> : step}
                  </div>
                  {step < 3 && <div className={cn("w-8 h-0.5", step < manualBidStep ? "bg-primary" : "bg-muted")} />}
                </div>
              ))}
            </div>
          </DialogHeader>

          {manualBidStep === 1 && (
            <div className="space-y-4" data-testid="step-description">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Project Name</Label>
                <Input
                  placeholder="e.g., Downtown Office Renovation"
                  value={form.watch("name")}
                  onChange={(e) => form.setValue("name", e.target.value)}
                  data-testid="input-project-name-step1"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Project Description / Bid Invitation Text</Label>
                <Textarea
                  placeholder="Paste bid invitation text or describe the project in detail... Include client name, location, scope of work, due dates, and any other relevant details."
                  className="min-h-[180px]"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  data-testid="input-project-description"
                />
                <p className="text-xs text-muted-foreground">
                  The more detail you provide, the better AI can auto-fill bid fields and suggest scope items.
                </p>
              </div>

              <div className="flex justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleDialogOpenChange(false)}
                  data-testid="button-cancel-create"
                >
                  Cancel
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setManualBidStep(3)}
                    data-testid="button-skip-ai"
                  >
                    Skip AI
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                  <Button
                    type="button"
                    onClick={() => analyzeTextMutation.mutate(projectDescription)}
                    disabled={analyzeTextMutation.isPending || projectDescription.trim().length < 10}
                    data-testid="button-ai-assist"
                  >
                    {analyzeTextMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        AI Assist
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {manualBidStep === 2 && (
            <div className="space-y-4" data-testid="step-scope-items">
              {scopeItems.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    AI-Suggested Items
                  </span>
                  <Badge variant="outline" data-testid="badge-selected-count">
                    {scopeItems.filter(i => i.selected).length + customItems.length} selected
                  </Badge>
                </div>
              )}

              {scopeItems.length > 0 ? (
                <ScrollArea className="h-[280px] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={scopeItems.length > 0 && scopeItems.every(i => i.selected)}
                            onCheckedChange={(checked) => {
                              setScopeItems(prev => prev.map(item => ({ ...item, selected: !!checked })));
                            }}
                            data-testid="checkbox-select-all"
                          />
                        </TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-20">Qty</TableHead>
                        <TableHead className="w-16">Unit</TableHead>
                        <TableHead className="w-24">Category</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scopeItems.map((item) => (
                        <TableRow key={item.id} data-testid={`scope-item-${item.id}`}>
                          <TableCell>
                            <Checkbox
                              checked={item.selected}
                              onCheckedChange={() => toggleScopeItem(item.id)}
                              data-testid={`checkbox-${item.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium text-sm">{item.description}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-7 w-18 text-sm"
                              value={item.quantity}
                              onChange={(e) => updateScopeItem(item.id, 'quantity', e.target.value)}
                              data-testid={`input-qty-${item.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-7 w-16 text-sm"
                              value={item.unit}
                              onChange={(e) => updateScopeItem(item.id, 'unit', e.target.value)}
                              data-testid={`input-unit-${item.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{item.category}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <div className="text-center py-8 border rounded-md bg-muted/30">
                  <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground text-sm">No AI-suggested items. Add your own below.</p>
                </div>
              )}

              {customItems.length > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Your Custom Items</span>
                  <div className="space-y-1">
                    {customItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-2 rounded-md border bg-muted/30"
                        data-testid={`custom-item-${item.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">{item.description}</span>
                          <Badge variant="outline" className="text-xs">{item.quantity} {item.unit}</Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => removeCustomItem(item.id)}
                          data-testid={`remove-custom-${item.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <span className="text-sm font-medium">Add Custom Scope Item</span>
                <div className="flex gap-2">
                  <Input
                    placeholder="Description"
                    value={newItemDescription}
                    onChange={(e) => setNewItemDescription(e.target.value)}
                    className="flex-1"
                    data-testid="input-custom-description"
                  />
                  <Input
                    placeholder="Qty"
                    type="number"
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(e.target.value)}
                    className="w-20"
                    data-testid="input-custom-quantity"
                  />
                  <Input
                    placeholder="Unit"
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value)}
                    className="w-20"
                    data-testid="input-custom-unit"
                  />
                  <Button onClick={addCustomItem} size="icon" data-testid="button-add-custom-item">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManualBidStep(1)}
                  data-testid="button-back-to-step1"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={() => setManualBidStep(3)}
                  data-testid="button-continue-to-details"
                >
                  Continue to Details
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {manualBidStep === 3 && (
            <Form {...form}>
              <form
                onSubmit={handleCreateBid}
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

                    <div className="flex flex-col gap-4">
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

                  <FormField
                    control={form.control}
                    name="wageDecision"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Wage Decision (optional)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., CA20260010"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-wage-decision"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {(scopeItems.filter(i => i.selected).length + customItems.length) > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-md border bg-primary/5 border-primary/20">
                    <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="text-sm">
                      <strong>{scopeItems.filter(i => i.selected).length + customItems.length}</strong> scope items will be added to an estimate when you create this bid.
                    </span>
                  </div>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setManualBidStep(scopeItems.length > 0 || customItems.length > 0 ? 2 : 1)}
                    data-testid="button-back-to-previous"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={createBidWithEstimateMutation.isPending}
                    data-testid="button-submit-create"
                  >
                    {createBidWithEstimateMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Create Bid
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
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

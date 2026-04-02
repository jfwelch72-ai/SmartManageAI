import { useState } from "react";
import { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Edit,
  FileText,
  Package,
  Truck,
  Users,
  Calculator,
  Upload,
  Send,
  ExternalLink,
  Brain,
  Clock,
  AlertTriangle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ToastAction } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canEditBids, canGenerateBidPDFs } from "@/lib/rbac";
import { useBid, useConvertBidToProject } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  BidSubcontractorQuote,
  BidMaterialQuote,
  Estimate,
  EstimateLineItem,
  BidEquipmentSelection,
} from "@shared/schema";
import { bidEstimateKey, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { UploadResult } from "@uppy/core";
import { apiRequest } from "@/lib/queryClient";

import BidPlansTab from "@/components/bid/BidPlansTab";
import BidScopeStep from "@/components/bid/BidScopeStep";
import BidMaterialsStep from "@/components/bid/BidMaterialsStep";
import BidEquipmentStep from "@/components/bid/BidEquipmentStep";
import BidSubcontractorsStep from "@/components/bid/BidSubcontractorsStep";
import BidSummaryStep from "@/components/bid/BidSummaryStep";
import CostBuilderSidebar from "@/components/bid/CostBuilderSidebar";
import BidLevelingSection from "@/components/bid/BidLevelingSection";
import {
  BidEditDialog,
  SubcontractorQuoteDialog,
  MaterialQuoteDialog,
  EquipmentSelectionDialog,
  AwardBidDialog,
} from "@/components/bid/BidDetailDialogs";
import {
  useBidMutations,
  quoteFormSchema,
  materialQuoteFormSchema,
  equipmentSelectionFormSchema,
  bidEditFormSchema,
  type QuoteFormValues,
  type MaterialQuoteFormValues,
  type EquipmentSelectionFormValues,
} from "@/hooks/use-bid-mutations";

interface OwnedEquipment {
  id: string;
  equipmentCode: string;
  name: string;
  type: string;
  make: string | null;
  model: string | null;
  status: string;
  hourlyRate: string | null;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
}
interface RentalEquipment {
  id: string;
  vendorId: string;
  name: string;
  equipmentType: string;
  make: string | null;
  model: string | null;
  hourlyRate: string | null;
  dailyRate: string | null;
  weeklyRate: string | null;
  monthlyRate: string | null;
  deliveryFee: string | null;
  vendorName: string;
  vendorCode: string;
}
interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
}

type CostBuilderStep = 1 | 2 | 3 | 4 | 5 | 6;

export default function BidDetailPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/bids/:code");
  const { user } = useAuth();
  const { toast } = useToast();

  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [showEditBidDialog, setShowEditBidDialog] = useState(false);
  const [editingQuote, setEditingQuote] =
    useState<BidSubcontractorQuote | null>(null);
  const [uploadedFileData, setUploadedFileData] = useState<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [showMaterialQuoteDialog, setShowMaterialQuoteDialog] = useState(false);
  const [editingMaterialQuote, setEditingMaterialQuote] =
    useState<BidMaterialQuote | null>(null);
  const [uploadedMaterialFileData, setUploadedMaterialFileData] = useState<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [isUploadingMaterialFile, setIsUploadingMaterialFile] = useState(false);
  const [subcontractorContactId, setSubcontractorContactId] = useState<
    string | undefined
  >(undefined);
  const [supplierContactId, setSupplierContactId] = useState<
    string | undefined
  >(undefined);
  const [scopeSelectionData, setScopeSelectionData] = useState<
    ScopeSelectionData | undefined
  >(undefined);
  const [showAwardDialog, setShowAwardDialog] = useState(false);
  const [selectedSuperintendentId, setSelectedSuperintendentId] =
    useState<string>("");
  const [selectedProjectManagerId, setSelectedProjectManagerId] =
    useState<string>("");
  const [startInPlanning, setStartInPlanning] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitRecipientEmail, setSubmitRecipientEmail] = useState("");
  const [showEquipmentDialog, setShowEquipmentDialog] = useState(false);
  const [editingEquipmentSelection, setEditingEquipmentSelection] =
    useState<BidEquipmentSelection | null>(null);
  const [selectedEquipmentSource, setSelectedEquipmentSource] = useState<
    "OWNED" | "RENTAL"
  >("OWNED");
  const [currentStep, setCurrentStep] = useState<CostBuilderStep>(1);
  const [overheadPercent, setOverheadPercent] = useState<number>(10);
  const [profitPercent, setProfitPercent] = useState<number>(15);

  const bidCode = params?.code || "";
  const { data: bid, isLoading } = useBid(bidCode);
  const convertBid = useConvertBidToProject();

  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: {
      subcontractorName: "",
      scopeOfWork: "",
      quoteAmount: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      notes: "",
      inclusions: "",
      exclusions: "",
    },
  });
  const bidEditForm = useForm({
    resolver: zodResolver(bidEditFormSchema),
    defaultValues: {
      name: "",
      clientName: "",
      clientContactName: "",
      clientContactEmail: "",
      clientContactPhone: "",
      gcName: "",
      gcContactName: "",
      gcContactEmail: "",
      gcContactPhone: "",
      bidAmount: "",
      dueDate: undefined as string | undefined,
      locationAddress: "",
      city: "",
      state: "",
      description: "",
    },
  });
  const materialForm = useForm<MaterialQuoteFormValues>({
    resolver: zodResolver(materialQuoteFormSchema),
    defaultValues: {
      materialName: "",
      description: "",
      cost: "",
      specs: "",
      leadTime: "",
      supplierName: "",
      supplierContact: "",
      supplierEmail: "",
    },
  });
  const equipmentForm = useForm({
    resolver: zodResolver(equipmentSelectionFormSchema),
    defaultValues: {
      source: "OWNED" as const,
      equipmentName: "",
      equipmentType: "",
      plannedHours: "",
      plannedDays: "",
      hourlyRate: "",
      dailyRate: "",
      weeklyRate: "",
      estimatedCost: "",
      deliveryFee: "",
      notes: "",
    },
  });

  const mutations = useBidMutations({
    bidCode,
    bidId: bid?.id,
    onQuoteSuccess: () => {
      setShowQuoteDialog(false);
      setEditingQuote(null);
      form.reset();
      setSubcontractorContactId(undefined);
      setScopeSelectionData(undefined);
    },
    onMaterialQuoteSuccess: () => {
      setShowMaterialQuoteDialog(false);
      setEditingMaterialQuote(null);
      materialForm.reset();
      setSupplierContactId(undefined);
    },
    onEquipmentSuccess: () => {
      setShowEquipmentDialog(false);
      setEditingEquipmentSelection(null);
      equipmentForm.reset();
    },
    onBidEditSuccess: () => {
      setShowEditBidDialog(false);
    },
    onEstimateCreated: () => {
      setLocation(`/bids/${bidCode}/estimate`);
    },
  });

  const { data: bidDocuments = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/bids", bidCode, "documents"],
    enabled: !!bidCode,
  });
  const { data: quotes = [], isLoading: quotesLoading } = useQuery<
    BidSubcontractorQuote[]
  >({ queryKey: ["/api/bids", bidCode, "quotes"], enabled: !!bidCode });
  const { data: materialQuotes = [], isLoading: materialQuotesLoading } =
    useQuery<BidMaterialQuote[]>({
      queryKey: ["/api/bids", bidCode, "material-quotes"],
      enabled: !!bidCode,
    });
  const { data: equipmentSelections = [], isLoading: equipmentLoading } =
    useQuery<BidEquipmentSelection[]>({
      queryKey: ["/api/bids", bid?.id, "equipment"],
      enabled: !!bid?.id,
    });
  const { data: availableEquipment } = useQuery<{
    owned: OwnedEquipment[];
    rental: RentalEquipment[];
  }>({ queryKey: ["/api/equipment-for-selection"] });
  const { data: estimateData, isLoading: estimateLoading } = useQuery<{
    estimate:
      | (Estimate & { lineItems: EstimateLineItem[]; totals: any })
      | null;
  }>({ queryKey: bidEstimateKey(bid?.id), enabled: !!bid?.id });
  const { data: usersData = [] } = useQuery<UserOption[]>({
    queryKey: ["/api/users"],
  });

  const superintendents = usersData.filter(
    (u) =>
      u.isActive &&
      (u.role === "SUPERINTENDENT" ||
        u.role === "MANAGER" ||
        u.role === "ADMIN"),
  );
  const managers = usersData.filter(
    (u) => u.isActive && (u.role === "MANAGER" || u.role === "ADMIN"),
  );

  const handleEditBid = () => {
    if (!bid) return;
    bidEditForm.reset({
      name: bid.name,
      clientName: bid.clientName,
      clientContactName: bid.clientContactName || "",
      clientContactEmail: bid.clientContactEmail || "",
      clientContactPhone: bid.clientContactPhone || "",
      bidAmount: bid.bidAmount || "",
      dueDate: bid.dueDate ? format(new Date(bid.dueDate), "yyyy-MM-dd") : "",
      locationAddress: bid.locationAddress || "",
      city: bid.city || "",
      state: bid.state || "",
      description: bid.description || "",
    });
    setShowEditBidDialog(true);
  };

  const handleAddQuote = () => {
    setEditingQuote(null);
    setUploadedFileData(null);
    form.reset();
    setScopeSelectionData(undefined);
    setShowQuoteDialog(true);
  };
  const handleEditQuote = (quote: BidSubcontractorQuote) => {
    setEditingQuote(quote);
    setUploadedFileData(
      quote.fileUrl && quote.fileName
        ? {
            fileUrl: quote.fileUrl,
            fileName: quote.fileName,
            fileSize: quote.fileSize || 0,
            mimeType: quote.mimeType || "",
          }
        : null,
    );
    form.reset({
      subcontractorName: quote.subcontractorName,
      scopeOfWork: quote.scopeOfWork,
      quoteAmount: quote.quoteAmount,
      leadTime: quote.leadTime || "",
      estimatedCompletionTime: quote.estimatedCompletionTime || "",
      contactName: quote.contactName || "",
      contactEmail: quote.contactEmail || "",
      contactPhone: quote.contactPhone || "",
      notes: quote.notes || "",
      inclusions: quote.inclusions || "",
      exclusions: quote.exclusions || "",
    });
    setShowQuoteDialog(true);
  };
  const handleDeleteQuote = async (quoteId: string) => {
    if (confirm("Are you sure you want to delete this quote?"))
      await mutations.deleteQuote.mutateAsync(quoteId);
  };

  const handleAddMaterialQuote = () => {
    setEditingMaterialQuote(null);
    setUploadedMaterialFileData(null);
    materialForm.reset();
    setShowMaterialQuoteDialog(true);
  };
  const handleEditMaterialQuote = (quote: BidMaterialQuote) => {
    setEditingMaterialQuote(quote);
    setUploadedMaterialFileData(
      quote.fileUrl && quote.fileName
        ? {
            fileUrl: quote.fileUrl,
            fileName: quote.fileName,
            fileSize: quote.fileSize || 0,
            mimeType: quote.mimeType || "",
          }
        : null,
    );
    materialForm.reset({
      materialName: quote.materialName,
      description: quote.description || "",
      cost: quote.cost,
      specs: quote.specs || "",
      leadTime: quote.leadTime || "",
      supplierName: quote.supplierName || "",
      supplierContact: quote.supplierContact || "",
      supplierEmail: quote.supplierEmail || "",
    });
    setShowMaterialQuoteDialog(true);
  };
  const handleDeleteMaterialQuote = async (quoteId: string) => {
    if (confirm("Are you sure you want to delete this material quote?"))
      await mutations.deleteMaterialQuote.mutateAsync(quoteId);
  };

  const handleAddEquipment = () => {
    setEditingEquipmentSelection(null);
    setSelectedEquipmentSource("OWNED");
    equipmentForm.reset({
      source: "OWNED",
      equipmentName: "",
      equipmentType: "",
      plannedHours: "",
      plannedDays: "",
      hourlyRate: "",
      dailyRate: "",
      weeklyRate: "",
      estimatedCost: "",
      deliveryFee: "",
      notes: "",
    });
    setShowEquipmentDialog(true);
  };
  const handleEditEquipmentSelection = (selection: BidEquipmentSelection) => {
    setEditingEquipmentSelection(selection);
    setSelectedEquipmentSource(selection.source as "OWNED" | "RENTAL");
    equipmentForm.reset({
      source: selection.source as "OWNED" | "RENTAL",
      equipmentId: selection.equipmentId || undefined,
      rentalCatalogId: selection.rentalCatalogId || undefined,
      rentalVendorId: selection.rentalVendorId || undefined,
      equipmentName: selection.equipmentName,
      equipmentType: selection.equipmentType,
      plannedHours: selection.plannedHours?.toString() || "",
      plannedDays: selection.plannedDays?.toString() || "",
      hourlyRate: selection.hourlyRate?.toString() || "",
      dailyRate: selection.dailyRate?.toString() || "",
      weeklyRate: selection.weeklyRate?.toString() || "",
      estimatedCost: selection.estimatedCost?.toString() || "",
      deliveryFee: selection.deliveryFee?.toString() || "",
      notes: selection.notes || "",
    });
    setShowEquipmentDialog(true);
  };
  const handleDeleteEquipmentSelection = async (selectionId: string) => {
    if (confirm("Are you sure you want to remove this equipment from the bid?"))
      await mutations.deleteEquipmentSelection.mutateAsync(selectionId);
  };

  const onSubmitEquipment = (data: any) => {
    if (editingEquipmentSelection)
      mutations.updateEquipmentSelection.mutate({
        selectionId: editingEquipmentSelection.id,
        data,
      });
    else mutations.createEquipmentSelection.mutate(data);
  };

  const handleSelectOwnedEquipment = (equipmentId: string) => {
    const sel = availableEquipment?.owned.find((e) => e.id === equipmentId);
    if (sel) {
      equipmentForm.setValue("equipmentId", sel.id);
      equipmentForm.setValue("equipmentName", sel.name);
      equipmentForm.setValue("equipmentType", sel.type);
      equipmentForm.setValue("hourlyRate", sel.hourlyRate || "");
      equipmentForm.setValue("dailyRate", sel.dailyRate || "");
      equipmentForm.setValue("weeklyRate", sel.weeklyRate || "");
    }
  };
  const handleSelectRentalEquipment = (catalogId: string) => {
    const sel = availableEquipment?.rental.find((e) => e.id === catalogId);
    if (sel) {
      equipmentForm.setValue("rentalCatalogId", sel.id);
      equipmentForm.setValue("rentalVendorId", sel.vendorId);
      equipmentForm.setValue("equipmentName", sel.name);
      equipmentForm.setValue("equipmentType", sel.equipmentType);
      equipmentForm.setValue("hourlyRate", sel.hourlyRate || "");
      equipmentForm.setValue("dailyRate", sel.dailyRate || "");
      equipmentForm.setValue("weeklyRate", sel.weeklyRate || "");
      equipmentForm.setValue("deliveryFee", sel.deliveryFee || "");
    }
  };

  const calculateEstimatedCost = () => {
    const hours = parseFloat(equipmentForm.watch("plannedHours") || "0"),
      days = parseInt(equipmentForm.watch("plannedDays") || "0");
    const hRate = parseFloat(equipmentForm.watch("hourlyRate") || "0"),
      dRate = parseFloat(equipmentForm.watch("dailyRate") || "0");
    const dFee = parseFloat(equipmentForm.watch("deliveryFee") || "0");
    let cost =
      days > 0 && dRate > 0
        ? days * dRate
        : hours > 0 && hRate > 0
          ? hours * hRate
          : 0;
    cost += dFee;
    if (cost > 0) equipmentForm.setValue("estimatedCost", cost.toFixed(2));
  };


  const processUpload = (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>,
    setData: (d: any) => void,
    setUploading: (v: boolean) => void,
    msg: string,
  ) => {
    try {
      if (!result.successful?.length) throw new Error("No file uploaded");
      const u = result.successful[0];
      const f = u.data as File;
      const path = u.uploadURL?.split("?")[0] || "";
      setData({
        fileUrl: path,
        fileName: f.name,
        fileSize: f.size,
        mimeType: f.type,
      });
      toast({ title: "Success", description: msg });
    } catch {
      toast({
        title: "Error",
        description: "Failed to process uploaded file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const onSubmitQuote = async (data: QuoteFormValues) => {
    const payload = {
      ...data,
      ...(uploadedFileData && {
        fileUrl: uploadedFileData.fileUrl,
        fileName: uploadedFileData.fileName,
        fileSize: uploadedFileData.fileSize,
        mimeType: uploadedFileData.mimeType,
      }),
    };
    if (editingQuote)
      await mutations.updateQuote.mutateAsync({
        quoteId: editingQuote.id,
        data: payload,
      });
    else await mutations.createQuote.mutateAsync(payload as QuoteFormValues);
  };

  const onSubmitMaterialQuote = async (data: MaterialQuoteFormValues) => {
    const payload = {
      ...data,
      ...(uploadedMaterialFileData && {
        fileUrl: uploadedMaterialFileData.fileUrl,
        fileName: uploadedMaterialFileData.fileName,
        fileSize: uploadedMaterialFileData.fileSize,
        mimeType: uploadedMaterialFileData.mimeType,
      }),
    };
    if (editingMaterialQuote)
      await mutations.updateMaterialQuote.mutateAsync({
        quoteId: editingMaterialQuote.id,
        data: payload,
      });
    else
      await mutations.createMaterialQuote.mutateAsync(
        payload as MaterialQuoteFormValues,
      );
  };

  const submitBidMutation = useMutation({
    mutationFn: async (recipientEmail: string) => {
      const res = await apiRequest("POST", `/api/bids/${bidCode}/submit`, { recipientEmail: recipientEmail || undefined });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Bid Submitted",
        description: data.emailSent
          ? "Bid submitted and customer quote emailed to the client."
          : "Bid marked as submitted. Email delivery may have failed — check logs.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      setShowSubmitDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit bid",
        variant: "destructive",
      });
    },
  });

  const handleConfirmAward = async () => {
    if (!bid) return;
    try {
      const newProject = await convertBid.mutateAsync({
        code: bid.code,
        superintendentId: selectedSuperintendentId || undefined,
        projectManagerId: selectedProjectManagerId || undefined,
        overheadPercent,
        profitPercent,
        startStatus: startInPlanning ? "PLANNING" : "ACTIVE",
      });
      toast({
        title: "Success",
        description: startInPlanning
          ? "Bid awarded — project created in Planning status."
          : "Bid has been awarded and moved to Active Projects!",
      });
      setShowAwardDialog(false);
      if (newProject?.code) {
        setLocation(`/projects/${newProject.code}`);
      } else {
        setLocation("/projects");
      }
    } catch (error: any) {
      const isAlreadyAwarded =
        error.message?.includes("Bid already awarded") ||
        error.status === 409;
      if (isAlreadyAwarded) {
        const projectCode = bid.convertedToProjectId ? bid.code : null;
        toast({
          title: "Already converted",
          description: projectCode
            ? `This bid has already been converted to project ${projectCode}.`
            : "This bid has already been converted to a project.",
          action: projectCode ? (
            <ToastAction
              altText="View Project"
              onClick={() => setLocation(`/projects/${projectCode}`)}
            >
              View Project
            </ToastAction>
          ) : undefined,
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to convert bid to project",
          variant: "destructive",
        });
      }
    }
  };

  if (isLoading)
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading bid details...</p>
        </div>
      </div>
    );
  if (!bid)
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Bid not found</p>
        </div>
      </div>
    );

  const estimate = estimateData?.estimate || null;
  const locationString =
    [bid.locationAddress, bid.city, bid.state].filter(Boolean).join(", ") ||
    "No location specified";
  const canEdit = canEditBids(user?.role);

  const dueDate = bid.dueDate ? new Date(bid.dueDate) : null;
  const now = new Date();
  const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isUrgent = daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= 3;
  const isApproaching = daysUntilDue !== null && daysUntilDue > 3 && daysUntilDue <= 7;

  const estimateTotals = estimate?.totals || {
    laborCost: 0,
    materialCost: 0,
    equipmentCost: 0,
    consumablesCost: 0,
    subcontractCost: 0,
    totalCost: 0,
    laborHours: 0,
  };
  const selectedMaterialQuotesTotal = materialQuotes
    .filter((q: any) => q.isSelected)
    .reduce((sum, q) => sum + Number(q.cost || 0), 0);
  const equipmentSelectionsTotal = equipmentSelections.reduce(
    (sum, sel) => sum + parseFloat(sel.estimatedCost || "0"),
    0,
  );
  const selectedSubQuotesTotal = quotes
    .filter((q: any) => q.isSelected)
    .reduce((sum, q) => sum + Number(q.quoteAmount || 0), 0);

  // Use bid-level vendor quotes when available; fall back to estimate line-item costs
  const totalMaterialCost =
    selectedMaterialQuotesTotal > 0 ? selectedMaterialQuotesTotal : estimateTotals.materialCost;
  const totalEquipmentCostCalc =
    equipmentSelectionsTotal > 0 ? equipmentSelectionsTotal : estimateTotals.equipmentCost;
  const totalSubcontractorCost =
    selectedSubQuotesTotal > 0 ? selectedSubQuotesTotal : estimateTotals.subcontractCost;

  const directCost =
    totalMaterialCost +
    totalEquipmentCostCalc +
    estimateTotals.laborCost +
    totalSubcontractorCost;
  const overheadAmount = directCost * (overheadPercent / 100);
  const profitAmount = (directCost + overheadAmount) * (profitPercent / 100);
  const finalBidAmount = directCost + overheadAmount + profitAmount;

  const steps = [
    { id: 1, name: "Plans & Takeoff", icon: Upload, cost: 0 },
    {
      id: 2,
      name: "Scope of Work",
      icon: FileText,
      cost: estimateTotals.totalCost,
    },
    {
      id: 3,
      name: "Materials & Supplies",
      icon: Package,
      cost: totalMaterialCost,
    },
    { id: 4, name: "Equipment", icon: Truck, cost: totalEquipmentCostCalc },
    {
      id: 5,
      name: "Subcontractors",
      icon: Users,
      cost: totalSubcontractorCost,
    },
    { id: 6, name: "Bid Summary", icon: Calculator, cost: finalBidAmount },
  ];
  const stepStatus: Record<number, boolean> = {
    1: bidDocuments.length > 0,
    2: (estimate?.lineItems?.length || 0) > 0,
    3: materialQuotes.length > 0,
    4: equipmentSelections.length > 0,
    5: quotes.length > 0,
    6: true,
  };

  const hasMaterialQuotes = materialQuotes.length > 0;
  const hasEquipmentSelections = equipmentSelections.length > 0;
  const hasSubQuotes = quotes.length > 0;

  const derivedMaterialRequirements =
    estimate?.lineItems
      ?.filter(
        (item) =>
          Number(item.materialCost) > 0 ||
          [
            "CONCRETE",
            "FLATWORK",
            "EXCAVATION",
            "GRADING",
            "STONE",
            "REBAR",
            "WIRE_MESH",
          ].includes(item.category),
      )
      .map((item) => ({
        id: item.id,
        category: item.category,
        description: item.description,
        unit: item.unit,
        quantity: Number(item.quantity),
        materialCost: Number(item.materialCost),
        needsVendorSelection: !hasMaterialQuotes,
      })) || [];
  const derivedEquipmentRequirements =
    estimate?.lineItems
      ?.filter(
        (item) =>
          Number(item.equipmentCost) > 0 ||
          ["EXCAVATION", "GRADING", "DEMOLITION", "HAULING"].includes(
            item.category,
          ),
      )
      .map((item) => ({
        id: item.id,
        category: item.category,
        description: item.description,
        equipmentCost: Number(item.equipmentCost),
        needsEquipmentSelection: !hasEquipmentSelections,
      })) || [];
  const derivedSubRequirements =
    estimate?.lineItems
      ?.filter(
        (item) =>
          Number(item.subcontractCost) > 0 ||
          [
            "PLUMBING",
            "ELECTRICAL",
            "HVAC",
            "LANDSCAPING",
            "FENCING",
            "MASONRY",
          ].includes(item.category),
      )
      .map((item) => ({
        id: item.id,
        category: item.category,
        description: item.description,
        subcontractCost: Number(item.subcontractCost),
        needsSubSelection: !hasSubQuotes,
      })) || [];

  const selectedMaterialCount = materialQuotes.filter((q: any) => q.isSelected).length;
  const selectedSubCount = quotes.filter((q: any) => q.isSelected).length;
  const stepProgress: Record<number, { current: number; total: number; label: string }> = {};
  stepProgress[1] = { current: bidDocuments.length, total: Math.max(bidDocuments.length, 1), label: "docs" };
  if ((estimate?.lineItems?.length || 0) > 0) {
    stepProgress[2] = { current: estimate!.lineItems!.length, total: estimate!.lineItems!.length, label: "items" };
  }
  if (derivedMaterialRequirements.length > 0 || materialQuotes.length > 0) {
    stepProgress[3] = { current: selectedMaterialCount, total: Math.max(materialQuotes.length, derivedMaterialRequirements.length, 1), label: "quotes" };
  }
  if (derivedEquipmentRequirements.length > 0 || equipmentSelections.length > 0) {
    stepProgress[4] = { current: equipmentSelections.length, total: Math.max(equipmentSelections.length, derivedEquipmentRequirements.length, 1), label: "items" };
  }
  if (derivedSubRequirements.length > 0 || quotes.length > 0) {
    stepProgress[5] = { current: selectedSubCount, total: Math.max(quotes.length, derivedSubRequirements.length, 1), label: "quotes" };
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <main className="mx-auto max-w-full px-3 py-4 sm:px-6 sm:py-8">
        <div className="mb-4 sm:mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/bids")}
            data-testid="button-back"
          >
            ← Back to Bid Board
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Badge variant="outline" className="font-mono">
                {bid.code}
              </Badge>
              {bid.submittedAt && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 text-xs">
                  <Send className="w-3 h-3 mr-1" />
                  Submitted {format(new Date(bid.submittedAt), "MMM d, yyyy h:mm a")}
                </Badge>
              )}
              {bid.status === "AWARDED" && bid.convertedToProjectId ? (
                <Badge
                  className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 cursor-pointer hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                  onClick={() => setLocation(`/projects/${bid.code}`)}
                  data-testid="badge-converted-to-project"
                  title={`View project ${bid.code}`}
                >
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Converted → Project {bid.code}
                </Badge>
              ) : canEdit ? (
                <Select
                  value={bid.status}
                  onValueChange={(v) => {
                    if (v === "AWARDED") setShowAwardDialog(true);
                    else mutations.updateBidStatus.mutate(v);
                  }}
                  disabled={mutations.updateBidStatus.isPending || bid.status === "AWARDED"}
                  data-testid="select-bid-status"
                >
                  <SelectTrigger
                    className="w-[140px]"
                    data-testid="select-bid-status-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="DRAFT"
                      data-testid="select-bid-status-draft"
                    >
                      Draft
                    </SelectItem>
                    <SelectItem
                      value="ACTIVE"
                      data-testid="select-bid-status-active"
                    >
                      Active
                    </SelectItem>
                    <SelectItem
                      value="SUBMITTED"
                      data-testid="select-bid-status-submitted"
                    >
                      Submitted
                    </SelectItem>
                    <SelectItem
                      value="AWARDED"
                      data-testid="select-bid-status-awarded"
                      disabled={bid.status === "AWARDED"}
                    >
                      Awarded
                    </SelectItem>
                    <SelectItem
                      value="LOST"
                      data-testid="select-bid-status-lost"
                    >
                      Lost
                    </SelectItem>
                    <SelectItem
                      value="CANCELLED"
                      data-testid="select-bid-status-cancelled"
                    >
                      Cancelled
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge
                  className={
                    bid.status === "AWARDED"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      : bid.status === "LOST"
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        : bid.status === "CANCELLED"
                          ? "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300"
                          : bid.status === "SUBMITTED"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                            : bid.status === "ACTIVE"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                  }
                >
                  {bid.status}
                </Badge>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-1 sm:mb-2">
              {bid.name}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs sm:text-sm text-muted-foreground">
                {bid.clientName} • {locationString}
              </p>
              {bid.aiWinProbability != null && (
                <Badge
                  variant="outline"
                  className={`text-xs gap-1 ${
                    bid.aiWinProbability >= 60
                      ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                      : bid.aiWinProbability >= 30
                        ? "border-yellow-300 text-yellow-700 dark:border-yellow-700 dark:text-yellow-400"
                        : "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                  }`}
                  data-testid="badge-bid-ai-win-prob"
                >
                  <Brain className="w-3 h-3" />
                  Win Prob: {bid.aiWinProbability}%
                </Badge>
              )}
              {dueDate && bid.status !== "AWARDED" && bid.status !== "LOST" && bid.status !== "CANCELLED" && (
                <Badge
                  variant={isOverdue ? "destructive" : "outline"}
                  className={`text-xs gap-1 ${
                    isOverdue
                      ? ""
                      : isUrgent
                        ? "border-red-300 text-red-700 bg-red-50 dark:border-red-700 dark:text-red-400 dark:bg-red-950/30 animate-pulse"
                        : isApproaching
                          ? "border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:bg-amber-950/30"
                          : "border-border text-muted-foreground"
                  }`}
                  data-testid="badge-bid-due-date"
                >
                  {isOverdue ? (
                    <AlertTriangle className="w-3 h-3" />
                  ) : (
                    <Clock className="w-3 h-3" />
                  )}
                  {isOverdue
                    ? `Overdue by ${Math.abs(daysUntilDue!)} day${Math.abs(daysUntilDue!) !== 1 ? "s" : ""}`
                    : daysUntilDue === 0
                      ? "Due today"
                      : daysUntilDue === 1
                        ? "Due tomorrow"
                        : `${daysUntilDue} days left`}
                </Badge>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={handleEditBid}
                data-testid="button-edit-bid-header"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Bid Info
              </Button>
              {bid.status === "AWARDED" && bid.convertedToProjectId ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => setLocation(`/projects/${bid.code}`)}
                  data-testid="button-view-converted-project"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Project
                </Button>
              ) : bid.status !== "AWARDED" ? (
                <Button
                  size="sm"
                  className="flex-1 sm:flex-none"
                  onClick={() => setShowAwardDialog(true)}
                  data-testid="button-mark-awarded"
                >
                  Mark as Awarded
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <CostBuilderSidebar
            currentStep={currentStep}
            onStepChange={setCurrentStep}
            steps={steps}
            stepStatus={stepStatus}
            stepProgress={stepProgress}
            directCost={directCost}
            overheadPercent={overheadPercent}
            overheadAmount={overheadAmount}
            profitPercent={profitPercent}
            profitAmount={profitAmount}
            finalBidAmount={finalBidAmount}
          />

          <div className="w-full space-y-6">
            {currentStep === 1 && (
              <BidPlansTab
                bidId={bid.id}
                bidCode={bidCode}
                canEdit={canEdit}
                estimateId={estimate?.id}
                onNextStep={() => setCurrentStep(2)}
              />
            )}
            {currentStep === 2 && (
              <BidScopeStep
                estimate={estimate}
                estimateLoading={estimateLoading}
                canEdit={canEdit}
                canViewHistory={["ADMIN", "MANAGER", "ESTIMATOR"].includes(user?.role || "")}
                bidId={bid.id}
                bidCode={bidCode}
                createEstimatePending={
                  mutations.createEstimateMutation.isPending
                }
                onCreateEstimate={() =>
                  mutations.createEstimateMutation.mutate()
                }
                onNavigateEstimate={() =>
                  setLocation(`/bids/${bidCode}/estimate`)
                }
                onPrevStep={() => setCurrentStep(1)}
                onNextStep={() => setCurrentStep(3)}
              />
            )}
            {currentStep === 3 && (
              <BidMaterialsStep
                materialQuotes={materialQuotes}
                materialQuotesLoading={materialQuotesLoading}
                totalMaterialCost={totalMaterialCost}
                derivedMaterialRequirements={derivedMaterialRequirements}
                canEdit={canEdit}
                toggleSelectionPending={
                  mutations.toggleMaterialQuoteSelection.isPending
                }
                onAddQuote={handleAddMaterialQuote}
                onEditQuote={handleEditMaterialQuote}
                onDeleteQuote={handleDeleteMaterialQuote}
                onToggleSelection={(qId, sel) =>
                  mutations.toggleMaterialQuoteSelection.mutate({
                    quoteId: qId,
                    isSelected: sel,
                  })
                }
                onSendRfq={(quoteId) => mutations.sendMaterialRfq.mutate(quoteId)}
                sendRfqPending={mutations.sendMaterialRfq.isPending}
                onPrevStep={() => setCurrentStep(2)}
                onNextStep={() => setCurrentStep(4)}
              />
            )}
            {currentStep === 4 && (
              <BidEquipmentStep
                equipmentSelections={equipmentSelections}
                equipmentLoading={equipmentLoading}
                totalEquipmentCost={totalEquipmentCostCalc}
                derivedEquipmentRequirements={derivedEquipmentRequirements}
                canEdit={canEdit}
                onAddEquipment={handleAddEquipment}
                onEditEquipment={handleEditEquipmentSelection}
                onDeleteEquipment={handleDeleteEquipmentSelection}
                onPrevStep={() => setCurrentStep(3)}
                onNextStep={() => setCurrentStep(5)}
              />
            )}
            {currentStep === 5 && (
              <>
                <BidSubcontractorsStep
                  quotes={quotes}
                  quotesLoading={quotesLoading}
                  totalSubcontractorCost={totalSubcontractorCost}
                  derivedSubRequirements={derivedSubRequirements}
                  canEdit={canEdit}
                  toggleSelectionPending={
                    mutations.toggleQuoteSelection.isPending
                  }
                  onAddQuote={handleAddQuote}
                  onEditQuote={handleEditQuote}
                  onDeleteQuote={handleDeleteQuote}
                  onToggleSelection={(qId, sel) =>
                    mutations.toggleQuoteSelection.mutate({
                      quoteId: qId,
                      isSelected: sel,
                    })
                  }
                  onSendRfq={(quoteId, overrideEmail) => mutations.sendSubRfq.mutate({ quoteId, overrideEmail })}
                  sendRfqPending={mutations.sendSubRfq.isPending}
                  onPrevStep={() => setCurrentStep(4)}
                  onNextStep={() => setCurrentStep(6)}
                />
                <div className="mt-6">
                  <BidLevelingSection bidCode={bidCode} canEdit={canEdit} />
                </div>
              </>
            )}
            {currentStep === 6 && (
              <BidSummaryStep
                bid={bid}
                bidCode={bidCode}
                totalMaterialCost={totalMaterialCost}
                totalEquipmentCost={totalEquipmentCostCalc}
                laborCost={estimateTotals.laborCost}
                totalSubcontractorCost={totalSubcontractorCost}
                directCost={directCost}
                overheadPercent={overheadPercent}
                overheadAmount={overheadAmount}
                profitPercent={profitPercent}
                profitAmount={profitAmount}
                finalBidAmount={finalBidAmount}
                canEdit={canEdit}
                canGeneratePDFs={canGenerateBidPDFs(user?.role)}
                userRole={user?.role || ""}
                useVendorMaterial={selectedMaterialQuotesTotal > 0}
                useVendorEquipment={equipmentSelectionsTotal > 0}
                useVendorSubs={selectedSubQuotesTotal > 0}
                onOverheadChange={setOverheadPercent}
                onProfitChange={setProfitPercent}
                onPrevStep={() => setCurrentStep(5)}
                onAwardBid={() => setShowAwardDialog(true)}
                onNavigateEstimate={() =>
                  setLocation(`/bids/${bidCode}/estimate`)
                }
                onSubmitBid={() => {
                  setSubmitRecipientEmail(bid?.clientContactEmail || "");
                  setShowSubmitDialog(true);
                }}
                isSubmittingBid={submitBidMutation.isPending}
              />
            )}
          </div>
        </div>
      </main>

      <BidEditDialog
        open={showEditBidDialog}
        onOpenChange={setShowEditBidDialog}
        form={bidEditForm}
        onSubmit={(data) => mutations.updateBidMutation.mutate(data)}
        isPending={mutations.updateBidMutation.isPending}
      />
      <SubcontractorQuoteDialog
        open={showQuoteDialog}
        onOpenChange={setShowQuoteDialog}
        form={form}
        onSubmit={onSubmitQuote}
        editingQuote={editingQuote}
        createPending={mutations.createQuote.isPending}
        updatePending={mutations.updateQuote.isPending}
        isUploadingFile={isUploadingFile}
        uploadedFileData={uploadedFileData}
        onSetUploadedFileData={setUploadedFileData}
        onFileUploadComplete={(r) => {
          setIsUploadingFile(true);
          processUpload(
            r,
            setUploadedFileData,
            setIsUploadingFile,
            "Quote document uploaded",
          );
        }}
        estimateData={estimateData}
        scopeSelectionData={scopeSelectionData}
        onScopeSelectionChange={setScopeSelectionData}
        subcontractorContactId={subcontractorContactId}
        onSubcontractorContactIdChange={setSubcontractorContactId}
      />
      <MaterialQuoteDialog
        open={showMaterialQuoteDialog}
        onOpenChange={setShowMaterialQuoteDialog}
        form={materialForm}
        onSubmit={onSubmitMaterialQuote}
        editingQuote={editingMaterialQuote}
        createPending={mutations.createMaterialQuote.isPending}
        updatePending={mutations.updateMaterialQuote.isPending}
        isUploadingFile={isUploadingMaterialFile}
        uploadedFileData={uploadedMaterialFileData}
        onSetUploadedFileData={setUploadedMaterialFileData}
        onFileUploadComplete={(r) => {
          setIsUploadingMaterialFile(true);
          processUpload(
            r,
            setUploadedMaterialFileData,
            setIsUploadingMaterialFile,
            "Material quote document uploaded",
          );
        }}
        supplierContactId={supplierContactId}
        onSupplierContactIdChange={setSupplierContactId}
      />
      <EquipmentSelectionDialog
        open={showEquipmentDialog}
        onOpenChange={setShowEquipmentDialog}
        form={equipmentForm}
        onSubmit={onSubmitEquipment}
        editingSelection={editingEquipmentSelection}
        createPending={mutations.createEquipmentSelection.isPending}
        updatePending={mutations.updateEquipmentSelection.isPending}
        selectedSource={selectedEquipmentSource}
        onSourceChange={setSelectedEquipmentSource}
        availableEquipment={availableEquipment}
        onSelectOwned={handleSelectOwnedEquipment}
        onSelectRental={handleSelectRentalEquipment}
        onCalculateCost={calculateEstimatedCost}
      />
      <AwardBidDialog
        open={showAwardDialog}
        onOpenChange={setShowAwardDialog}
        bid={bid}
        finalBidAmount={finalBidAmount}
        overheadPercent={overheadPercent}
        profitPercent={profitPercent}
        superintendents={superintendents}
        managers={managers}
        selectedSuperintendentId={selectedSuperintendentId}
        selectedProjectManagerId={selectedProjectManagerId}
        startInPlanning={startInPlanning}
        onSuperintendentChange={setSelectedSuperintendentId}
        onProjectManagerChange={setSelectedProjectManagerId}
        onStartInPlanningChange={setStartInPlanning}
        onConfirmAward={handleConfirmAward}
        isPending={convertBid.isPending}
      />

      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-600" />
              Submit Bid to Client
            </DialogTitle>
            <DialogDescription>
              A bid summary email with the project name, amount, due date, and reference code will be sent to the recipient below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="recipient-email">Recipient Email</Label>
              <Input
                id="recipient-email"
                type="email"
                placeholder="client@example.com"
                value={submitRecipientEmail}
                onChange={(e) => setSubmitRecipientEmail(e.target.value)}
                data-testid="input-submit-recipient-email"
              />
              {bid.clientContactEmail && !submitRecipientEmail && (
                <p className="text-xs text-muted-foreground">
                  Will default to <span className="font-mono">{bid.clientContactEmail}</span> if left blank.
                </p>
              )}
              {!bid.clientContactEmail && !submitRecipientEmail && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No client email on file — please enter a recipient email above.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSubmitDialog(false)}
              data-testid="button-cancel-submit"
            >
              Cancel
            </Button>
            <Button
              onClick={() => submitBidMutation.mutate(submitRecipientEmail)}
              disabled={submitBidMutation.isPending || (!submitRecipientEmail && !bid.clientContactEmail)}
              data-testid="button-confirm-submit"
            >
              <Send className="w-4 h-4 mr-2" />
              {submitBidMutation.isPending ? "Sending..." : "Send to Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

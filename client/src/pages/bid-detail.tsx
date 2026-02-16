import { useState, useEffect } from "react";
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";
import BidDocumentDistribution from "@/components/BidDocumentDistribution";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import FileUploadZone from "@/components/FileUploadZone";
import { ObjectUploader } from "@/components/ObjectUploader";
import { Building2, MapPin, Mail, Phone, Calendar, DollarSign, Plus, Edit, Trash2, Users, FileText, Download, Calculator, TrendingUp, Package, CheckCircle2, UserCog, Truck, Clock, Wrench, ChevronRight, Check, CircleDot } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import JobInformationForm from "@/components/JobInformationForm";
import { SubcontractorScopeReportDialog } from "@/components/SubcontractorScopeReport";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canEditBids, canDeleteBids, canGenerateBidPDFs } from "@/lib/rbac";
import { useBid, useConvertBidToProject } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertBidSubcontractorQuoteSchema, insertBidMaterialQuoteSchema, insertBidSchema, insertBidEquipmentSelectionSchema } from "@shared/schema";
import type { BidSubcontractorQuote, BidMaterialQuote, InsertBidSubcontractorQuote, InsertBidMaterialQuote, Estimate, EstimateLineItem, CrmOrganisation, CrmContact, BidEquipmentSelection } from "@shared/schema";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { z } from "zod";
import type { UploadResult } from "@uppy/core";

const quoteFormSchema = insertBidSubcontractorQuoteSchema.omit({ bidId: true }).extend({
  quoteAmount: z.string().min(1, "Quote amount is required"),
  scopeOfWork: z.string().min(1, "Scope of work is required"),
  subcontractorName: z.string().min(1, "Subcontractor name is required"),
});
type QuoteFormValues = z.infer<typeof quoteFormSchema>;

const materialQuoteFormSchema = insertBidMaterialQuoteSchema.omit({ bidId: true }).extend({
  cost: z.string().min(1, "Cost is required"),
});
type MaterialQuoteFormValues = z.infer<typeof materialQuoteFormSchema>;

const equipmentSelectionFormSchema = z.object({
  source: z.enum(["OWNED", "RENTAL"]),
  equipmentId: z.string().optional(),
  rentalCatalogId: z.string().optional(),
  rentalVendorId: z.string().optional(),
  equipmentName: z.string().min(1, "Equipment name is required"),
  equipmentType: z.string().min(1, "Equipment type is required"),
  plannedHours: z.string().optional(),
  plannedDays: z.string().optional(),
  hourlyRate: z.string().optional(),
  dailyRate: z.string().optional(),
  weeklyRate: z.string().optional(),
  estimatedCost: z.string().optional(),
  deliveryFee: z.string().optional(),
  notes: z.string().optional(),
});
type EquipmentSelectionFormValues = z.infer<typeof equipmentSelectionFormSchema>;

// Form schema accepts strings from HTML inputs
const bidEditFormSchema = z.object({
  name: z.string(),
  clientName: z.string(),
  clientContactName: z.string().optional(),
  clientContactEmail: z.string().email().optional().or(z.literal("")),
  clientContactPhone: z.string().optional(),
  gcName: z.string().optional(),
  gcContactName: z.string().optional(),
  gcContactEmail: z.string().email().optional().or(z.literal("")),
  gcContactPhone: z.string().optional(),
  bidAmount: z.string().optional(),
  dueDate: z.string().optional(),
  locationAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  description: z.string().optional(),
}).partial();
type BidEditFormValues = z.infer<typeof bidEditFormSchema>;

export default function BidDetailPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/bids/:code");
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [showEditBidDialog, setShowEditBidDialog] = useState(false);
  const [editingQuote, setEditingQuote] = useState<BidSubcontractorQuote | null>(null);
  const [uploadedFileData, setUploadedFileData] = useState<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const [showMaterialQuoteDialog, setShowMaterialQuoteDialog] = useState(false);
  const [editingMaterialQuote, setEditingMaterialQuote] = useState<BidMaterialQuote | null>(null);
  const [uploadedMaterialFileData, setUploadedMaterialFileData] = useState<{
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null>(null);
  const [isUploadingMaterialFile, setIsUploadingMaterialFile] = useState(false);
  
  // CRM integration state
  const [subcontractorContactId, setSubcontractorContactId] = useState<string | undefined>(undefined);
  const [supplierContactId, setSupplierContactId] = useState<string | undefined>(undefined);
  
  // Standardized scope selection state
  const [scopeSelectionData, setScopeSelectionData] = useState<ScopeSelectionData | undefined>(undefined);
  
  // Award dialog state
  const [showAwardDialog, setShowAwardDialog] = useState(false);
  const [selectedSuperintendentId, setSelectedSuperintendentId] = useState<string>("");
  const [selectedProjectManagerId, setSelectedProjectManagerId] = useState<string>("");
  
  // Equipment selection state
  const [showEquipmentDialog, setShowEquipmentDialog] = useState(false);
  const [editingEquipmentSelection, setEditingEquipmentSelection] = useState<BidEquipmentSelection | null>(null);
  const [selectedEquipmentSource, setSelectedEquipmentSource] = useState<"OWNED" | "RENTAL">("OWNED");
  
  // Cost Builder step state
  type CostBuilderStep = 1 | 2 | 3 | 4 | 5;
  const [currentStep, setCurrentStep] = useState<CostBuilderStep>(1);
  const [overheadPercent, setOverheadPercent] = useState<number>(10);
  const [profitPercent, setProfitPercent] = useState<number>(15);
  
  const bidCode = params?.code || "";
  const { data: bid, isLoading } = useBid(bidCode);
  const convertBid = useConvertBidToProject();

  // Fetch bid quotes
  const { data: quotes = [], isLoading: quotesLoading} = useQuery<BidSubcontractorQuote[]>({
    queryKey: ["/api/bids", bidCode, "quotes"],
    enabled: !!bidCode,
  });

  // Fetch bid material quotes
  const { data: materialQuotes = [], isLoading: materialQuotesLoading} = useQuery<BidMaterialQuote[]>({
    queryKey: ["/api/bids", bidCode, "material-quotes"],
    enabled: !!bidCode,
  });

  // Fetch bid equipment selections
  const { data: equipmentSelections = [], isLoading: equipmentLoading } = useQuery<BidEquipmentSelection[]>({
    queryKey: ["/api/bids", bid?.id, "equipment"],
    enabled: !!bid?.id,
  });

  // Fetch available equipment for selection (owned + rental)
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
  const { data: availableEquipment } = useQuery<{ owned: OwnedEquipment[], rental: RentalEquipment[] }>({
    queryKey: ["/api/equipment-for-selection"],
  });

  // Fetch bid estimate
  const { data: estimateData, isLoading: estimateLoading } = useQuery<{
    estimate: Estimate & { lineItems: EstimateLineItem[], totals: any } | null
  }>({
    queryKey: bidEstimateKey(bid?.id),
    enabled: !!bid?.id,
  });

  // Fetch users for project assignment
  interface UserOption {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
  }
  const { data: usersData = [] } = useQuery<UserOption[]>({
    queryKey: ["/api/users"],
  });
  
  // Filter active superintendents and managers for assignment dropdowns
  const superintendents = usersData.filter(u => 
    u.isActive && (u.role === "SUPERINTENDENT" || u.role === "MANAGER" || u.role === "ADMIN")
  );
  const managers = usersData.filter(u => 
    u.isActive && (u.role === "MANAGER" || u.role === "ADMIN")
  );

  // Quote form
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
    },
  });

  // Bid edit form
  const bidEditForm = useForm<BidEditFormValues>({
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
      dueDate: undefined,
      locationAddress: "",
      city: "",
      state: "",
      description: "",
    },
  });

  // CRM contact selection state for Edit Bid form
  const [editBidClientContactId, setEditBidClientContactId] = useState<string | undefined>();
  const [editBidGcContactId, setEditBidGcContactId] = useState<string | undefined>();

  // Material quote form
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
    },
  });

  // Equipment selection form
  const equipmentForm = useForm<EquipmentSelectionFormValues>({
    resolver: zodResolver(equipmentSelectionFormSchema),
    defaultValues: {
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
    },
  });

  // Create quote mutation
  const createQuote = useMutation({
    mutationFn: async (data: QuoteFormValues) => {
      const payload = {
        ...data,
        quoteAmount: data.quoteAmount,
      };
      const res = await apiRequest("POST", `/api/bids/${bidCode}/quotes`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
      toast({ title: "Success", description: "Subcontractor quote added" });
      setShowQuoteDialog(false);
      form.reset();
      setSubcontractorContactId(undefined);
      setScopeSelectionData(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add quote",
        variant: "destructive",
      });
    },
  });

  // Update quote mutation
  const updateQuote = useMutation({
    mutationFn: async ({ quoteId, data }: { quoteId: string; data: Partial<QuoteFormValues> }) => {
      const res = await apiRequest("PATCH", `/api/bids/${bidCode}/quotes/${quoteId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
      toast({ title: "Success", description: "Quote updated" });
      setShowQuoteDialog(false);
      setEditingQuote(null);
      form.reset();
      setSubcontractorContactId(undefined);
      setScopeSelectionData(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update quote",
        variant: "destructive",
      });
    },
  });

  // Delete quote mutation
  const deleteQuote = useMutation({
    mutationFn: async (quoteId: string) => {
      const res = await apiRequest("DELETE", `/api/bids/${bidCode}/quotes/${quoteId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
      toast({ title: "Success", description: "Quote deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete quote",
        variant: "destructive",
      });
    },
  });

  // Create material quote mutation
  const createMaterialQuote = useMutation({
    mutationFn: async (data: MaterialQuoteFormValues) => {
      const payload = {
        ...data,
        cost: data.cost,
      };
      const res = await apiRequest("POST", `/api/bids/${bidCode}/material-quotes`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "material-quotes"] });
      toast({ title: "Success", description: "Material quote added" });
      setShowMaterialQuoteDialog(false);
      materialForm.reset();
      setSupplierContactId(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add material quote",
        variant: "destructive",
      });
    },
  });

  // Update material quote mutation
  const updateMaterialQuote = useMutation({
    mutationFn: async ({ quoteId, data }: { quoteId: string; data: Partial<MaterialQuoteFormValues> }) => {
      const res = await apiRequest("PATCH", `/api/bids/${bidCode}/material-quotes/${quoteId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "material-quotes"] });
      toast({ title: "Success", description: "Material quote updated" });
      setShowMaterialQuoteDialog(false);
      setEditingMaterialQuote(null);
      materialForm.reset();
      setSupplierContactId(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update material quote",
        variant: "destructive",
      });
    },
  });

  // Delete material quote mutation
  const deleteMaterialQuote = useMutation({
    mutationFn: async (quoteId: string) => {
      const res = await apiRequest("DELETE", `/api/bids/${bidCode}/material-quotes/${quoteId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "material-quotes"] });
      toast({ title: "Success", description: "Material quote deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete material quote",
        variant: "destructive",
      });
    },
  });

  // Create equipment selection mutation
  const createEquipmentSelection = useMutation({
    mutationFn: async (data: EquipmentSelectionFormValues) => {
      const payload = {
        source: data.source,
        equipmentId: data.equipmentId || null,
        rentalCatalogId: data.rentalCatalogId || null,
        rentalVendorId: data.rentalVendorId || null,
        equipmentName: data.equipmentName,
        equipmentType: data.equipmentType,
        plannedHours: data.plannedHours ? parseFloat(data.plannedHours) : null,
        plannedDays: data.plannedDays ? parseInt(data.plannedDays) : null,
        hourlyRate: data.hourlyRate ? parseFloat(data.hourlyRate) : null,
        dailyRate: data.dailyRate ? parseFloat(data.dailyRate) : null,
        weeklyRate: data.weeklyRate ? parseFloat(data.weeklyRate) : null,
        estimatedCost: data.estimatedCost ? parseFloat(data.estimatedCost) : null,
        deliveryFee: data.deliveryFee ? parseFloat(data.deliveryFee) : null,
        notes: data.notes || null,
      };
      return apiRequest("POST", `/api/bids/${bid?.id}/equipment`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bid?.id, "equipment"] });
      toast({ title: "Success", description: "Equipment added to bid" });
      setShowEquipmentDialog(false);
      equipmentForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add equipment",
        variant: "destructive",
      });
    },
  });

  // Update equipment selection mutation
  const updateEquipmentSelection = useMutation({
    mutationFn: async ({ selectionId, data }: { selectionId: string; data: EquipmentSelectionFormValues }) => {
      const payload = {
        source: data.source,
        equipmentId: data.equipmentId || null,
        rentalCatalogId: data.rentalCatalogId || null,
        rentalVendorId: data.rentalVendorId || null,
        equipmentName: data.equipmentName,
        equipmentType: data.equipmentType,
        plannedHours: data.plannedHours ? parseFloat(data.plannedHours) : null,
        plannedDays: data.plannedDays ? parseInt(data.plannedDays) : null,
        hourlyRate: data.hourlyRate ? parseFloat(data.hourlyRate) : null,
        dailyRate: data.dailyRate ? parseFloat(data.dailyRate) : null,
        weeklyRate: data.weeklyRate ? parseFloat(data.weeklyRate) : null,
        estimatedCost: data.estimatedCost ? parseFloat(data.estimatedCost) : null,
        deliveryFee: data.deliveryFee ? parseFloat(data.deliveryFee) : null,
        notes: data.notes || null,
      };
      return apiRequest("PATCH", `/api/bids/${bid?.id}/equipment/${selectionId}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bid?.id, "equipment"] });
      toast({ title: "Success", description: "Equipment updated" });
      setShowEquipmentDialog(false);
      setEditingEquipmentSelection(null);
      equipmentForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update equipment",
        variant: "destructive",
      });
    },
  });

  // Delete equipment selection mutation
  const deleteEquipmentSelection = useMutation({
    mutationFn: async (selectionId: string) => {
      return apiRequest("DELETE", `/api/bids/${bid?.id}/equipment/${selectionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bid?.id, "equipment"] });
      toast({ title: "Success", description: "Equipment removed from bid" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove equipment",
        variant: "destructive",
      });
    },
  });

  // Toggle subcontractor quote selection
  const toggleQuoteSelection = useMutation({
    mutationFn: async ({ quoteId, isSelected }: { quoteId: string; isSelected: boolean }) => {
      const res = await apiRequest("PATCH", `/api/bids/${bidCode}/quotes/${quoteId}`, { isSelected });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "quotes"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update selection",
        variant: "destructive",
      });
    },
  });

  // Toggle material quote selection
  const toggleMaterialQuoteSelection = useMutation({
    mutationFn: async ({ quoteId, isSelected }: { quoteId: string; isSelected: boolean }) => {
      const res = await apiRequest("PATCH", `/api/bids/${bidCode}/material-quotes/${quoteId}`, { isSelected });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode, "material-quotes"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update selection",
        variant: "destructive",
      });
    },
  });

  // Update bid mutation
  const updateBidMutation = useMutation({
    mutationFn: async (data: BidEditFormValues) => {
      // Transform form strings to backend-compatible types
      const payload: any = {};
      
      // Only include non-empty values
      if (data.name) payload.name = data.name;
      if (data.clientName) payload.clientName = data.clientName;
      if (data.clientContactName) payload.clientContactName = data.clientContactName;
      if (data.clientContactEmail) payload.clientContactEmail = data.clientContactEmail;
      if (data.clientContactPhone) payload.clientContactPhone = data.clientContactPhone;
      if (data.gcName) payload.gcName = data.gcName;
      if (data.gcContactName) payload.gcContactName = data.gcContactName;
      if (data.gcContactEmail) payload.gcContactEmail = data.gcContactEmail;
      if (data.gcContactPhone) payload.gcContactPhone = data.gcContactPhone;
      if (data.bidAmount) payload.bidAmount = data.bidAmount; // Send as string (decimal)
      if (data.dueDate) payload.dueDate = new Date(data.dueDate); // Convert to Date object
      if (data.locationAddress) payload.locationAddress = data.locationAddress;
      if (data.city) payload.city = data.city;
      if (data.state) payload.state = data.state;
      if (data.description) payload.description = data.description;
      
      return apiRequest("PATCH", `/api/bids/${bidCode}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      toast({ title: "Success", description: "Bid updated successfully" });
      setShowEditBidDialog(false);
      setEditBidClientContactId(undefined);
      setEditBidGcContactId(undefined);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update bid",
        variant: "destructive",
      });
    },
  });

  const handleEditBid = () => {
    if (!bid) return;
    bidEditForm.reset({
      name: bid.name,
      clientName: bid.clientName,
      clientContactName: bid.clientContactName || "",
      clientContactEmail: bid.clientContactEmail || "",
      clientContactPhone: bid.clientContactPhone || "",
      bidAmount: bid.bidAmount || "",
      dueDate: bid.dueDate ? format(new Date(bid.dueDate), 'yyyy-MM-dd') : "",
      locationAddress: bid.locationAddress || "",
      city: bid.city || "",
      state: bid.state || "",
      description: bid.description || "",
    });
    setShowEditBidDialog(true);
  };

  const onSubmitEditBid = (data: BidEditFormValues) => {
    updateBidMutation.mutate(data);
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
      quote.fileUrl && quote.fileName ? {
        fileUrl: quote.fileUrl,
        fileName: quote.fileName,
        fileSize: quote.fileSize || 0,
        mimeType: quote.mimeType || "",
      } : null
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
    });
    setShowQuoteDialog(true);
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (confirm("Are you sure you want to delete this quote?")) {
      await deleteQuote.mutateAsync(quoteId);
    }
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
      quote.fileUrl && quote.fileName ? {
        fileUrl: quote.fileUrl,
        fileName: quote.fileName,
        fileSize: quote.fileSize || 0,
        mimeType: quote.mimeType || "",
      } : null
    );
    materialForm.reset({
      materialName: quote.materialName,
      description: quote.description || "",
      cost: quote.cost,
      specs: quote.specs || "",
      leadTime: quote.leadTime || "",
      supplierName: quote.supplierName || "",
      supplierContact: quote.supplierContact || "",
    });
    setShowMaterialQuoteDialog(true);
  };

  const handleDeleteMaterialQuote = async (quoteId: string) => {
    if (confirm("Are you sure you want to delete this material quote?")) {
      await deleteMaterialQuote.mutateAsync(quoteId);
    }
  };

  // Equipment selection handlers
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
    if (confirm("Are you sure you want to remove this equipment from the bid?")) {
      await deleteEquipmentSelection.mutateAsync(selectionId);
    }
  };

  const onSubmitEquipment = (data: EquipmentSelectionFormValues) => {
    if (editingEquipmentSelection) {
      updateEquipmentSelection.mutate({ selectionId: editingEquipmentSelection.id, data });
    } else {
      createEquipmentSelection.mutate(data);
    }
  };

  const handleSelectOwnedEquipment = (equipmentId: string) => {
    const selected = availableEquipment?.owned.find(e => e.id === equipmentId);
    if (selected) {
      equipmentForm.setValue("equipmentId", selected.id);
      equipmentForm.setValue("equipmentName", selected.name);
      equipmentForm.setValue("equipmentType", selected.type);
      equipmentForm.setValue("hourlyRate", selected.hourlyRate || "");
      equipmentForm.setValue("dailyRate", selected.dailyRate || "");
      equipmentForm.setValue("weeklyRate", selected.weeklyRate || "");
    }
  };

  const handleSelectRentalEquipment = (catalogId: string) => {
    const selected = availableEquipment?.rental.find(e => e.id === catalogId);
    if (selected) {
      equipmentForm.setValue("rentalCatalogId", selected.id);
      equipmentForm.setValue("rentalVendorId", selected.vendorId);
      equipmentForm.setValue("equipmentName", selected.name);
      equipmentForm.setValue("equipmentType", selected.equipmentType);
      equipmentForm.setValue("hourlyRate", selected.hourlyRate || "");
      equipmentForm.setValue("dailyRate", selected.dailyRate || "");
      equipmentForm.setValue("weeklyRate", selected.weeklyRate || "");
      equipmentForm.setValue("deliveryFee", selected.deliveryFee || "");
    }
  };

  // Calculate estimated cost based on rate and duration
  const calculateEstimatedCost = () => {
    const hours = parseFloat(equipmentForm.watch("plannedHours") || "0");
    const days = parseInt(equipmentForm.watch("plannedDays") || "0");
    const hourlyRate = parseFloat(equipmentForm.watch("hourlyRate") || "0");
    const dailyRate = parseFloat(equipmentForm.watch("dailyRate") || "0");
    const deliveryFee = parseFloat(equipmentForm.watch("deliveryFee") || "0");
    
    let cost = 0;
    if (days > 0 && dailyRate > 0) {
      cost = days * dailyRate;
    } else if (hours > 0 && hourlyRate > 0) {
      cost = hours * hourlyRate;
    }
    cost += deliveryFee;
    
    if (cost > 0) {
      equipmentForm.setValue("estimatedCost", cost.toFixed(2));
    }
  };

  // Calculate total equipment cost
  const totalEquipmentCost = equipmentSelections.reduce((sum, sel) => {
    return sum + parseFloat(sel.estimatedCost || "0");
  }, 0);

  const onGetUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleFileUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    try {
      if (!result.successful || result.successful.length === 0) {
        throw new Error("No file uploaded");
      }

      const uploadedFile = result.successful[0];
      const file = uploadedFile.data as File;
      const uploadUrl = uploadedFile.uploadURL;
      const filePath = uploadUrl?.split('?')[0] || '';

      setUploadedFileData({
        fileUrl: filePath,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });

      toast({ title: "Success", description: "Quote document uploaded" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to process uploaded file", variant: "destructive" });
    } finally {
      setIsUploadingFile(false);
    }
  };

  const onGetUploadParametersMaterial = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  const handleMaterialFileUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    try {
      if (!result.successful || result.successful.length === 0) {
        throw new Error("No file uploaded");
      }

      const uploadedFile = result.successful[0];
      const file = uploadedFile.data as File;
      const uploadUrl = uploadedFile.uploadURL;
      const filePath = uploadUrl?.split('?')[0] || '';

      setUploadedMaterialFileData({
        fileUrl: filePath,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });

      toast({ title: "Success", description: "Material quote document uploaded" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to process uploaded file", variant: "destructive" });
    } finally {
      setIsUploadingMaterialFile(false);
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

    if (editingQuote) {
      await updateQuote.mutateAsync({ quoteId: editingQuote.id, data: payload });
    } else {
      await createQuote.mutateAsync(payload as QuoteFormValues);
    }
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

    if (editingMaterialQuote) {
      await updateMaterialQuote.mutateAsync({ quoteId: editingMaterialQuote.id, data: payload });
    } else {
      await createMaterialQuote.mutateAsync(payload as MaterialQuoteFormValues);
    }
  };

  const totalQuotes = quotes.reduce((sum, q) => sum + Number(q.quoteAmount || 0), 0);
  const totalMaterialQuotes = materialQuotes.reduce((sum, q) => sum + Number(q.cost || 0), 0);
  const estimate = estimateData?.estimate || null;

  // Create estimate mutation
  const createEstimateMutation = useMutation({
    mutationFn: () => {
      if (!bid?.id) throw new Error("Bid ID is required");
      return apiRequest("POST", `/api/bids/${bid.id}/estimate`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bid?.id) });
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] }); // Refresh bid list with estimate summary
      toast({ title: "Success", description: "Estimate created successfully" });
      // Navigate to estimate view
      setLocation(`/bids/${bidCode}/estimate`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create estimate",
        variant: "destructive",
      });
    },
  });

  const handleMarkAsAwarded = () => {
    if (!bid) return;
    setShowAwardDialog(true);
  };

  const handleConfirmAward = async () => {
    if (!bid) return;
    
    try {
      await convertBid.mutateAsync({
        code: bid.code,
        superintendentId: selectedSuperintendentId || undefined,
        projectManagerId: selectedProjectManagerId || undefined,
      });
      toast({
        title: "Success",
        description: "Bid has been awarded and moved to Active Projects!",
      });
      setShowAwardDialog(false);
      setLocation('/projects');
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to convert bid to project",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading bid details...</p>
        </div>
      </div>
    );
  }

  if (!bid) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Bid not found</p>
        </div>
      </div>
    );
  }

  const locationString = [bid.locationAddress, bid.city, bid.state]
    .filter(Boolean)
    .join(', ') || 'No location specified';

  // Cost aggregation for all sections
  const totalMaterialCost = materialQuotes
    .filter((q: any) => q.isSelected)
    .reduce((sum, q) => sum + Number(q.cost || 0), 0);
  
  const totalEquipmentCostCalc = equipmentSelections.reduce((sum, sel) => 
    sum + parseFloat(sel.estimatedCost || "0"), 0);
  
  const estimateTotals = estimateData?.estimate?.totals || {
    laborCost: 0,
    materialCost: 0,
    equipmentCost: 0,
    consumablesCost: 0,
    subcontractCost: 0,
    totalCost: 0,
    laborHours: 0,
  };
  
  const totalSubcontractorCost = quotes
    .filter((q: any) => q.isSelected)
    .reduce((sum, q) => sum + Number(q.quoteAmount || 0), 0);

  // Direct cost is the sum of all cost categories
  const directCost = totalMaterialCost + totalEquipmentCostCalc + estimateTotals.laborCost + totalSubcontractorCost;
  const overheadAmount = directCost * (overheadPercent / 100);
  const subtotalWithOverhead = directCost + overheadAmount;
  const profitAmount = subtotalWithOverhead * (profitPercent / 100);
  const finalBidAmount = subtotalWithOverhead + profitAmount;

  // Step completion status
  const stepStatus = {
    1: materialQuotes.length > 0,
    2: equipmentSelections.length > 0,
    3: (estimateData?.estimate?.lineItems?.length || 0) > 0,
    4: quotes.length > 0,
    5: true, // Summary is always accessible
  };

  // Step definitions
  const steps = [
    { id: 1, name: "Scope of Work", icon: FileText, cost: estimateTotals.laborCost + estimateTotals.materialCost },
    { id: 2, name: "Materials & Supplies", icon: Package, cost: totalMaterialCost },
    { id: 3, name: "Equipment", icon: Truck, cost: totalEquipmentCostCalc },
    { id: 4, name: "Subcontractors", icon: Users, cost: totalSubcontractorCost },
    { id: 5, name: "Bid Summary", icon: Calculator, cost: finalBidAmount },
  ];

  // Derive material requirements from SOW estimate line items
  const derivedMaterialRequirements = estimate?.lineItems?.filter(item => 
    Number(item.materialCost) > 0 || ["CONCRETE", "FLATWORK", "EXCAVATION", "GRADING", "STONE", "REBAR", "WIRE_MESH"].includes(item.category)
  ).map(item => ({
    id: item.id,
    category: item.category,
    description: item.description,
    unit: item.unit,
    quantity: Number(item.quantity),
    materialCost: Number(item.materialCost),
    needsVendorSelection: !materialQuotes.some(mq => mq.materialName?.toLowerCase().includes(item.description.toLowerCase())),
  })) || [];

  // Derive equipment requirements from SOW estimate line items  
  const derivedEquipmentRequirements = estimate?.lineItems?.filter(item => 
    Number(item.equipmentCost) > 0 || ["EXCAVATION", "GRADING", "DEMOLITION", "HAULING"].includes(item.category)
  ).map(item => ({
    id: item.id,
    category: item.category,
    description: item.description,
    equipmentCost: Number(item.equipmentCost),
    needsEquipmentSelection: !equipmentSelections.some(eq => eq.notes?.toLowerCase().includes(item.description.toLowerCase())),
  })) || [];

  // Derive subcontractor requirements from SOW estimate line items
  const derivedSubRequirements = estimate?.lineItems?.filter(item => 
    Number(item.subcontractCost) > 0 || ["PLUMBING", "ELECTRICAL", "HVAC", "LANDSCAPING", "FENCING", "MASONRY"].includes(item.category)
  ).map(item => ({
    id: item.id,
    category: item.category,
    description: item.description,
    subcontractCost: Number(item.subcontractCost),
    needsSubSelection: !quotes.some(q => q.scopeOfWork?.toLowerCase().includes(item.description.toLowerCase())),
  })) || [];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => setLocation('/bids')} data-testid="button-back">
            ← Back to Bid Board
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="font-mono">
                {bid.code}
              </Badge>
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                BID IN PROGRESS
              </Badge>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{bid.name}</h1>
            <p className="text-sm text-muted-foreground">{bid.clientName} • {locationString}</p>
          </div>
          {canEditBids(user?.role) && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleEditBid} data-testid="button-edit-bid-header">
                <Edit className="w-4 h-4 mr-2" />
                Edit Bid Info
              </Button>
              <Button onClick={handleMarkAsAwarded} data-testid="button-mark-awarded">
                Mark as Awarded
              </Button>
            </div>
          )}
        </div>

        {/* Cost Builder Stepper Layout */}
        <div className="flex gap-6">
          {/* Left Sidebar - Stepper Navigation */}
          <div className="w-72 flex-shrink-0">
            <Card className="sticky top-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Cost Builder</CardTitle>
                <CardDescription>Build your bid step by step</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <nav className="flex flex-col">
                  {steps.map((step, index) => {
                    const StepIcon = step.icon;
                    const isActive = currentStep === step.id;
                    const isCompleted = stepStatus[step.id as keyof typeof stepStatus];
                    
                    return (
                      <button
                        key={step.id}
                        onClick={() => setCurrentStep(step.id as CostBuilderStep)}
                        className={`flex items-center gap-3 px-4 py-3 text-left border-l-2 transition-colors ${
                          isActive 
                            ? 'border-l-primary bg-primary/5 text-foreground' 
                            : 'border-l-transparent hover:bg-muted/50 text-muted-foreground'
                        }`}
                        data-testid={`step-${step.id}`}
                      >
                        <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                          isActive 
                            ? 'bg-primary text-primary-foreground' 
                            : isCompleted 
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                              : 'bg-muted text-muted-foreground'
                        }`}>
                          {isCompleted && !isActive ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <StepIcon className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${isActive ? 'text-foreground' : ''}`}>
                            {step.name}
                          </p>
                          {step.cost > 0 && (
                            <p className="text-xs font-mono text-muted-foreground">
                              ${step.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                          )}
                        </div>
                        {isActive && (
                          <ChevronRight className="w-4 h-4 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </nav>
                
                {/* Running Total */}
                <div className="p-4 border-t bg-muted/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Direct Cost</span>
                    <span className="font-mono text-sm">${directCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">+ Overhead ({overheadPercent}%)</span>
                    <span className="font-mono text-sm">${overheadAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">+ Profit ({profitPercent}%)</span>
                    <span className="font-mono text-sm text-green-600 dark:text-green-400">${profitAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-sm font-semibold">Final Bid</span>
                    <span className="font-mono font-bold text-lg">${finalBidAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Content - Active Step */}
          <div className="flex-1 min-w-0 space-y-6">
            
            {/* Step 2: Materials & Supplies */}
            {currentStep === 2 && (
              <Card data-testid="card-material-quotes">
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="w-5 h-5" />
                      Step 2: Material & Supply Quotes
                    </CardTitle>
                    <CardDescription>Get quotes from suppliers for materials identified in the Scope of Work</CardDescription>
                  </div>
                  {canEditBids(user?.role) && (
                    <Button onClick={handleAddMaterialQuote} size="sm" data-testid="button-add-material-quote">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Quote
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {/* Derived Material Requirements from SOW */}
                  {derivedMaterialRequirements.length > 0 && (
                    <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Material Requirements from SOW ({derivedMaterialRequirements.length} items)
                      </h4>
                      <div className="space-y-2">
                        {derivedMaterialRequirements.map((req) => (
                          <div key={req.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">{req.category}</Badge>
                              <span className="text-muted-foreground">{req.description}</span>
                              <span className="text-muted-foreground">({req.quantity} {req.unit})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">${req.materialCost.toLocaleString()}</span>
                              {req.needsVendorSelection ? (
                                <Badge variant="outline" className="text-orange-600 border-orange-300">Needs Quote</Badge>
                              ) : (
                                <Badge variant="outline" className="text-green-600 border-green-300">Quote Added</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {materialQuotesLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading material quotes...</div>
                  ) : materialQuotes.length === 0 && derivedMaterialRequirements.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Package className="w-12 h-12 mx-auto mb-4 opacity-40" />
                      <p className="font-medium mb-1">No material requirements yet</p>
                      <p className="text-sm mb-4">Add scope items with material costs in Step 1 to see requirements here</p>
                    </div>
                  ) : materialQuotes.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="font-medium mb-1">No supplier quotes added yet</p>
                      <p className="text-sm mb-4">Add quotes from suppliers to finalize material costs</p>
                      {canEditBids(user?.role) && (
                        <Button onClick={handleAddMaterialQuote} variant="outline" data-testid="button-add-first-material-quote">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Your First Quote
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-muted rounded-md">
                        <span className="text-sm font-medium">Selected Material Cost:</span>
                        <span className="text-lg font-bold font-mono">${totalMaterialCost.toLocaleString()}</span>
                      </div>
                      <div className="space-y-3">
                        {materialQuotes.map((quote) => (
                          <div 
                            key={quote.id} 
                            className={`flex items-start justify-between p-4 border rounded-md transition-colors ${
                              (quote as any).isSelected 
                                ? 'border-green-500 bg-green-50 dark:bg-green-950/20' 
                                : ''
                            }`}
                            data-testid={`material-quote-${quote.id}`}
                          >
                            <div className="flex gap-3 flex-1">
                              <div className="pt-1">
                                <Checkbox
                                  checked={(quote as any).isSelected || false}
                                  onCheckedChange={(checked) => {
                                    toggleMaterialQuoteSelection.mutate({ 
                                      quoteId: quote.id, 
                                      isSelected: !!checked 
                                    });
                                  }}
                                  disabled={toggleMaterialQuoteSelection.isPending}
                                  data-testid={`checkbox-material-quote-${quote.id}`}
                                />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                  <h4 className="font-medium">{quote.materialName}</h4>
                                  <Badge variant="outline" className="font-mono">
                                    ${Number(quote.cost).toLocaleString()}
                                  </Badge>
                                  {(quote as any).isSelected && (
                                    <Badge variant="default" className="gap-1 bg-green-600">
                                      <CheckCircle2 className="w-3 h-3" />
                                      Selected
                                    </Badge>
                                  )}
                                </div>
                                {quote.description && (
                                  <p className="text-sm text-muted-foreground mb-2">{quote.description}</p>
                                )}
                                {quote.supplierName && (
                                  <p className="text-xs text-muted-foreground">Supplier: {quote.supplierName}</p>
                                )}
                                {quote.leadTime && (
                                  <p className="text-xs text-muted-foreground">Lead Time: {quote.leadTime}</p>
                                )}
                              </div>
                            </div>
                            {canEditBids(user?.role) && (
                              <div className="flex gap-2 ml-4">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleEditMaterialQuote(quote)}
                                  data-testid={`button-edit-material-quote-${quote.id}`}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleDeleteMaterialQuote(quote.id)}
                                  data-testid={`button-delete-material-quote-${quote.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between pt-4">
                        <Button variant="outline" onClick={() => setCurrentStep(1)} data-testid="button-prev-step-2">
                          Back to Scope of Work
                        </Button>
                        <Button onClick={() => setCurrentStep(3)} data-testid="button-next-step-2">
                          Continue to Equipment
                          <ChevronRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 3: Equipment */}
            {currentStep === 3 && (
              <Card data-testid="card-equipment-selections">
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Truck className="w-5 h-5" />
                      Step 3: Equipment Selection
                    </CardTitle>
                    <CardDescription>Select equipment identified in the Scope of Work from your fleet or rentals</CardDescription>
                  </div>
                  {canEditBids(user?.role) && (
                    <Button onClick={handleAddEquipment} size="sm" data-testid="button-add-equipment">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Equipment
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {/* Derived Equipment Requirements from SOW */}
                  {derivedEquipmentRequirements.length > 0 && (
                    <div className="mb-6 p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
                      <h4 className="text-sm font-semibold text-purple-800 dark:text-purple-300 mb-3 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Equipment Requirements from SOW ({derivedEquipmentRequirements.length} items)
                      </h4>
                      <div className="space-y-2">
                        {derivedEquipmentRequirements.map((req) => (
                          <div key={req.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">{req.category}</Badge>
                              <span className="text-muted-foreground">{req.description}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">${req.equipmentCost.toLocaleString()}</span>
                              {req.needsEquipmentSelection ? (
                                <Badge variant="outline" className="text-orange-600 border-orange-300">Needs Selection</Badge>
                              ) : (
                                <Badge variant="outline" className="text-green-600 border-green-300">Selected</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {equipmentLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading equipment...</div>
                  ) : equipmentSelections.length === 0 && derivedEquipmentRequirements.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Truck className="w-12 h-12 mx-auto mb-4 opacity-40" />
                      <p className="font-medium mb-1">No equipment requirements yet</p>
                      <p className="text-sm mb-4">Add scope items with equipment costs in Step 1 to see requirements here</p>
                    </div>
                  ) : equipmentSelections.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="font-medium mb-1">No equipment selected yet</p>
                      <p className="text-sm mb-4">Select equipment from your fleet or add rentals</p>
                      {canEditBids(user?.role) && (
                        <Button onClick={handleAddEquipment} variant="outline" data-testid="button-add-first-equipment">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Equipment
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-muted rounded-md">
                        <span className="text-sm font-medium">Total Equipment Cost:</span>
                        <span className="text-lg font-bold font-mono">${totalEquipmentCostCalc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="space-y-3">
                        {equipmentSelections.map((selection) => (
                          <div 
                            key={selection.id} 
                            className="flex items-start justify-between p-4 border rounded-md"
                            data-testid={`equipment-selection-${selection.id}`}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2 flex-wrap">
                                <h4 className="font-medium">{selection.equipmentName}</h4>
                                <Badge variant={selection.source === "OWNED" ? "default" : "secondary"}>
                                  {selection.source === "OWNED" ? (
                                    <><Wrench className="w-3 h-3 mr-1" />Owned</>
                                  ) : (
                                    <><Clock className="w-3 h-3 mr-1" />Rental</>
                                  )}
                                </Badge>
                                <Badge variant="outline">{selection.equipmentType}</Badge>
                                {selection.estimatedCost && (
                                  <Badge variant="outline" className="font-mono">
                                    ${parseFloat(selection.estimatedCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </Badge>
                                )}
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                                {selection.plannedDays && (
                                  <div><span className="font-medium">Days:</span> {selection.plannedDays}</div>
                                )}
                                {selection.plannedHours && (
                                  <div><span className="font-medium">Hours:</span> {selection.plannedHours}</div>
                                )}
                                {selection.dailyRate && (
                                  <div><span className="font-medium">Daily Rate:</span> ${parseFloat(selection.dailyRate).toLocaleString()}</div>
                                )}
                              </div>
                            </div>
                            {canEditBids(user?.role) && (
                              <div className="flex gap-2 ml-4">
                                <Button size="icon" variant="ghost" onClick={() => handleEditEquipmentSelection(selection)}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={() => handleDeleteEquipmentSelection(selection.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between pt-4">
                        <Button variant="outline" onClick={() => setCurrentStep(2)} data-testid="button-prev-step-3">
                          Back to Materials
                        </Button>
                        <Button onClick={() => setCurrentStep(4)} data-testid="button-next-step-3">
                          Continue to Subcontractors
                          <ChevronRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 1: Scope of Work / Estimate */}
            {currentStep === 1 && (
              <Card data-testid="card-bid-estimate">
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Calculator className="w-5 h-5" />
                      Step 1: Scope of Work
                    </CardTitle>
                    <CardDescription>Start by defining the work scope - this will auto-populate material, equipment, and subcontractor requirements</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {!estimate && canEditBids(user?.role) && (
                      <Button 
                        onClick={() => createEstimateMutation.mutate()} 
                        disabled={createEstimateMutation.isPending}
                        size="sm" 
                        data-testid="button-create-estimate"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Create Estimate
                      </Button>
                    )}
                    {estimate && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLocation(`/bids/${bidCode}/estimate`)}
                        data-testid="button-view-estimate"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Open Full Estimate
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {estimateLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading estimate...</div>
                  ) : !estimate ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Calculator className="h-12 w-12 mx-auto mb-4 opacity-40" />
                      <p className="font-medium mb-1">No estimate created yet</p>
                      <p className="text-sm mb-4">Create an estimate to define scope quantities and track labor costs</p>
                      {canEditBids(user?.role) && (
                        <Button 
                          onClick={() => createEstimateMutation.mutate()} 
                          disabled={createEstimateMutation.isPending}
                          variant="outline"
                          data-testid="button-create-first-estimate"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Create Estimate
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="border rounded-md divide-y">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                          <span className="text-sm font-medium">Total Estimate</span>
                          <div className="text-right min-w-0">
                            <span className="text-lg font-bold font-mono" data-testid="text-estimate-total">
                              ${estimate.totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">({estimate.lineItems.length} items)</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                          <span className="text-sm font-medium">Labor Cost</span>
                          <div className="text-right min-w-0">
                            <span className="font-mono font-semibold">
                              ${estimate.totals.laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">({estimate.totals.laborHours.toFixed(1)} hrs)</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                          <span className="text-sm font-medium">Material Cost</span>
                          <span className="font-mono font-semibold min-w-0">
                            ${estimate.totals.materialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                          <span className="text-sm font-medium">Status</span>
                          <Badge variant={estimate.status === "APPROVED" ? "default" : "secondary"}>
                            {estimate.status}
                          </Badge>
                        </div>
                      </div>
                      
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => setLocation(`/bids/${bidCode}/estimate`)}
                        data-testid="button-edit-estimate-items"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        Edit Estimate Line Items
                      </Button>
                      
                      <div className="flex justify-end pt-4">
                        <Button onClick={() => setCurrentStep(2)} data-testid="button-next-step-1">
                          Continue to Materials
                          <ChevronRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 4: Subcontractors */}
            {currentStep === 4 && (
              <Card data-testid="card-subcontractor-quotes">
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Step 4: Subcontractor Quotes
                    </CardTitle>
                    <CardDescription>Get quotes from subcontractors for specialized work</CardDescription>
                  </div>
                  {canEditBids(user?.role) && (
                    <Button onClick={handleAddQuote} size="sm" data-testid="button-add-quote">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Quote
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {/* Derived Subcontractor Requirements from SOW */}
                  {derivedSubRequirements.length > 0 && (
                    <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                      <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-3 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Subcontractor Requirements from SOW ({derivedSubRequirements.length} items)
                      </h4>
                      <div className="space-y-2">
                        {derivedSubRequirements.map((req) => (
                          <div key={req.id} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs">{req.category}</Badge>
                              <span className="text-muted-foreground">{req.description}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">${req.subcontractCost.toLocaleString()}</span>
                              {req.needsSubSelection ? (
                                <Badge variant="outline" className="text-orange-600 border-orange-300">Needs Quote</Badge>
                              ) : (
                                <Badge variant="outline" className="text-green-600 border-green-300">Quote Added</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {quotesLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading quotes...</div>
                  ) : quotes.length === 0 && derivedSubRequirements.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Users className="w-12 h-12 mx-auto mb-4 opacity-40" />
                      <p className="font-medium mb-1">No subcontractor requirements yet</p>
                      <p className="text-sm mb-4">Add scope items with subcontract costs in Step 1 to see requirements here</p>
                    </div>
                  ) : quotes.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="font-medium mb-1">No subcontractor quotes added yet</p>
                      <p className="text-sm mb-4">Add quotes from subs for specialized scope items</p>
                      {canEditBids(user?.role) && (
                        <Button onClick={handleAddQuote} variant="outline" data-testid="button-add-first-quote">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Subcontractor Quote
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-muted rounded-md">
                        <span className="text-sm font-medium">Selected Subcontractor Cost:</span>
                        <span className="text-lg font-bold font-mono">${totalSubcontractorCost.toLocaleString()}</span>
                      </div>
                      <div className="space-y-3">
                        {quotes.map((quote) => (
                          <div 
                            key={quote.id} 
                            className={`flex items-start justify-between p-4 border rounded-md transition-colors ${
                              (quote as any).isSelected 
                                ? 'border-green-500 bg-green-50 dark:bg-green-950/20' 
                                : ''
                            }`}
                            data-testid={`quote-${quote.id}`}
                          >
                            <div className="flex gap-3 flex-1">
                              <div className="pt-1">
                                <Checkbox
                                  checked={(quote as any).isSelected || false}
                                  onCheckedChange={(checked) => {
                                    toggleQuoteSelection.mutate({ 
                                      quoteId: quote.id, 
                                      isSelected: !!checked 
                                    });
                                  }}
                                  disabled={toggleQuoteSelection.isPending}
                                  data-testid={`checkbox-quote-${quote.id}`}
                                />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2 flex-wrap">
                                  <h4 className="font-medium">{quote.subcontractorName}</h4>
                                  <Badge variant="outline" className="font-mono">
                                    ${Number(quote.quoteAmount).toLocaleString()}
                                  </Badge>
                                  {(quote as any).isSelected && (
                                    <Badge variant="default" className="gap-1 bg-green-600">
                                      <CheckCircle2 className="w-3 h-3" />
                                      Selected
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground mb-1">{quote.scopeOfWork}</p>
                                {quote.contactName && (
                                  <p className="text-xs text-muted-foreground">Contact: {quote.contactName}</p>
                                )}
                              </div>
                            </div>
                            {canEditBids(user?.role) && (
                              <div className="flex gap-2 ml-4">
                                <Button size="icon" variant="ghost" onClick={() => handleEditQuote(quote)}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={() => handleDeleteQuote(quote.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between pt-4">
                        <Button variant="outline" onClick={() => setCurrentStep(3)} data-testid="button-prev-step-4">
                          Back to Equipment
                        </Button>
                        <Button onClick={() => setCurrentStep(5)} data-testid="button-next-step-4">
                          Continue to Bid Summary
                          <ChevronRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Step 5: Bid Summary */}
            {currentStep === 5 && (
              <div className="space-y-6">
                <Card data-testid="card-bid-summary">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calculator className="w-5 h-5" />
                      Step 5: Bid Summary & Pricing
                    </CardTitle>
                    <CardDescription>Review costs and set your overhead and profit margins</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Cost Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="p-4 bg-muted rounded-md">
                        <div className="flex items-center gap-2 mb-1">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <p className="text-sm font-medium">Materials</p>
                        </div>
                        <p className="text-lg font-bold font-mono">${totalMaterialCost.toLocaleString()}</p>
                      </div>
                      <div className="p-4 bg-muted rounded-md">
                        <div className="flex items-center gap-2 mb-1">
                          <Truck className="w-4 h-4 text-muted-foreground" />
                          <p className="text-sm font-medium">Equipment</p>
                        </div>
                        <p className="text-lg font-bold font-mono">${totalEquipmentCostCalc.toLocaleString()}</p>
                      </div>
                      <div className="p-4 bg-muted rounded-md">
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <p className="text-sm font-medium">Labor</p>
                        </div>
                        <p className="text-lg font-bold font-mono">${estimateTotals.laborCost.toLocaleString()}</p>
                      </div>
                      <div className="p-4 bg-muted rounded-md">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          <p className="text-sm font-medium">Subcontractors</p>
                        </div>
                        <p className="text-lg font-bold font-mono">${totalSubcontractorCost.toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Direct Cost */}
                    <div className="p-4 border rounded-md bg-muted/30">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-semibold">Direct Cost (Total)</span>
                        <span className="text-xl font-bold font-mono">${directCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* Overhead Slider */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">Overhead</Label>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-lg">{overheadPercent}%</span>
                          <span className="text-muted-foreground">= ${overheadAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                      <Slider
                        value={[overheadPercent]}
                        onValueChange={(value) => setOverheadPercent(value[0])}
                        min={0}
                        max={30}
                        step={1}
                        className="w-full"
                        data-testid="slider-overhead"
                      />
                      <p className="text-xs text-muted-foreground">Covers administrative costs, office expenses, insurance, etc.</p>
                    </div>

                    {/* Profit Slider */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-base font-semibold">Profit Margin</Label>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-lg text-green-600 dark:text-green-400">{profitPercent}%</span>
                          <span className="text-green-600 dark:text-green-400">= ${profitAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                      <Slider
                        value={[profitPercent]}
                        onValueChange={(value) => setProfitPercent(value[0])}
                        min={0}
                        max={40}
                        step={1}
                        className="w-full"
                        data-testid="slider-profit"
                      />
                      <p className="text-xs text-muted-foreground">Your target profit margin on this project</p>
                    </div>

                    {/* Final Bid Amount */}
                    <div className="p-6 bg-primary/10 rounded-md border border-primary/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xl font-bold">Final Bid Amount</span>
                          <p className="text-sm text-muted-foreground mt-1">Direct Cost + Overhead + Profit</p>
                        </div>
                        <span className="text-3xl font-bold font-mono" data-testid="text-final-bid-amount">
                          ${finalBidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {/* PDF Generation Buttons */}
                    {canGenerateBidPDFs(user?.role) && (
                      <div className="p-4 bg-muted/30 rounded-md border">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Generate Documents
                        </h4>
                        <div className="flex flex-wrap gap-3">
                          <Button 
                            variant="outline" 
                            onClick={() => window.open(`/api/bids/${bidCode}/pdf/internal-summary`, '_blank')}
                            data-testid="button-download-internal-pdf"
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Internal Bid Summary (PDF)
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={() => window.open(`/api/bids/${bidCode}/pdf/customer-quote`, '_blank')}
                            data-testid="button-download-customer-pdf"
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            Customer Quote (PDF)
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Internal summary includes all vendor quotes and detailed costs. Customer quote shows only scope of work and final pricing.
                        </p>
                      </div>
                    )}

                    <div className="flex justify-between pt-4">
                      <Button variant="outline" onClick={() => setCurrentStep(4)} data-testid="button-prev-step-5">
                        Back to Subcontractors
                      </Button>
                      {canEditBids(user?.role) && (
                        <Button onClick={handleMarkAsAwarded} data-testid="button-award-bid">
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Award Bid & Create Project
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Document Distribution */}
                <BidDocumentDistribution
                  bidId={bid?.id}
                  projectId={bid?.projectId || undefined}
                  projectName={bid?.name}
                  userRole={user?.role || ""}
                />

                {/* Additional Info Cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Bid Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-start gap-3">
                        <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">Current Bid Amount</p>
                          <p className="text-lg font-bold font-mono">
                            {bid.bidAmount ? `$${Number(bid.bidAmount).toLocaleString()}` : 'Not Set'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">Due Date</p>
                          <p className="text-sm text-muted-foreground">
                            {bid.dueDate ? format(new Date(bid.dueDate), 'PPP') : 'Not set'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">Client</p>
                          <p className="text-sm text-muted-foreground">{bid.clientName}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Documents & Handoff</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Button
                        className="w-full justify-start"
                        variant="outline"
                        onClick={() => setLocation(`/bids/${bidCode}/estimate`)}
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        View Full Estimate
                      </Button>
                      <JobInformationForm bidCode={bidCode} />
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* Dialogs remain below */}
      <Dialog open={showEditBidDialog} onOpenChange={setShowEditBidDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Bid</DialogTitle>
            <DialogDescription>Update the bid details</DialogDescription>
          </DialogHeader>
          <Form {...bidEditForm}>
            <form onSubmit={bidEditForm.handleSubmit(onSubmitEditBid)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={bidEditForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Project name" data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bidEditForm.control}
                  name="bidAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bid Amount</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} type="number" step="0.01" placeholder="0.00" data-testid="input-bid-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={bidEditForm.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Due Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            data-testid="input-due-date"
                          >
                            {field.value ? format(parseISO(field.value), "PPP") : "Pick a date"}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarPicker
                          mode="single"
                          selected={field.value ? parseISO(field.value) : undefined}
                          onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : "")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={bidEditForm.control}
                  name="locationAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="123 Main St" data-testid="input-location-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bidEditForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="City" data-testid="input-city" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bidEditForm.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="State" data-testid="input-state" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={bidEditForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Project details..." rows={3} data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEditBidDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateBidMutation.isPending}>
                  {updateBidMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={showQuoteDialog} onOpenChange={setShowQuoteDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingQuote ? "Edit Quote" : "Add Subcontractor Quote"}</DialogTitle>
            <DialogDescription>
              {editingQuote ? "Update the subcontractor quote details" : "Add a new quote from a subcontractor"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitQuote)} className="space-y-4">
              <div className="space-y-2">
                <Label>Select from CRM</Label>
                <CrmOrganizationSelector
                  value={form.watch("subcontractorName")}
                  filterTypes={["SUBCONTRACTOR"]}
                  placeholder="Select or search for a subcontractor..."
                  selectedContactId={subcontractorContactId}
                  onSelect={(org) => {
                    if (org) {
                      form.setValue("subcontractorName", org.name);
                    } else {
                      form.setValue("subcontractorName", "");
                      form.setValue("contactName", "");
                      form.setValue("contactEmail", "");
                      form.setValue("contactPhone", "");
                      setSubcontractorContactId(undefined);
                    }
                  }}
                  onContactSelect={(contact) => {
                    if (contact) {
                      setSubcontractorContactId(contact.id);
                      form.setValue("contactName", `${contact.firstName} ${contact.lastName}`);
                      form.setValue("contactEmail", contact.email || "");
                      form.setValue("contactPhone", contact.phone || contact.mobile || "");
                    } else {
                      setSubcontractorContactId(undefined);
                      form.setValue("contactName", "");
                      form.setValue("contactEmail", "");
                      form.setValue("contactPhone", "");
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="subcontractorName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subcontractor Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Company name" data-testid="input-subcontractor-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="quoteAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quote Amount ($)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-quote-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {estimateData?.estimate && (
                <div className="space-y-2">
                  <Label>Link to Scope Item</Label>
                  <StandardizedScopeSelector
                    value={scopeSelectionData}
                    onChange={(data) => {
                      setScopeSelectionData(data);
                      if (data) {
                        form.setValue("scopeOfWork", data.canonicalName || data.workTypeName || "");
                      }
                    }}
                  />
                </div>
              )}
              <FormField
                control={form.control}
                name="scopeOfWork"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scope of Work</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Describe the work to be performed..." rows={3} data-testid="input-scope-of-work" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Contact person" data-testid="input-contact-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} type="email" placeholder="email@example.com" data-testid="input-contact-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="(555) 123-4567" data-testid="input-contact-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." rows={2} data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <Label>Quote Document</Label>
                {uploadedFileData ? (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                    <FileText className="w-4 h-4" />
                    <span className="text-sm flex-1 truncate">{uploadedFileData.fileName}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setUploadedFileData(null)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <ObjectUploader
                    onGetUploadParameters={onGetUploadParameters}
                    onComplete={(result) => {
                      setIsUploadingFile(true);
                      handleFileUploadComplete(result);
                    }}
                    allowedFileTypes={[".pdf", ".xlsx", ".docx", ".png", ".jpg"]}
                    maxFileSize={10 * 1024 * 1024}
                  >
                    Upload Quote Document
                  </ObjectUploader>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowQuoteDialog(false); setUploadedFileData(null); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createQuote.isPending || updateQuote.isPending || isUploadingFile}>
                  {editingQuote ? (updateQuote.isPending ? "Saving..." : "Save Changes") : (createQuote.isPending ? "Adding..." : "Add Quote")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={showMaterialQuoteDialog} onOpenChange={setShowMaterialQuoteDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingMaterialQuote ? "Edit Material Quote" : "Add Material Quote"}</DialogTitle>
            <DialogDescription>
              {editingMaterialQuote ? "Update the material quote details" : "Add a new material or supply quote"}
            </DialogDescription>
          </DialogHeader>
          <Form {...materialForm}>
            <form onSubmit={materialForm.handleSubmit(onSubmitMaterialQuote)} className="space-y-4">
              <div className="space-y-2">
                <Label>Select Supplier from CRM</Label>
                <CrmOrganizationSelector
                  value={materialForm.watch("supplierName") || ""}
                  filterTypes={["SUPPLIER"]}
                  placeholder="Select or search for a supplier..."
                  selectedContactId={supplierContactId}
                  onSelect={(org) => {
                    if (org) {
                      materialForm.setValue("supplierName", org.name);
                    } else {
                      materialForm.setValue("supplierName", "");
                      materialForm.setValue("supplierContact", "");
                      setSupplierContactId(undefined);
                    }
                  }}
                  onContactSelect={(contact) => {
                    if (contact) {
                      setSupplierContactId(String(contact.id));
                      materialForm.setValue("supplierContact", `${contact.firstName} ${contact.lastName}`);
                    } else {
                      setSupplierContactId(undefined);
                      materialForm.setValue("supplierContact", "");
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={materialForm.control}
                  name="materialName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Material Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Concrete, Rebar, etc." data-testid="input-material-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={materialForm.control}
                  name="cost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost ($)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-material-cost" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={materialForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Material description..." rows={2} data-testid="input-material-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={materialForm.control}
                  name="specs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Specifications</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Size, grade, etc." data-testid="input-material-specs" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={materialForm.control}
                  name="leadTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead Time</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="e.g., 2 weeks" data-testid="input-material-lead-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={materialForm.control}
                  name="supplierName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier Name</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Supplier company" data-testid="input-supplier-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={materialForm.control}
                  name="supplierContact"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier Contact</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Contact person" data-testid="input-supplier-contact" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Quote Document</Label>
                {uploadedMaterialFileData ? (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                    <FileText className="w-4 h-4" />
                    <span className="text-sm flex-1 truncate">{uploadedMaterialFileData.fileName}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setUploadedMaterialFileData(null)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <ObjectUploader
                    onGetUploadParameters={onGetUploadParametersMaterial}
                    onComplete={(result) => {
                      setIsUploadingMaterialFile(true);
                      handleMaterialFileUploadComplete(result);
                    }}
                    allowedFileTypes={[".pdf", ".xlsx", ".docx", ".png", ".jpg"]}
                    maxFileSize={10 * 1024 * 1024}
                  >
                    Upload Quote Document
                  </ObjectUploader>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowMaterialQuoteDialog(false); setUploadedMaterialFileData(null); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMaterialQuote.isPending || updateMaterialQuote.isPending || isUploadingMaterialFile}>
                  {editingMaterialQuote ? (updateMaterialQuote.isPending ? "Saving..." : "Save Changes") : (createMaterialQuote.isPending ? "Adding..." : "Add Quote")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEquipmentDialog} onOpenChange={setShowEquipmentDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEquipmentSelection ? "Edit Equipment" : "Add Equipment"}</DialogTitle>
            <DialogDescription>
              {editingEquipmentSelection ? "Update the equipment selection" : "Add equipment needed for this bid"}
            </DialogDescription>
          </DialogHeader>
          <Form {...equipmentForm}>
            <form onSubmit={equipmentForm.handleSubmit(onSubmitEquipment)} className="space-y-4">
              <FormField
                control={equipmentForm.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipment Source</FormLabel>
                    <Select 
                      value={field.value} 
                      onValueChange={(value: "OWNED" | "RENTAL") => {
                        field.onChange(value);
                        setSelectedEquipmentSource(value);
                        equipmentForm.setValue("equipmentId", undefined);
                        equipmentForm.setValue("rentalCatalogId", undefined);
                        equipmentForm.setValue("rentalVendorId", undefined);
                        equipmentForm.setValue("equipmentName", "");
                        equipmentForm.setValue("equipmentType", "");
                        equipmentForm.setValue("hourlyRate", "");
                        equipmentForm.setValue("dailyRate", "");
                        equipmentForm.setValue("weeklyRate", "");
                        equipmentForm.setValue("deliveryFee", "");
                      }}
                    >
                      <SelectTrigger data-testid="select-equipment-source">
                        <SelectValue placeholder="Select source..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OWNED">Owned Equipment</SelectItem>
                        <SelectItem value="RENTAL">Rental Equipment</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedEquipmentSource === "OWNED" && (
                <div className="space-y-2">
                  <Label>Select from Fleet</Label>
                  <Select onValueChange={handleSelectOwnedEquipment}>
                    <SelectTrigger data-testid="select-owned-equipment">
                      <SelectValue placeholder="Select equipment from fleet..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEquipment?.owned?.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          No owned equipment available
                        </div>
                      ) : (
                        availableEquipment?.owned?.map((eq) => (
                          <SelectItem key={eq.id} value={eq.id}>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">{eq.equipmentCode}</span>
                              <span>{eq.name}</span>
                              <span className="text-xs text-muted-foreground">({eq.type})</span>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedEquipmentSource === "RENTAL" && (
                <div className="space-y-2">
                  <Label>Select from Rental Catalog</Label>
                  <Select onValueChange={handleSelectRentalEquipment}>
                    <SelectTrigger data-testid="select-rental-equipment">
                      <SelectValue placeholder="Select rental equipment..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEquipment?.rental?.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          No rental equipment available. Add rental vendors and equipment first.
                        </div>
                      ) : (
                        availableEquipment?.rental?.map((eq) => (
                          <SelectItem key={eq.id} value={eq.id}>
                            <div className="flex items-center gap-2">
                              <span>{eq.name}</span>
                              <span className="text-xs text-muted-foreground">({eq.equipmentType})</span>
                              <span className="text-xs text-muted-foreground">- {eq.vendorName}</span>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={equipmentForm.control}
                  name="equipmentName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Equipment Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Equipment name" data-testid="input-equipment-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={equipmentForm.control}
                  name="equipmentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Excavator" data-testid="input-equipment-type" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={equipmentForm.control}
                  name="plannedDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Planned Days</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" placeholder="0" onBlur={calculateEstimatedCost} data-testid="input-planned-days" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={equipmentForm.control}
                  name="plannedHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Planned Hours</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.5" placeholder="0" onBlur={calculateEstimatedCost} data-testid="input-planned-hours" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={equipmentForm.control}
                  name="dailyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Daily Rate ($)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="0.00" onBlur={calculateEstimatedCost} data-testid="input-daily-rate" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {selectedEquipmentSource === "RENTAL" && (
                <FormField
                  control={equipmentForm.control}
                  name="deliveryFee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Fee ($)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="0.00" onBlur={calculateEstimatedCost} data-testid="input-delivery-fee" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={equipmentForm.control}
                name="estimatedCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated Total Cost ($)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-estimated-cost" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={equipmentForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." rows={2} data-testid="input-equipment-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEquipmentDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createEquipmentSelection.isPending || updateEquipmentSelection.isPending}>
                  {editingEquipmentSelection 
                    ? (updateEquipmentSelection.isPending ? "Saving..." : "Save Changes") 
                    : (createEquipmentSelection.isPending ? "Adding..." : "Add Equipment")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={showAwardDialog} onOpenChange={setShowAwardDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Award Bid & Assign Team
            </DialogTitle>
            <DialogDescription>
              Convert this bid to an active project and assign the team members who will be responsible for it.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">Project: {bid?.name}</p>
              <p className="text-xs text-muted-foreground">Code: {bid?.code}</p>
              <p className="text-xs text-muted-foreground mt-1">Final Bid: ${finalBidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="superintendent">Superintendent</Label>
              <Select 
                value={selectedSuperintendentId} 
                onValueChange={(val) => setSelectedSuperintendentId(val === "none" ? "" : val)}
              >
                <SelectTrigger id="superintendent" data-testid="select-superintendent">
                  <SelectValue placeholder="Select superintendent (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {superintendents.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName} ({user.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectManager">Project Manager</Label>
              <Select 
                value={selectedProjectManagerId} 
                onValueChange={(val) => setSelectedProjectManagerId(val === "none" ? "" : val)}
              >
                <SelectTrigger id="projectManager" data-testid="select-project-manager">
                  <SelectValue placeholder="Select project manager (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {managers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName} ({user.role})
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
              data-testid="button-cancel-award"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmAward}
              disabled={convertBid.isPending}
              data-testid="button-confirm-award"
            >
              {convertBid.isPending ? "Converting..." : "Award & Convert to Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

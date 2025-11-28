import { useState, useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import CrmOrganizationSelector from "@/components/CrmOrganizationSelector";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Building2, MapPin, Mail, Phone, Calendar, DollarSign, Plus, Edit, Trash2, Users, FileText, Download, Calculator, TrendingUp, Package, CheckCircle2, UserCog, Truck, Clock, Wrench } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import JobInformationForm from "@/components/JobInformationForm";
import { SubcontractorScopeReportDialog } from "@/components/SubcontractorScopeReport";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useBid, useConvertBidToProject } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertBidSubcontractorQuoteSchema, insertBidMaterialQuoteSchema, insertBidSchema, insertBidEquipmentSelectionSchema } from "@shared/schema";
import type { BidSubcontractorQuote, BidMaterialQuote, InsertBidSubcontractorQuote, InsertBidMaterialQuote, Estimate, EstimateLineItem, CrmOrganisation, CrmContact, BidEquipmentSelection } from "@shared/schema";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { format } from "date-fns";
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
  const { user, logout } = useAuth();
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
  const { data: usersData } = useQuery<{ users: UserOption[] }>({
    queryKey: ["/api/users"],
  });
  
  // Filter active superintendents and managers for assignment dropdowns
  const superintendents = usersData?.users?.filter(u => 
    u.isActive && (u.role === "SUPERINTENDENT" || u.role === "MANAGER" || u.role === "ADMIN")
  ) || [];
  const managers = usersData?.users?.filter(u => 
    u.isActive && (u.role === "MANAGER" || u.role === "ADMIN")
  ) || [];

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
      const response = await fetch(`/api/bids/${bidCode}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Failed to create quote");
      return response.json();
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
      const response = await fetch(`/api/bids/${bidCode}/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update quote");
      return response.json();
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
      const response = await fetch(`/api/bids/${bidCode}/quotes/${quoteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete quote");
      return response.json();
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
      const response = await fetch(`/api/bids/${bidCode}/material-quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Failed to create material quote");
      return response.json();
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
      const response = await fetch(`/api/bids/${bidCode}/material-quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update material quote");
      return response.json();
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
      const response = await fetch(`/api/bids/${bidCode}/material-quotes/${quoteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete material quote");
      return response.json();
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
      const response = await fetch(`/api/bids/${bidCode}/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isSelected }),
      });
      if (!response.ok) throw new Error("Failed to update quote selection");
      return response.json();
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
      const response = await fetch(`/api/bids/${bidCode}/material-quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isSelected }),
      });
      if (!response.ok) throw new Error("Failed to update material quote selection");
      return response.json();
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

  const getUploadParameters = async () => {
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

  const getUploadParametersMaterial = async () => {
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
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading bid details...</p>
        </div>
      </div>
    );
  }

  if (!bid) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Bid not found</p>
        </div>
      </div>
    );
  }

  const locationString = [bid.locationAddress, bid.city, bid.state]
    .filter(Boolean)
    .join(', ') || 'No location specified';

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
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
          </div>
          <Button onClick={handleMarkAsAwarded} data-testid="button-mark-awarded">
            Mark as Awarded
          </Button>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle>Bid Information</CardTitle>
                {(user?.role === "ADMIN" || user?.role === "MANAGER") && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleEditBid}
                    data-testid="button-edit-bid"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Bid Amount</p>
                    <p className="text-lg font-bold font-mono">
                      {bid.bidAmount ? `$${Number(bid.bidAmount).toLocaleString()}` : 'TBD'}
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
                {bid.clientContactEmail && (
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact Email</p>
                      <p className="text-sm text-muted-foreground">{bid.clientContactEmail}</p>
                    </div>
                  </div>
                )}
                {bid.clientContactPhone && (
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact Phone</p>
                      <p className="text-sm text-muted-foreground">{bid.clientContactPhone}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Project Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Location</p>
                    <p className="text-sm text-muted-foreground">{locationString}</p>
                  </div>
                </div>
                {bid.estimatorId && (
                  <div>
                    <p className="text-sm font-medium mb-1">Estimator</p>
                    <p className="text-sm text-muted-foreground">Estimator ID: {bid.estimatorId}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {bid.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{bid.description}</p>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-bid-estimate">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="w-5 h-5" />
                  Bid Estimate
                </CardTitle>
                <CardDescription>Cost breakdown and profit analysis for this bid</CardDescription>
              </div>
              {!estimate && (user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
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
                  View Details
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {estimateLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading estimate...</div>
              ) : !estimate ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calculator className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No estimate created yet</p>
                  <p className="text-sm mt-2">Create an estimate to track costs and profit margins</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-muted rounded-md">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Total Estimate</p>
                      </div>
                      <p className="text-xl font-bold font-mono" data-testid="text-estimate-total">
                        ${estimate.totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {estimate.lineItems.length} line items
                      </p>
                    </div>
                    <div className="p-4 bg-muted rounded-md">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Labor Cost</p>
                      </div>
                      <p className="text-lg font-bold font-mono">
                        ${estimate.totals.laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {estimate.totals.laborHours.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hours
                      </p>
                    </div>
                    <div className="p-4 bg-muted rounded-md">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Material Cost</p>
                      </div>
                      <p className="text-lg font-bold font-mono">
                        ${estimate.totals.materialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {estimate.totals.totalCost > 0 
                          ? `${((estimate.totals.materialCost / estimate.totals.totalCost) * 100).toFixed(1)}% of total`
                          : "0% of total"}
                      </p>
                    </div>
                    <div className="p-4 bg-muted rounded-md">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={estimate.status === "APPROVED" ? "default" : "secondary"}>
                          {estimate.status}
                        </Badge>
                      </div>
                      {(() => {
                        // Calculate profit based on formula: directCost -> overhead -> profit
                        const directCost = estimate.totals.materialCost + 
                                          estimate.totals.laborCost + 
                                          estimate.totals.equipmentCost + 
                                          estimate.totals.consumablesCost + 
                                          estimate.totals.subcontractCost;
                        const overheadPercent = 10; // Default overhead percentage
                        const profitMarginPercent = 15; // Default profit margin percentage
                        const totalOverhead = directCost * (overheadPercent / 100);
                        const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
                        return (
                          <>
                            <p className="text-lg font-bold font-mono text-green-600 dark:text-green-400" data-testid="text-profit-margin">
                              ${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Profit margin ({profitMarginPercent}%)
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-primary/10 rounded-md border border-primary/20">
                    <span className="text-sm font-medium">Base Bid Amount:</span>
                    <span className="text-lg font-bold font-mono">
                      ${(estimate.baseBidAmount || estimate.totals.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-subcontractor-quotes">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Subcontractor Quotes
                </CardTitle>
                <CardDescription>Track quotes from subcontractors for cost estimation</CardDescription>
              </div>
              {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
                <Button onClick={handleAddQuote} size="sm" data-testid="button-add-quote">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Quote
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {quotesLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading quotes...</div>
              ) : quotes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No subcontractor quotes added yet
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-md">
                    <span className="text-sm font-medium">Total from Quotes:</span>
                    <span className="text-lg font-bold font-mono">${totalQuotes.toLocaleString()}</span>
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
                            <div className="flex items-center gap-3 mb-2">
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
                              {quote.fileUrl && (
                                <Badge variant="secondary" className="gap-1">
                                  <FileText className="w-3 h-3" />
                                  Document
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{quote.scopeOfWork}</p>
                            {(quote.leadTime || quote.estimatedCompletionTime) && (
                              <div className="flex gap-4 mb-2">
                                {quote.leadTime && (
                                  <div className="text-xs">
                                    <span className="font-medium">Lead Time:</span>{' '}
                                    <span className="text-muted-foreground">{quote.leadTime}</span>
                                  </div>
                                )}
                                {quote.estimatedCompletionTime && (
                                  <div className="text-xs">
                                    <span className="font-medium">Est. Completion:</span>{' '}
                                    <span className="text-muted-foreground">{quote.estimatedCompletionTime}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            {(quote.contactName || quote.contactEmail || quote.contactPhone) && (
                              <div className="text-xs text-muted-foreground space-y-1">
                                {quote.contactName && <p>Contact: {quote.contactName}</p>}
                                {quote.contactEmail && <p>Email: {quote.contactEmail}</p>}
                                {quote.contactPhone && <p>Phone: {quote.contactPhone}</p>}
                              </div>
                            )}
                            {quote.notes && (
                              <p className="text-xs text-muted-foreground mt-2 italic">{quote.notes}</p>
                            )}
                            {quote.fileUrl && (
                              <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground flex-1 truncate">
                                  {quote.fileName || "Quote document"}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    try {
                                      const response = await apiRequest("POST", "/api/objects/download", {
                                        fileUrl: quote.fileUrl,
                                      });
                                      const data = await response.json();
                                      window.open(data.downloadURL, '_blank');
                                    } catch (error) {
                                      toast({ 
                                        title: "Error", 
                                        description: "Failed to download document", 
                                        variant: "destructive" 
                                      });
                                    }
                                  }}
                                  data-testid={`button-download-quote-${quote.id}`}
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  Download
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          {estimateData?.estimate && (
                            <SubcontractorScopeReportDialog
                              quote={quote}
                              estimate={estimateData.estimate}
                              lineItems={estimateData.estimate.lineItems || []}
                              bidName={bid?.name || ""}
                              bidCode={String(bid?.code || "")}
                            />
                          )}
                          {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleEditQuote(quote)}
                                data-testid={`button-edit-quote-${quote.id}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDeleteQuote(quote.id)}
                                data-testid={`button-delete-quote-${quote.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-material-quotes">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Material Quotes
                </CardTitle>
                <CardDescription>Track material quotes and supplier information</CardDescription>
              </div>
              {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
                <Button onClick={handleAddMaterialQuote} size="sm" data-testid="button-add-material-quote">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Quote
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {materialQuotesLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading material quotes...</div>
              ) : materialQuotes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No material quotes added yet
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-md">
                    <span className="text-sm font-medium">Total from Material Quotes:</span>
                    <span className="text-lg font-bold font-mono">${totalMaterialQuotes.toLocaleString()}</span>
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
                            <div className="flex items-center gap-3 mb-2">
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
                              {quote.fileUrl && (
                                <Badge variant="secondary" className="gap-1">
                                  <FileText className="w-3 h-3" />
                                  Document
                                </Badge>
                              )}
                            </div>
                            {quote.description && (
                              <p className="text-sm text-muted-foreground mb-2">{quote.description}</p>
                            )}
                            {(quote.specs || quote.leadTime) && (
                              <div className="flex gap-4 mb-2">
                                {quote.specs && (
                                  <div className="text-xs">
                                    <span className="font-medium">Specs:</span>{' '}
                                    <span className="text-muted-foreground">{quote.specs}</span>
                                  </div>
                                )}
                                {quote.leadTime && (
                                  <div className="text-xs">
                                    <span className="font-medium">Lead Time:</span>{' '}
                                    <span className="text-muted-foreground">{quote.leadTime}</span>
                                  </div>
                                )}
                              </div>
                            )}
                            {(quote.supplierName || quote.supplierContact) && (
                              <div className="text-xs text-muted-foreground space-y-1">
                                {quote.supplierName && <p>Supplier: {quote.supplierName}</p>}
                                {quote.supplierContact && <p>Contact: {quote.supplierContact}</p>}
                              </div>
                            )}
                            {quote.fileUrl && (
                              <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                                <FileText className="w-4 h-4 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground flex-1 truncate">
                                  {quote.fileName || "Material quote document"}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    try {
                                      const response = await apiRequest("POST", "/api/objects/download", {
                                        fileUrl: quote.fileUrl,
                                      });
                                      const data = await response.json();
                                      window.open(data.downloadURL, '_blank');
                                    } catch (error) {
                                      toast({ 
                                        title: "Error", 
                                        description: "Failed to download document", 
                                        variant: "destructive" 
                                      });
                                    }
                                  }}
                                  data-testid={`button-download-material-quote-${quote.id}`}
                                >
                                  <Download className="w-3 h-3 mr-1" />
                                  Download
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                        {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
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
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-equipment-selections">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="w-5 h-5" />
                  Equipment Plan
                </CardTitle>
                <CardDescription>Select equipment needed for this project (owned or rental)</CardDescription>
              </div>
              {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
                <Button onClick={handleAddEquipment} size="sm" data-testid="button-add-equipment">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Equipment
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {equipmentLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading equipment...</div>
              ) : equipmentSelections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No equipment selected for this bid yet
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-md">
                    <span className="text-sm font-medium">Total Equipment Cost:</span>
                    <span className="text-lg font-bold font-mono">${totalEquipmentCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                              <div>
                                <span className="font-medium">Days:</span> {selection.plannedDays}
                              </div>
                            )}
                            {selection.plannedHours && (
                              <div>
                                <span className="font-medium">Hours:</span> {selection.plannedHours}
                              </div>
                            )}
                            {selection.dailyRate && (
                              <div>
                                <span className="font-medium">Daily Rate:</span> ${parseFloat(selection.dailyRate).toLocaleString()}
                              </div>
                            )}
                            {selection.hourlyRate && (
                              <div>
                                <span className="font-medium">Hourly Rate:</span> ${parseFloat(selection.hourlyRate).toLocaleString()}
                              </div>
                            )}
                            {selection.deliveryFee && parseFloat(selection.deliveryFee) > 0 && (
                              <div>
                                <span className="font-medium">Delivery:</span> ${parseFloat(selection.deliveryFee).toLocaleString()}
                              </div>
                            )}
                          </div>
                          {selection.notes && (
                            <p className="text-xs text-muted-foreground mt-2 italic">{selection.notes}</p>
                          )}
                        </div>
                        {(user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR") && (
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleEditEquipmentSelection(selection)}
                              data-testid={`button-edit-equipment-${selection.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteEquipmentSelection(selection.id)}
                              data-testid={`button-delete-equipment-${selection.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <JobInformationForm bidCode={bidCode} />

          <Card>
            <CardHeader>
              <CardTitle>Bid Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <FileUploadZone
                onFileSelect={(files) => console.log('Bid documents uploaded:', files)}
                accept=".pdf,.xlsx,.docx"
              />
            </CardContent>
          </Card>
        </div>
      </main>

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
                <p className="text-xs text-muted-foreground">
                  Select from CRM or type manually below
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="subcontractorName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subcontractor Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="ABC Construction" data-testid="input-subcontractor-name" />
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
                      <FormLabel>Quote Amount</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="25000.00" data-testid="input-quote-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="leadTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead Time (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="e.g., 2 weeks, 30 days" data-testid="input-lead-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimatedCompletionTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Completion Time (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="e.g., 3 months, 45 days" data-testid="input-estimated-completion" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Scope of Work</Label>
                {/* Quick selection from estimate line items if estimate exists */}
                {estimateData?.estimate?.lineItems && estimateData.estimate.lineItems.length > 0 && (
                  <div className="space-y-2 p-3 bg-muted/50 rounded-md border">
                    <Label className="text-xs text-muted-foreground">Select from Estimate Scope Items</Label>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                      {estimateData.estimate.lineItems.map((item) => (
                        <Button
                          key={item.id}
                          type="button"
                          variant={form.watch("scopeOfWork") === item.description ? "default" : "outline"}
                          size="sm"
                          className="text-xs h-auto py-1 px-2"
                          onClick={() => {
                            const scopeData: ScopeSelectionData = {
                              workTypeId: "",
                              workTypeName: item.description,
                              workTypeCode: item.workTypeCode || "",
                              categoryName: "",
                              unit: item.unit,
                              modifierIds: [],
                              modifierNames: [],
                              canonicalName: item.description,
                            };
                            setScopeSelectionData(scopeData);
                            form.setValue("scopeOfWork", item.description);
                          }}
                          data-testid={`button-estimate-scope-${item.id}`}
                        >
                          {item.description} ({item.quantity} {item.unit})
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Or use the standardized scope selector below for custom scope
                    </p>
                  </div>
                )}
                <StandardizedScopeSelector
                  value={scopeSelectionData}
                  onChange={(data) => {
                    setScopeSelectionData(data);
                    form.setValue("scopeOfWork", data.canonicalName);
                  }}
                />
                {form.formState.errors.scopeOfWork && (
                  <p className="text-sm text-destructive">{form.formState.errors.scopeOfWork.message}</p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="input-contact-name" />
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
                        <Input {...field} value={field.value || ""} type="email" placeholder="john@abc.com" data-testid="input-contact-email" />
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
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Additional notes..." data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="space-y-2">
                <FormLabel>Quote Document (Optional)</FormLabel>
                <div className="flex items-center gap-3">
                  {uploadedFileData ? (
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-md flex-1">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium flex-1 truncate">{uploadedFileData.fileName}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setUploadedFileData(null)}
                        data-testid="button-remove-file"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={104857600}
                      allowedFileTypes={["application/pdf", "image/*", ".doc", ".docx", ".xls", ".xlsx"]}
                      onGetUploadParameters={getUploadParameters}
                      onComplete={(result) => {
                        setIsUploadingFile(true);
                        handleFileUploadComplete(result);
                      }}
                      buttonVariant="outline"
                      testId="button-upload-quote-document"
                    >
                      {isUploadingFile ? "Uploading..." : "Upload Document"}
                    </ObjectUploader>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PDF, images, or Office documents (max 100MB)
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowQuoteDialog(false); setSubcontractorContactId(undefined); }} data-testid="button-cancel">
                  Cancel
                </Button>
                <Button type="submit" disabled={createQuote.isPending || updateQuote.isPending} data-testid="button-submit-quote">
                  {createQuote.isPending || updateQuote.isPending ? "Saving..." : editingQuote ? "Update Quote" : "Add Quote"}
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
              {editingMaterialQuote ? "Update the material quote details" : "Add a new quote for materials and supplies"}
            </DialogDescription>
          </DialogHeader>
          <Form {...materialForm}>
            <form onSubmit={materialForm.handleSubmit(onSubmitMaterialQuote)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={materialForm.control}
                  name="materialName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Material Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Concrete, Rebar, etc." data-testid="input-material-name" />
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
                      <FormLabel>Cost</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="5000.00" data-testid="input-material-cost" />
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
                      <Textarea {...field} value={field.value || ""} placeholder="Describe the material specifications and usage..." data-testid="input-material-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={materialForm.control}
                name="specs"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Specs (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Technical specifications, grade, dimensions, etc." data-testid="input-material-specs" />
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
                    <FormLabel>Lead Time (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ""} placeholder="e.g., 2 weeks, 30 days" data-testid="input-material-lead-time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <Label>Select Supplier from CRM (Optional)</Label>
                <CrmOrganizationSelector
                  value={materialForm.watch("supplierName") || ""}
                  filterTypes={["SUPPLIER", "VENDOR"]}
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
                      setSupplierContactId(contact.id);
                      const contactInfo = [
                        `${contact.firstName} ${contact.lastName}`,
                        contact.email,
                        contact.phone || contact.mobile,
                      ].filter(Boolean).join(" | ");
                      materialForm.setValue("supplierContact", contactInfo);
                    } else {
                      setSupplierContactId(undefined);
                      materialForm.setValue("supplierContact", "");
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Select from CRM or type manually below
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={materialForm.control}
                  name="supplierName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supplier Name (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="ABC Suppliers" data-testid="input-supplier-name" />
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
                      <FormLabel>Supplier Contact (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Phone or Email" data-testid="input-supplier-contact" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="space-y-2">
                <FormLabel>Material Quote Document (Optional)</FormLabel>
                <div className="flex items-center gap-3">
                  {uploadedMaterialFileData ? (
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-md flex-1">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium flex-1 truncate">{uploadedMaterialFileData.fileName}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setUploadedMaterialFileData(null)}
                        data-testid="button-remove-material-file"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <ObjectUploader
                      maxNumberOfFiles={1}
                      maxFileSize={104857600}
                      allowedFileTypes={["application/pdf", "image/*", ".doc", ".docx", ".xls", ".xlsx"]}
                      onGetUploadParameters={getUploadParametersMaterial}
                      onComplete={(result) => {
                        setIsUploadingMaterialFile(true);
                        handleMaterialFileUploadComplete(result);
                      }}
                      buttonVariant="outline"
                      testId="button-upload-material-document"
                    >
                      {isUploadingMaterialFile ? "Uploading..." : "Upload Document"}
                    </ObjectUploader>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PDF, images, or Office documents (max 100MB)
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowMaterialQuoteDialog(false); setSupplierContactId(undefined); }} data-testid="button-cancel">
                  Cancel
                </Button>
                <Button type="submit" disabled={createMaterialQuote.isPending || updateMaterialQuote.isPending} data-testid="button-submit-material-quote">
                  {createMaterialQuote.isPending || updateMaterialQuote.isPending ? "Saving..." : editingMaterialQuote ? "Update Quote" : "Add Quote"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Equipment Selection Dialog */}
      <Dialog open={showEquipmentDialog} onOpenChange={setShowEquipmentDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEquipmentSelection ? "Edit Equipment" : "Add Equipment to Bid"}</DialogTitle>
            <DialogDescription>
              {editingEquipmentSelection 
                ? "Update the equipment details for this bid" 
                : "Select owned equipment or rental equipment for this project"}
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
                      onValueChange={(value) => {
                        field.onChange(value);
                        setSelectedEquipmentSource(value as "OWNED" | "RENTAL");
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
                      <FormControl>
                        <SelectTrigger data-testid="select-equipment-source">
                          <SelectValue placeholder="Select source" />
                        </SelectTrigger>
                      </FormControl>
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
                  <Select
                    value={equipmentForm.watch("equipmentId") || ""}
                    onValueChange={handleSelectOwnedEquipment}
                  >
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
                              {eq.dailyRate && (
                                <span className="text-xs text-muted-foreground">${eq.dailyRate}/day</span>
                              )}
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
                  <Select
                    value={equipmentForm.watch("rentalCatalogId") || ""}
                    onValueChange={handleSelectRentalEquipment}
                  >
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
                              {eq.dailyRate && (
                                <span className="text-xs text-muted-foreground">${eq.dailyRate}/day</span>
                              )}
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
                        <Input {...field} placeholder="e.g., CAT 320 Excavator" data-testid="input-equipment-name" />
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
                      <FormLabel>Equipment Type</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Excavator" data-testid="input-equipment-type" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={equipmentForm.control}
                  name="plannedDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Planned Days</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          placeholder="0" 
                          onChange={(e) => {
                            field.onChange(e);
                            setTimeout(calculateEstimatedCost, 100);
                          }}
                          data-testid="input-planned-days" 
                        />
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
                      <FormLabel>Planned Hours (Alternative)</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.5" 
                          placeholder="0"
                          onChange={(e) => {
                            field.onChange(e);
                            setTimeout(calculateEstimatedCost, 100);
                          }}
                          data-testid="input-planned-hours" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={equipmentForm.control}
                  name="hourlyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hourly Rate ($)</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00"
                          onChange={(e) => {
                            field.onChange(e);
                            setTimeout(calculateEstimatedCost, 100);
                          }}
                          data-testid="input-hourly-rate" 
                        />
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
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00"
                          onChange={(e) => {
                            field.onChange(e);
                            setTimeout(calculateEstimatedCost, 100);
                          }}
                          data-testid="input-daily-rate" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={equipmentForm.control}
                  name="weeklyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weekly Rate ($)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-weekly-rate" />
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
                        <Input 
                          {...field} 
                          type="number" 
                          step="0.01" 
                          placeholder="0.00"
                          onChange={(e) => {
                            field.onChange(e);
                            setTimeout(calculateEstimatedCost, 100);
                          }}
                          data-testid="input-delivery-fee" 
                        />
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
                      <Input 
                        {...field} 
                        type="number" 
                        step="0.01" 
                        placeholder="0.00"
                        className="font-mono font-bold"
                        data-testid="input-estimated-cost" 
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Auto-calculated from days/hours × rate + delivery</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={equipmentForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value || ""} placeholder="Additional notes about equipment usage..." data-testid="input-equipment-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => { 
                    setShowEquipmentDialog(false);
                    setEditingEquipmentSelection(null);
                    equipmentForm.reset();
                  }} 
                  data-testid="button-cancel-equipment"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createEquipmentSelection.isPending || updateEquipmentSelection.isPending}
                  data-testid="button-submit-equipment"
                >
                  {createEquipmentSelection.isPending || updateEquipmentSelection.isPending 
                    ? "Saving..." 
                    : editingEquipmentSelection 
                      ? "Update Equipment" 
                      : "Add Equipment"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Bid Dialog */}
      <Dialog open={showEditBidDialog} onOpenChange={setShowEditBidDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Bid Information</DialogTitle>
            <DialogDescription>Update the bid details and project information</DialogDescription>
          </DialogHeader>
          <Form {...bidEditForm}>
            <form onSubmit={bidEditForm.handleSubmit((data) => updateBidMutation.mutate(data))} className="space-y-4">
              <FormField
                control={bidEditForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bid Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Project name or description" data-testid="input-bid-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-2 gap-4">
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
                <FormField
                  control={bidEditForm.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due Date</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} type="date" data-testid="input-due-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Client/Owner Section */}
              <div className="space-y-3 p-3 border rounded-md">
                <h4 className="font-medium text-sm">Client / Owner</h4>
                <div className="space-y-2">
                  <Label>Select from CRM</Label>
                  <CrmOrganizationSelector
                    value={bidEditForm.watch("clientName") || ""}
                    filterTypes={["CONTRACTOR"]}
                    placeholder="Select or search for a client..."
                    selectedContactId={editBidClientContactId}
                    onSelect={(org) => {
                      if (org) {
                        bidEditForm.setValue("clientName", org.name);
                      } else {
                        bidEditForm.setValue("clientName", "");
                        bidEditForm.setValue("clientContactName", "");
                        bidEditForm.setValue("clientContactEmail", "");
                        bidEditForm.setValue("clientContactPhone", "");
                        setEditBidClientContactId(undefined);
                      }
                    }}
                    onContactSelect={(contact) => {
                      if (contact) {
                        setEditBidClientContactId(String(contact.id));
                        bidEditForm.setValue("clientContactName", `${contact.firstName} ${contact.lastName}`);
                        bidEditForm.setValue("clientContactEmail", contact.email || "");
                        bidEditForm.setValue("clientContactPhone", contact.phone || contact.mobile || "");
                      } else {
                        setEditBidClientContactId(undefined);
                        bidEditForm.setValue("clientContactName", "");
                        bidEditForm.setValue("clientContactEmail", "");
                        bidEditForm.setValue("clientContactPhone", "");
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Select from CRM or type manually below
                  </p>
                </div>
                <FormField
                  control={bidEditForm.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Client company or individual" data-testid="input-client-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={bidEditForm.control}
                    name="clientContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="input-client-contact-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={bidEditForm.control}
                    name="clientContactEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Email</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} type="email" placeholder="john@example.com" data-testid="input-client-contact-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={bidEditForm.control}
                    name="clientContactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Phone</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="(555) 123-4567" data-testid="input-client-contact-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* General Contractor Section */}
              <div className="space-y-3 p-3 border rounded-md">
                <h4 className="font-medium text-sm">General Contractor (if applicable)</h4>
                <div className="space-y-2">
                  <Label>Select from CRM</Label>
                  <CrmOrganizationSelector
                    value={bidEditForm.watch("gcName") || ""}
                    filterTypes={["CONTRACTOR"]}
                    placeholder="Select or search for a GC..."
                    selectedContactId={editBidGcContactId}
                    onSelect={(org) => {
                      if (org) {
                        bidEditForm.setValue("gcName", org.name);
                      } else {
                        bidEditForm.setValue("gcName", "");
                        bidEditForm.setValue("gcContactName", "");
                        bidEditForm.setValue("gcContactEmail", "");
                        bidEditForm.setValue("gcContactPhone", "");
                        setEditBidGcContactId(undefined);
                      }
                    }}
                    onContactSelect={(contact) => {
                      if (contact) {
                        setEditBidGcContactId(String(contact.id));
                        bidEditForm.setValue("gcContactName", `${contact.firstName} ${contact.lastName}`);
                        bidEditForm.setValue("gcContactEmail", contact.email || "");
                        bidEditForm.setValue("gcContactPhone", contact.phone || contact.mobile || "");
                      } else {
                        setEditBidGcContactId(undefined);
                        bidEditForm.setValue("gcContactName", "");
                        bidEditForm.setValue("gcContactEmail", "");
                        bidEditForm.setValue("gcContactPhone", "");
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Select from CRM or type manually below
                  </p>
                </div>
                <FormField
                  control={bidEditForm.control}
                  name="gcName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GC Name</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="General Contractor company" data-testid="input-gc-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={bidEditForm.control}
                    name="gcContactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Jane Doe" data-testid="input-gc-contact-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={bidEditForm.control}
                    name="gcContactEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Email</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} type="email" placeholder="jane@gc.com" data-testid="input-gc-contact-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={bidEditForm.control}
                    name="gcContactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Phone</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="(555) 987-6543" data-testid="input-gc-contact-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

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
                      <Textarea {...field} value={field.value || ""} placeholder="Project details and requirements..." rows={4} data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowEditBidDialog(false); setEditBidClientContactId(undefined); setEditBidGcContactId(undefined); }} data-testid="button-cancel-edit">
                  Cancel
                </Button>
                <Button type="submit" disabled={updateBidMutation.isPending} data-testid="button-save-bid">
                  {updateBidMutation.isPending ? "Saving..." : "Save Changes"}
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
              They will receive a notification on their dashboard.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">Project: {bid?.name}</p>
              <p className="text-xs text-muted-foreground">Code: {bid?.code}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="superintendent">Superintendent</Label>
              <Select 
                value={selectedSuperintendentId} 
                onValueChange={setSelectedSuperintendentId}
              >
                <SelectTrigger id="superintendent" data-testid="select-superintendent">
                  <SelectValue placeholder="Select superintendent (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {superintendents.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName} ({user.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The superintendent will oversee field operations.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectManager">Project Manager</Label>
              <Select 
                value={selectedProjectManagerId} 
                onValueChange={setSelectedProjectManagerId}
              >
                <SelectTrigger id="projectManager" data-testid="select-project-manager">
                  <SelectValue placeholder="Select project manager (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {managers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName} ({user.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The project manager will oversee scheduling and coordination.
              </p>
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

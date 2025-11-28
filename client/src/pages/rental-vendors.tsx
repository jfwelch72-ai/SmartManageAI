import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Building2, 
  Plus,
  Search,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  DollarSign,
  Truck,
  Package,
  ChevronRight,
  AlertCircle,
  X,
  FileText,
  Wrench
} from "lucide-react";
import type { RentalVendor, RentalEquipmentCatalog } from "@shared/schema";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const EQUIPMENT_TYPES = [
  { value: "HEAVY_EQUIPMENT", label: "Heavy Equipment" },
  { value: "VEHICLE", label: "Vehicle" },
  { value: "POWER_TOOL", label: "Power Tool" },
  { value: "HAND_TOOL", label: "Hand Tool" },
  { value: "TRAILER", label: "Trailer" },
  { value: "COMPRESSOR", label: "Compressor" },
  { value: "GENERATOR", label: "Generator" },
  { value: "LIFT", label: "Lift" },
  { value: "PUMP", label: "Pump" },
  { value: "CONCRETE", label: "Concrete Equipment" },
  { value: "GRADING", label: "Grading Equipment" },
  { value: "PAVING", label: "Paving Equipment" },
  { value: "OTHER", label: "Other" },
];

const vendorFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required").max(20, "Code max 20 characters"),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  accountNumber: z.string().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

type VendorFormValues = z.infer<typeof vendorFormSchema>;

const catalogFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  equipmentType: z.string().min(1, "Type is required"),
  make: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  hourlyRate: z.string().optional(),
  dailyRate: z.string().optional(),
  weeklyRate: z.string().optional(),
  monthlyRate: z.string().optional(),
  deliveryFee: z.string().optional(),
  pickupFee: z.string().optional(),
  minimumRentalDays: z.string().optional(),
  isActive: z.boolean().default(true),
});

type CatalogFormValues = z.infer<typeof catalogFormSchema>;

interface CatalogWithVendor extends RentalEquipmentCatalog {
  vendorName: string;
  vendorCode: string;
}

export default function RentalVendorsPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<RentalVendor | null>(null);
  const [showVendorDialog, setShowVendorDialog] = useState(false);
  const [editingVendor, setEditingVendor] = useState<RentalVendor | null>(null);
  const [showCatalogDialog, setShowCatalogDialog] = useState(false);
  const [editingCatalog, setEditingCatalog] = useState<RentalEquipmentCatalog | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "vendor" | "catalog"; id: string } | null>(null);

  const vendorForm = useForm<VendorFormValues>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: {
      name: "",
      code: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      address: "",
      city: "",
      state: "",
      accountNumber: "",
      paymentTerms: "",
      notes: "",
      isActive: true,
    },
  });

  const catalogForm = useForm<CatalogFormValues>({
    resolver: zodResolver(catalogFormSchema),
    defaultValues: {
      name: "",
      equipmentType: "",
      make: "",
      model: "",
      description: "",
      hourlyRate: "",
      dailyRate: "",
      weeklyRate: "",
      monthlyRate: "",
      deliveryFee: "",
      pickupFee: "",
      minimumRentalDays: "",
      isActive: true,
    },
  });

  const { data: vendors = [], isLoading: vendorsLoading } = useQuery<RentalVendor[]>({
    queryKey: ["/api/rental-vendors"],
  });

  const { data: allCatalog = [], isLoading: catalogLoading } = useQuery<CatalogWithVendor[]>({
    queryKey: ["/api/rental-vendors/catalog"],
  });

  const { data: vendorCatalog = [] } = useQuery<RentalEquipmentCatalog[]>({
    queryKey: ["/api/rental-vendors", selectedVendor?.id, "catalog"],
    enabled: !!selectedVendor?.id,
  });

  const createVendorMutation = useMutation({
    mutationFn: async (data: VendorFormValues) => {
      return apiRequest("POST", "/api/rental-vendors", data);
    },
    onSuccess: () => {
      toast({ title: "Vendor created successfully" });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors"] });
      setShowVendorDialog(false);
      vendorForm.reset();
    },
    onError: (error: any) => {
      toast({ title: "Failed to create vendor", description: error.message, variant: "destructive" });
    },
  });

  const updateVendorMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: VendorFormValues }) => {
      return apiRequest("PATCH", `/api/rental-vendors/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Vendor updated successfully" });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors"] });
      setShowVendorDialog(false);
      setEditingVendor(null);
      vendorForm.reset();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update vendor", description: error.message, variant: "destructive" });
    },
  });

  const deleteVendorMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/rental-vendors/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Vendor deleted successfully" });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors"] });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      if (selectedVendor?.id === deleteTarget?.id) {
        setSelectedVendor(null);
      }
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete vendor", description: error.message, variant: "destructive" });
    },
  });

  const createCatalogMutation = useMutation({
    mutationFn: async (data: CatalogFormValues) => {
      if (!selectedVendor) throw new Error("No vendor selected");
      const payload = {
        ...data,
        hourlyRate: data.hourlyRate || null,
        dailyRate: data.dailyRate || null,
        weeklyRate: data.weeklyRate || null,
        monthlyRate: data.monthlyRate || null,
        deliveryFee: data.deliveryFee || null,
        pickupFee: data.pickupFee || null,
        minimumRentalDays: data.minimumRentalDays ? parseInt(data.minimumRentalDays) : null,
      };
      return apiRequest("POST", `/api/rental-vendors/${selectedVendor.id}/catalog`, payload);
    },
    onSuccess: () => {
      toast({ title: "Equipment added to catalog" });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors", selectedVendor?.id, "catalog"] });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors/catalog"] });
      setShowCatalogDialog(false);
      catalogForm.reset();
    },
    onError: (error: any) => {
      toast({ title: "Failed to add equipment", description: error.message, variant: "destructive" });
    },
  });

  const updateCatalogMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CatalogFormValues }) => {
      const payload = {
        ...data,
        hourlyRate: data.hourlyRate || null,
        dailyRate: data.dailyRate || null,
        weeklyRate: data.weeklyRate || null,
        monthlyRate: data.monthlyRate || null,
        deliveryFee: data.deliveryFee || null,
        pickupFee: data.pickupFee || null,
        minimumRentalDays: data.minimumRentalDays ? parseInt(data.minimumRentalDays) : null,
      };
      return apiRequest("PATCH", `/api/rental-equipment/${id}`, payload);
    },
    onSuccess: () => {
      toast({ title: "Equipment updated" });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors", selectedVendor?.id, "catalog"] });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors/catalog"] });
      setShowCatalogDialog(false);
      setEditingCatalog(null);
      catalogForm.reset();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update equipment", description: error.message, variant: "destructive" });
    },
  });

  const deleteCatalogMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/rental-equipment/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Equipment removed from catalog" });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors", selectedVendor?.id, "catalog"] });
      qc.invalidateQueries({ queryKey: ["/api/rental-vendors/catalog"] });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete equipment", description: error.message, variant: "destructive" });
    },
  });

  const handleAddVendor = () => {
    setEditingVendor(null);
    vendorForm.reset({
      name: "",
      code: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      address: "",
      city: "",
      state: "",
      accountNumber: "",
      paymentTerms: "",
      notes: "",
      isActive: true,
    });
    setShowVendorDialog(true);
  };

  const handleEditVendor = (vendor: RentalVendor) => {
    setEditingVendor(vendor);
    vendorForm.reset({
      name: vendor.name,
      code: vendor.code,
      contactName: vendor.contactName || "",
      contactEmail: vendor.contactEmail || "",
      contactPhone: vendor.contactPhone || "",
      address: vendor.address || "",
      city: vendor.city || "",
      state: vendor.state || "",
      accountNumber: vendor.accountNumber || "",
      paymentTerms: vendor.paymentTerms || "",
      notes: vendor.notes || "",
      isActive: vendor.isActive,
    });
    setShowVendorDialog(true);
  };

  const handleSubmitVendor = (data: VendorFormValues) => {
    if (editingVendor) {
      updateVendorMutation.mutate({ id: editingVendor.id, data });
    } else {
      createVendorMutation.mutate(data);
    }
  };

  const handleAddCatalogItem = () => {
    setEditingCatalog(null);
    catalogForm.reset({
      name: "",
      equipmentType: "",
      make: "",
      model: "",
      description: "",
      hourlyRate: "",
      dailyRate: "",
      weeklyRate: "",
      monthlyRate: "",
      deliveryFee: "",
      pickupFee: "",
      minimumRentalDays: "",
      isActive: true,
    });
    setShowCatalogDialog(true);
  };

  const handleEditCatalogItem = (item: RentalEquipmentCatalog) => {
    setEditingCatalog(item);
    catalogForm.reset({
      name: item.name,
      equipmentType: item.equipmentType,
      make: item.make || "",
      model: item.model || "",
      description: item.description || "",
      hourlyRate: item.hourlyRate || "",
      dailyRate: item.dailyRate || "",
      weeklyRate: item.weeklyRate || "",
      monthlyRate: item.monthlyRate || "",
      deliveryFee: item.deliveryFee || "",
      pickupFee: item.pickupFee || "",
      minimumRentalDays: item.minimumRentalDays?.toString() || "",
      isActive: item.isActive,
    });
    setShowCatalogDialog(true);
  };

  const handleSubmitCatalog = (data: CatalogFormValues) => {
    if (editingCatalog) {
      updateCatalogMutation.mutate({ id: editingCatalog.id, data });
    } else {
      createCatalogMutation.mutate(data);
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "vendor") {
      deleteVendorMutation.mutate(deleteTarget.id);
    } else {
      deleteCatalogMutation.mutate(deleteTarget.id);
    }
  };

  const filteredVendors = vendors.filter(v => 
    v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatRate = (rate: string | null) => {
    if (!rate) return "-";
    const num = parseFloat(rate);
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader userName={`${user.firstName} ${user.lastName}`} userRole={user.role} onLogout={logout} />
      
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
              <Truck className="h-6 w-6 text-primary" />
              Rental Vendors
            </h1>
            <p className="text-muted-foreground">Manage equipment rental vendors and their catalogs</p>
          </div>
          <Button onClick={handleAddVendor} data-testid="button-add-vendor">
            <Plus className="h-4 w-4 mr-2" />
            Add Vendor
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Vendors</CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search vendors..." 
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search-vendors"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-320px)]">
                {vendorsLoading ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : filteredVendors.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <Building2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No vendors found</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredVendors.map(vendor => (
                      <div
                        key={vendor.id}
                        className={`p-4 cursor-pointer hover-elevate transition-colors ${
                          selectedVendor?.id === vendor.id ? "bg-primary/10" : ""
                        }`}
                        onClick={() => setSelectedVendor(vendor)}
                        data-testid={`vendor-row-${vendor.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{vendor.name}</span>
                              <Badge variant="outline" className="text-xs shrink-0">
                                {vendor.code}
                              </Badge>
                            </div>
                            {vendor.contactName && (
                              <p className="text-sm text-muted-foreground truncate mt-1">
                                {vendor.contactName}
                              </p>
                            )}
                          </div>
                          <Badge variant={vendor.isActive ? "default" : "secondary"} className="shrink-0">
                            {vendor.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            {selectedVendor ? (
              <>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {selectedVendor.name}
                        <Badge variant="outline">{selectedVendor.code}</Badge>
                      </CardTitle>
                      <CardDescription>
                        {selectedVendor.city && selectedVendor.state 
                          ? `${selectedVendor.city}, ${selectedVendor.state}`
                          : "No location set"
                        }
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="icon"
                        onClick={() => handleEditVendor(selectedVendor)}
                        data-testid="button-edit-vendor"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setDeleteTarget({ type: "vendor", id: selectedVendor.id });
                          setShowDeleteConfirm(true);
                        }}
                        data-testid="button-delete-vendor"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="catalog">
                    <TabsList className="mb-4">
                      <TabsTrigger value="catalog" className="gap-2" data-testid="tab-catalog">
                        <Package className="h-4 w-4" />
                        Equipment Catalog
                      </TabsTrigger>
                      <TabsTrigger value="info" className="gap-2" data-testid="tab-info">
                        <FileText className="h-4 w-4" />
                        Vendor Info
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="catalog">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-muted-foreground">
                          {vendorCatalog.length} equipment item{vendorCatalog.length !== 1 ? "s" : ""} in catalog
                        </p>
                        <Button size="sm" onClick={handleAddCatalogItem} data-testid="button-add-catalog-item">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Equipment
                        </Button>
                      </div>

                      {vendorCatalog.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Wrench className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>No equipment in catalog</p>
                          <p className="text-sm">Add equipment available for rental from this vendor</p>
                        </div>
                      ) : (
                        <ScrollArea className="h-[400px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Equipment</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead className="text-right">Daily Rate</TableHead>
                                <TableHead className="text-right">Weekly Rate</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-[80px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {vendorCatalog.map(item => (
                                <TableRow key={item.id} data-testid={`catalog-row-${item.id}`}>
                                  <TableCell>
                                    <div>
                                      <p className="font-medium">{item.name}</p>
                                      {(item.make || item.model) && (
                                        <p className="text-sm text-muted-foreground">
                                          {[item.make, item.model].filter(Boolean).join(" ")}
                                        </p>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline">
                                      {EQUIPMENT_TYPES.find(t => t.value === item.equipmentType)?.label || item.equipmentType}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {formatRate(item.dailyRate)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {formatRate(item.weeklyRate)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={item.isActive ? "default" : "secondary"}>
                                      {item.isActive ? "Active" : "Inactive"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Button 
                                        variant="ghost" 
                                        size="icon"
                                        onClick={() => handleEditCatalogItem(item)}
                                        data-testid={`button-edit-catalog-${item.id}`}
                                      >
                                        <Edit className="h-4 w-4" />
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="icon"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => {
                                          setDeleteTarget({ type: "catalog", id: item.id });
                                          setShowDeleteConfirm(true);
                                        }}
                                        data-testid={`button-delete-catalog-${item.id}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      )}
                    </TabsContent>

                    <TabsContent value="info">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h3 className="font-medium">Contact Information</h3>
                          <div className="space-y-3">
                            {selectedVendor.contactName && (
                              <div className="flex items-center gap-2 text-sm">
                                <Building2 className="h-4 w-4 text-muted-foreground" />
                                <span>{selectedVendor.contactName}</span>
                              </div>
                            )}
                            {selectedVendor.contactEmail && (
                              <div className="flex items-center gap-2 text-sm">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <a href={`mailto:${selectedVendor.contactEmail}`} className="text-primary hover:underline">
                                  {selectedVendor.contactEmail}
                                </a>
                              </div>
                            )}
                            {selectedVendor.contactPhone && (
                              <div className="flex items-center gap-2 text-sm">
                                <Phone className="h-4 w-4 text-muted-foreground" />
                                <a href={`tel:${selectedVendor.contactPhone}`} className="text-primary hover:underline">
                                  {selectedVendor.contactPhone}
                                </a>
                              </div>
                            )}
                            {selectedVendor.address && (
                              <div className="flex items-start gap-2 text-sm">
                                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <span>
                                  {selectedVendor.address}
                                  {selectedVendor.city && <>, {selectedVendor.city}</>}
                                  {selectedVendor.state && <>, {selectedVendor.state}</>}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="font-medium">Account Details</h3>
                          <div className="space-y-3">
                            {selectedVendor.accountNumber && (
                              <div className="flex items-center gap-2 text-sm">
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                                <span>Account: {selectedVendor.accountNumber}</span>
                              </div>
                            )}
                            {selectedVendor.paymentTerms && (
                              <div className="flex items-center gap-2 text-sm">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span>Terms: {selectedVendor.paymentTerms}</span>
                              </div>
                            )}
                          </div>
                          
                          {selectedVendor.notes && (
                            <div className="mt-4">
                              <h3 className="font-medium mb-2">Notes</h3>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                {selectedVendor.notes}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-[500px] text-muted-foreground">
                <Truck className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium">Select a vendor</p>
                <p className="text-sm">Choose a vendor from the list to view their equipment catalog</p>
              </div>
            )}
          </Card>
        </div>

        <Dialog open={showVendorDialog} onOpenChange={(open) => {
          setShowVendorDialog(open);
          if (!open) {
            setEditingVendor(null);
            vendorForm.reset();
          }
        }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingVendor ? "Edit Vendor" : "Add Rental Vendor"}</DialogTitle>
              <DialogDescription>
                {editingVendor ? "Update vendor information" : "Add a new equipment rental vendor"}
              </DialogDescription>
            </DialogHeader>
            <Form {...vendorForm}>
              <form onSubmit={vendorForm.handleSubmit(handleSubmitVendor)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={vendorForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vendor Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Sunbelt Rentals" {...field} data-testid="input-vendor-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={vendorForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vendor Code *</FormLabel>
                        <FormControl>
                          <Input placeholder="SUNBELT" {...field} data-testid="input-vendor-code" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={vendorForm.control}
                    name="contactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John Smith" {...field} data-testid="input-contact-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={vendorForm.control}
                    name="contactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="(555) 123-4567" {...field} data-testid="input-contact-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={vendorForm.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="contact@sunbelt.com" {...field} data-testid="input-contact-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={vendorForm.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Industrial Blvd" {...field} data-testid="input-address" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={vendorForm.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="Dallas" {...field} data-testid="input-city" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={vendorForm.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input placeholder="TX" {...field} data-testid="input-state" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={vendorForm.control}
                    name="accountNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Account Number</FormLabel>
                        <FormControl>
                          <Input placeholder="TFR-001234" {...field} data-testid="input-account-number" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={vendorForm.control}
                    name="paymentTerms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Terms</FormLabel>
                        <FormControl>
                          <Input placeholder="NET30" {...field} data-testid="input-payment-terms" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={vendorForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Additional notes about this vendor..." 
                          className="resize-none"
                          {...field} 
                          data-testid="input-vendor-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowVendorDialog(false)}
                    data-testid="button-cancel-vendor"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createVendorMutation.isPending || updateVendorMutation.isPending}
                    data-testid="button-save-vendor"
                  >
                    {editingVendor ? "Update Vendor" : "Add Vendor"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Dialog open={showCatalogDialog} onOpenChange={(open) => {
          setShowCatalogDialog(open);
          if (!open) {
            setEditingCatalog(null);
            catalogForm.reset();
          }
        }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingCatalog ? "Edit Equipment" : "Add Equipment to Catalog"}</DialogTitle>
              <DialogDescription>
                {editingCatalog 
                  ? "Update equipment information and rates" 
                  : `Add rental equipment available from ${selectedVendor?.name}`
                }
              </DialogDescription>
            </DialogHeader>
            <Form {...catalogForm}>
              <form onSubmit={catalogForm.handleSubmit(handleSubmitCatalog)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={catalogForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Equipment Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="CAT 320 Excavator" {...field} data-testid="input-catalog-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={catalogForm.control}
                    name="equipmentType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-equipment-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {EQUIPMENT_TYPES.map(type => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={catalogForm.control}
                    name="make"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Make</FormLabel>
                        <FormControl>
                          <Input placeholder="Caterpillar" {...field} data-testid="input-catalog-make" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={catalogForm.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Model</FormLabel>
                        <FormControl>
                          <Input placeholder="320" {...field} data-testid="input-catalog-model" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={catalogForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Equipment specifications and capabilities..." 
                          className="resize-none"
                          {...field} 
                          data-testid="input-catalog-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Rental Rates</h4>
                  <div className="grid grid-cols-4 gap-4">
                    <FormField
                      control={catalogForm.control}
                      name="hourlyRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Hourly</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-catalog-hourly" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={catalogForm.control}
                      name="dailyRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Daily</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-catalog-daily" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={catalogForm.control}
                      name="weeklyRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Weekly</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-catalog-weekly" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={catalogForm.control}
                      name="monthlyRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Monthly</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-catalog-monthly" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={catalogForm.control}
                    name="deliveryFee"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Delivery Fee</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-catalog-delivery" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={catalogForm.control}
                    name="pickupFee"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pickup Fee</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-catalog-pickup" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={catalogForm.control}
                    name="minimumRentalDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Min Days</FormLabel>
                        <FormControl>
                          <Input type="number" placeholder="1" {...field} value={field.value as string} data-testid="input-catalog-min-days" />
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
                    onClick={() => setShowCatalogDialog(false)}
                    data-testid="button-cancel-catalog"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createCatalogMutation.isPending || updateCatalogMutation.isPending}
                    data-testid="button-save-catalog"
                  >
                    {editingCatalog ? "Update Equipment" : "Add Equipment"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                Confirm Delete
              </DialogTitle>
              <DialogDescription>
                {deleteTarget?.type === "vendor" 
                  ? "Are you sure you want to delete this vendor? This will also remove all equipment in their catalog."
                  : "Are you sure you want to remove this equipment from the catalog?"
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setShowDeleteConfirm(false)}
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={confirmDelete}
                disabled={deleteVendorMutation.isPending || deleteCatalogMutation.isPending}
                data-testid="button-confirm-delete"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
